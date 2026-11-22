import type {
  CreatePackageMappingBody,
  JobRequest,
  PackageMapping,
  PackageMappingListResponse,
  ServiceVulnerability,
  ServiceVulnerabilityTriage,
  SyncMode,
  SyncRun,
  UpdateServiceVulnerabilityBody,
  VulnerabilitySource,
  VulnerabilityFilter,
  VulnerabilitySourceListResponse,
  VulnerabilitySummary,
} from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";

import { Prisma } from "~backend/generated/prisma/client";
import { decryptText, encryptText } from "~backend/lib/crypto";
import { HttpError } from "~backend/lib/http-error";
import { isUniqueViolation, prisma } from "~backend/lib/prisma";
import {
  configuredSources,
  ensureSources,
  sourceById,
} from "~backend/modules/vulnerabilities/sources/registry";
import { leaseActive } from "~backend/modules/vulnerabilities/sync/lease";
import {
  EMPTY_SUMMARY,
  summarize,
  toJobRequest,
  toMapping,
  toRun,
  toServiceVulnerability,
  toSource,
  TRIAGE_INCLUDE,
  type MatchRow,
} from "~backend/modules/vulnerabilities/vulnerabilities.mapper";

const RUNS_LIMIT = 20;
/** Retracted matches stay visible this long, so a change since the last scan can be seen. */
const RETRACTED_VISIBLE_MS = 30 * 24 * 60 * 60 * 1000;

const SEVERITY_RANK = { critical: 5, high: 4, medium: 3, low: 2, none: 1, unknown: 0 } as const;

const MAPPING_INCLUDE = { createdBy: { select: { id: true, displayName: true } } } as const;

function configuredSource(id: string) {
  const source = sourceById(id);
  if (!source) throw HttpError.notFound("No such vulnerability source");
  return source;
}

/** Queues a re-match of every service for the vuln-sync process, unless one is waiting already. */
async function requestRematch(requestedById: string): Promise<void> {
  const waiting = await prisma.vulnerabilityJobRequest.findFirst({
    where: { kind: "rematch", takenAt: null },
  });
  if (!waiting) {
    await prisma.vulnerabilityJobRequest.create({ data: { kind: "rematch", requestedById } });
  }
}

const detailUrl = (sourceId: string, externalId: string) =>
  sourceById(sourceId)?.detailUrl(externalId) ?? null;

/** Matches that count: active, and not marked a false positive by an analyst. */
async function countedMatches(serviceIds: readonly string[]) {
  if (serviceIds.length === 0) return [];
  const [matches, falsePositives] = await Promise.all([
    prisma.vulnerabilityMatch.findMany({
      where: { serviceId: { in: [...serviceIds] }, status: "active" },
      select: { serviceId: true, canonicalId: true, confidence: true, severity: true, kev: true },
    }),
    prisma.serviceVulnerabilityTriage.findMany({
      where: { serviceId: { in: [...serviceIds] }, triage: "false_positive" },
      select: { serviceId: true, canonicalId: true },
    }),
  ]);
  const ignored = new Set(falsePositives.map((row) => `${row.serviceId}|${row.canonicalId}`));
  return matches.filter((match) => !ignored.has(`${match.serviceId}|${match.canonicalId}`));
}

function byDisplayOrder(a: MatchRow, b: MatchRow): number {
  return (
    Number(b.status === "active") - Number(a.status === "active") ||
    Number(b.confidence === "confirmed") - Number(a.confidence === "confirmed") ||
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    (b.cvssScore ?? -1) - (a.cvssScore ?? -1) ||
    b.canonicalId.localeCompare(a.canonicalId)
  );
}

