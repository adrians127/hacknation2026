import type { TriageStatus } from "@subsurf/contracts/hosts/hosts.schema";
import {
  MatchReasonSchema,
  type MatchConfidence,
  type VulnerabilitySeverity,
  type VulnerabilityTriageStatus,
} from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";

import type { Prisma } from "~backend/generated/prisma/client";
import {
  serviceFacts,
  type HostFacts,
  type ServiceFacts,
  type VulnerabilityFacts,
} from "~backend/modules/rules/rule-match";

type Db = Prisma.TransactionClient;

/** A value a rule may own: the triage and the rule that set it (`null` = a user, or nobody). */
export interface TriageSlot<V extends string> {
  value: V;
  ruleId: string | null;
}

export interface ServiceTarget {
  id: string;
  hostId: string;
  port: number;
  triage: TriageSlot<TriageStatus>;
  tags: string[];
  facts: ServiceFacts;
}

export interface HostTarget {
  id: string;
  ip: string;
  triage: TriageSlot<TriageStatus>;
  tags: string[];
  facts: HostFacts;
  services: ServiceTarget[];
}

export interface VulnerabilityTarget {
  serviceId: string;
  /** Whether a triage row exists (a rule's first verdict inserts one). */
  hasRow: boolean;
  triage: TriageSlot<VulnerabilityTriageStatus>;
  facts: VulnerabilityFacts;
}

interface IdentityRow {
  serviceId: string;
  name: string | null;
  product: string | null;
  titles: (string | null)[];
}

/**
 * Each service's newest observation, with the same preference as the scan views and matching
 * (`newestIdentities` in vulnerabilities/components/service-components.ts). Titles are plaintext.
 */
async function newestIdentities(db: Db): Promise<Map<string, IdentityRow>> {
  const rows = await db.$queryRaw<IdentityRow[]>`
    WITH newest AS (
      SELECT DISTINCT ON (po."serviceId") po.id, po."serviceId"
      FROM "PortObservation" po
      JOIN "HostObservation" ho ON ho.id = po."hostObservationId"
      JOIN "ScanJobResult" r ON r.id = ho."resultId"
      JOIN "Scan" s ON s.id = ho."scanId"
      ORDER BY po."serviceId", s."createdAt" DESC,
        CASE WHEN r."workerId" LIKE 'nmap%' THEN 0 ELSE 1 END,
        ho."observedAt" DESC NULLS LAST, r."receivedAt" DESC
    )
    SELECT n."serviceId", po."serviceName" AS name, po."serviceProduct" AS product,
      ARRAY(
        SELECT e->>'title' FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(po.details->'http') = 'array' THEN po.details->'http' ELSE '[]' END
        ) AS e
      ) AS titles
    FROM newest n JOIN "PortObservation" po ON po.id = n.id`;
  return new Map(rows.map((row) => [row.serviceId, row]));
}

/** Every host and service with what rules match on and the triage they may own. */
export async function loadHostTargets(db: Db): Promise<HostTarget[]> {
  const [hosts, identities] = await Promise.all([
    db.host.findMany({
      select: {
        id: true,
        ip: true,
        ipNumber: true,
        tags: true,
        triage: true,
        triageRuleId: true,
        services: {
          select: {
            id: true,
            port: true,
            tags: true,
            triage: true,
            triageRuleId: true,
            nameOverride: true,
            productOverride: true,
          },
        },
      },
      orderBy: { ipNumber: "asc" },
    }),
    newestIdentities(db),
  ]);
  return hosts.map((host) => ({
    id: host.id,
    ip: host.ip,
    triage: { value: host.triage, ruleId: host.triageRuleId },
    tags: host.tags,
    facts: { ipNumber: Number(host.ipNumber), tags: host.tags },
    services: host.services
      .toSorted((a, b) => a.port - b.port)
      .map((service) => {
        const identity = identities.get(service.id);
        return {
          id: service.id,
          hostId: host.id,
          port: service.port,
          triage: { value: service.triage, ruleId: service.triageRuleId },
          tags: service.tags,
          facts: serviceFacts(
            service.port,
            { name: service.nameOverride, product: service.productOverride },
            { name: identity?.name ?? null, product: identity?.product ?? null },
            identity?.titles ?? [],
          ),
        };
      }),
  }));
}

interface MatchRow {
  serviceId: string;
  canonicalId: string;
  severity: VulnerabilitySeverity;
  cvssScore: number | null;
  kev: boolean;
  confidence: MatchConfidence;
  reasons: string[];
  triage: VulnerabilityTriageStatus | null;
  triageRuleId: string | null;
}

/** Active vulnerability matches with their triage; rules only judge what currently matches. */
export async function loadVulnerabilityTargets(db: Db): Promise<VulnerabilityTarget[]> {
  const rows = await db.$queryRaw<MatchRow[]>`
    SELECT m."serviceId", m."canonicalId", m.severity::text AS severity, m."cvssScore", m.kev,
      m.confidence::text AS confidence, m.reasons, t.triage::text AS triage, t."triageRuleId"
    FROM "VulnerabilityMatch" m
    LEFT JOIN "ServiceVulnerabilityTriage" t
      ON t."serviceId" = m."serviceId" AND t."canonicalId" = m."canonicalId"
    WHERE m.status = 'active'
    ORDER BY m."serviceId", m."canonicalId"`;
  return rows.map((row) => ({
    serviceId: row.serviceId,
    hasRow: row.triage !== null,
    triage: { value: row.triage ?? "unreviewed", ruleId: row.triageRuleId },
    facts: {
      vulnerabilityId: row.canonicalId,
      severity: row.severity,
      cvssScore: row.cvssScore,
      kev: row.kev,
      confidence: row.confidence,
      reasons: row.reasons.flatMap((reason) => {
        const parsed = MatchReasonSchema.safeParse(reason);
        return parsed.success ? [parsed.data] : [];
      }),
    },
  }));
}