export const vulnerabilitiesService = {
  /** For changes elsewhere that move a service's newest observation (a deleted scan). */
  requestRematch,

  async listSources(): Promise<VulnerabilitySourceListResponse> {
    await ensureSources();
    const adapters = configuredSources();
    const ids = adapters.map((source) => source.id);
    const [rows, running, pending, processActive] = await Promise.all([
      prisma.vulnerabilitySource.findMany({ where: { id: { in: ids } } }),
      prisma.vulnerabilitySyncRun.findMany({
        where: { sourceId: { in: ids }, status: "running" },
        orderBy: { startedAt: "desc" },
      }),
      prisma.vulnerabilityJobRequest.findMany({
        where: { sourceId: { in: ids }, takenAt: null },
        orderBy: { createdAt: "asc" },
      }),
      leaseActive(),
    ]);
    return {
      items: adapters.flatMap((adapter) => {
        const row = rows.find((candidate) => candidate.id === adapter.id);
        if (!row) return [];
        return [
          toSource(
            adapter,
            row,
            running.find((run) => run.sourceId === adapter.id),
            pending.find((request) => request.sourceId === adapter.id),
            processActive,
          ),
        ];
      }),
      syncProcessActive: processActive,
    };
  },

  async getSource(id: string): Promise<VulnerabilitySource> {
    const adapter = configuredSource(id);
    const { items } = await this.listSources();
    const source = items.find((item) => item.id === adapter.id);
    if (!source) throw HttpError.notFound("No such vulnerability source");
    return source;
  },

  async listRuns(id: string): Promise<SyncRun[]> {
    configuredSource(id);
    const runs = await prisma.vulnerabilitySyncRun.findMany({
      where: { sourceId: id },
      orderBy: { startedAt: "desc" },
      take: RUNS_LIMIT,
    });
    return runs.map(toRun);
  },

  async requestSync(requestedById: string, id: string, mode: SyncMode): Promise<JobRequest> {
    configuredSource(id);
    await ensureSources();
    const row = await prisma.vulnerabilitySource.findUniqueOrThrow({ where: { id } });
    if (!row.enabled) throw HttpError.conflict("The source is disabled", "SOURCE_DISABLED");
    const kind = mode === "full" ? "full_sync" : "sync";
    const waiting = await prisma.vulnerabilityJobRequest.findFirst({
      where: { sourceId: id, kind, takenAt: null },
    });
    return toJobRequest(
      waiting ??
        (await prisma.vulnerabilityJobRequest.create({
          data: { kind, sourceId: id, requestedById },
        })),
    );
  },

  async updateSource(
    requestedById: string,
    id: string,
    enabled: boolean,
  ): Promise<VulnerabilitySource> {
    configuredSource(id);
    await ensureSources();
    const before = await prisma.vulnerabilitySource.findUniqueOrThrow({ where: { id } });
    if (before.enabled !== enabled) {
      await prisma.vulnerabilitySource.update({ where: { id }, data: { enabled } });
      await requestRematch(requestedById);
    }
    return this.getSource(id);
  },

  async listMappings(): Promise<PackageMappingListResponse> {
    const mappings = await prisma.packageMapping.findMany({
      include: MAPPING_INCLUDE,
      orderBy: [{ cpeVendor: "asc" }, { cpeProduct: "asc" }, { ecosystem: "asc" }],
    });
    const ecosystems = [...new Set(configuredSources().flatMap((source) => source.scopes))];
    return { items: mappings.map(toMapping), ecosystems };
  },

  async createMapping(
    createdById: string,
    body: CreatePackageMappingBody,
  ): Promise<PackageMapping> {
    try {
      const mapping = await prisma.packageMapping.create({
        data: { ...body, createdById },
        include: MAPPING_INCLUDE,
      });
      await requestRematch(createdById);
      return toMapping(mapping);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw HttpError.conflict("This mapping already exists", "PACKAGE_MAPPING_EXISTS");
      }
      throw error;
    }
  },

  async deleteMapping(requestedById: string, id: string): Promise<void> {
    const { count } = await prisma.packageMapping.deleteMany({ where: { id } });
    if (count === 0) throw HttpError.notFound("No such mapping");
    await requestRematch(requestedById);
  },

  async updateTriage(
    updatedById: string,
    serviceId: string,
    canonicalId: string,
    body: UpdateServiceVulnerabilityBody,
  ): Promise<ServiceVulnerabilityTriage> {
    const match = await prisma.vulnerabilityMatch.findUnique({
      where: { serviceId_canonicalId: { serviceId, canonicalId } },
      select: { id: true },
    });
    if (!match) throw HttpError.notFound("The service never matched this vulnerability");
    const fields = {
      // The user's verdict replaces a rule's for good: rules never touch it again.
      ...(body.triage !== undefined && { triage: body.triage, triageRuleId: null }),
      ...(body.note !== undefined && { note: encryptText(body.note.trim()) ?? Prisma.DbNull }),
      updatedById,
    };
    const triage = await prisma.serviceVulnerabilityTriage.upsert({
      where: { serviceId_canonicalId: { serviceId, canonicalId } },
      create: { serviceId, canonicalId, ...fields },
      update: fields,
    });
    return { serviceId, canonicalId, triage: triage.triage, note: decryptText(triage.note) };
  },

  /**
   * For the scan views: a summary per service and per group of services (a host, where a CVE
   * found on two services counts once). False positives are left out.
   */
  async summaries(groups: ReadonlyMap<string, readonly string[]>): Promise<{
    services: Map<string, VulnerabilitySummary>;
    groups: Map<string, VulnerabilitySummary>;
  }> {
    const serviceIds = [...new Set([...groups.values()].flat())];
    const byService = Map.groupBy(await countedMatches(serviceIds), (match) => match.serviceId);
    return {
      services: new Map(serviceIds.map((id) => [id, summarize(byService.get(id) ?? [])])),
      groups: new Map(
        [...groups].map(([key, ids]) => [
          key,
          ids.length === 0
            ? EMPTY_SUMMARY
            : summarize(ids.flatMap((id) => byService.get(id) ?? [])),
        ]),
      ),
    };
  },

  /** Hosts with a counted, confirmed vulnerability matching the scan list's filter. */
  async hostIdsWith(filter: VulnerabilityFilter): Promise<string[]> {
    const severity =
      filter === "critical"
        ? Prisma.sql`AND m."severity" = 'critical'`
        : filter === "high"
          ? Prisma.sql`AND m."severity" IN ('critical', 'high')`
          : filter === "kev"
            ? Prisma.sql`AND m."kev"`
            : Prisma.empty;
    const rows = await prisma.$queryRaw<{ hostId: string }[]>`
      SELECT DISTINCT s."hostId"
      FROM "VulnerabilityMatch" m JOIN "Service" s ON s.id = m."serviceId"
      WHERE m."status" = 'active' AND m."confidence" = 'confirmed' ${severity}
        AND NOT EXISTS (
          SELECT 1 FROM "ServiceVulnerabilityTriage" t
          WHERE t."serviceId" = m."serviceId" AND t."canonicalId" = m."canonicalId"
            AND t."triage" = 'false_positive'
        )`;
    return rows.map((row) => row.hostId);
  },

  /** Per service: active matches, then ones retracted recently, most severe first. */
  async details(serviceIds: readonly string[]): Promise<Map<string, ServiceVulnerability[]>> {
    if (serviceIds.length === 0) return new Map();
    const since = new Date(Date.now() - RETRACTED_VISIBLE_MS);
    const matches = await prisma.vulnerabilityMatch.findMany({
      where: {
        serviceId: { in: [...serviceIds] },
        OR: [{ status: "active" }, { retractedAt: { gte: since } }],
      },
    });
    const [records, triage] = await Promise.all([
      prisma.vulnerability.findMany({
        where: { id: { in: [...new Set(matches.map((match) => match.vulnerabilityId))] } },
      }),
      prisma.serviceVulnerabilityTriage.findMany({
        where: { serviceId: { in: [...serviceIds] } },
        include: TRIAGE_INCLUDE,
      }),
    ]);
    const recordById = new Map(records.map((record) => [record.id, record]));
    const triageByKey = new Map(triage.map((row) => [`${row.serviceId}|${row.canonicalId}`, row]));
    const byService = Map.groupBy(matches.toSorted(byDisplayOrder), (match) => match.serviceId);
    return new Map(
      serviceIds.map((id) => [
        id,
        (byService.get(id) ?? []).map((match) =>
          toServiceVulnerability(
            match,
            recordById.get(match.vulnerabilityId),
            triageByKey.get(`${match.serviceId}|${match.canonicalId}`),
            detailUrl,
          ),
        ),
      ]),
    );
  },
};
