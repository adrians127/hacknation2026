import { MAX_TAGS } from "@subsurf/contracts/common/common.schema";
import { selectorRanges } from "@subsurf/contracts/hosts/host-selectors";
import type {
  HostEdits,
  ServiceEdits,
  TriageStatus,
  UpdateHostBody,
  UpdateServiceBody,
} from "@subsurf/contracts/hosts/hosts.schema";
import type { HostEdit, ScanEdits, ServiceEdit } from "@subsurf/contracts/scans/scan-export.schema";
import type { ImportedEdits } from "@subsurf/contracts/scans/scan-import.schema";
import type {
  TagScanHostsBody,
  TagScanHostsResponse,
} from "@subsurf/contracts/scans/scan-results.schema";
import { ipv4ToInt } from "@subsurf/contracts/targets/ipv4";

import { Prisma, type TransportProtocol } from "~backend/generated/prisma/client";
import { chunks } from "~backend/lib/chunks";
import { encryptText } from "~backend/lib/crypto";
import { HttpError } from "~backend/lib/http-error";
import { prisma } from "~backend/lib/prisma";
import { toHostEdits, toServiceEdits } from "~backend/modules/hosts/hosts.mapper";
import { scanResultsService } from "~backend/modules/scans/scan-results.service";

interface SeenWindow {
  id: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

const SEEN_WINDOW = { id: true, firstSeenAt: true, lastSeenAt: true } as const;

/** Results may arrive out of order: only ever widen the window, guarded in SQL against races. */
async function widenSeenWindow(
  model: {
    updateMany(args: {
      where: { id: string; firstSeenAt?: { gt: Date }; lastSeenAt?: { lt: Date } };
      data: { firstSeenAt?: Date; lastSeenAt?: Date };
    }): Promise<unknown>;
  },
  row: SeenWindow,
  seenAt: Date,
): Promise<void> {
  if (seenAt < row.firstSeenAt) {
    await model.updateMany({
      where: { id: row.id, firstSeenAt: { gt: seenAt } },
      data: { firstSeenAt: seenAt },
    });
  }
  if (seenAt > row.lastSeenAt) {
    await model.updateMany({
      where: { id: row.id, lastSeenAt: { lt: seenAt } },
      data: { lastSeenAt: seenAt },
    });
  }
}

function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()))];
}

/** Only the fields present in the body change; an empty note is stored as null. */
function userFields(body: { note?: string; tags?: string[]; triage?: TriageStatus }) {
  return {
    ...(body.note !== undefined && { note: encryptText(body.note.trim()) ?? Prisma.DbNull }),
    ...(body.tags !== undefined && { tags: normalizeTags(body.tags) }),
    ...(body.triage !== undefined && { triage: body.triage }),
  };
}

const override = (value: string | null | undefined) =>
  value === undefined ? undefined : (value?.trim() ?? null);

interface EditableAsset {
  triage: TriageStatus;
  tags: string[];
  note: unknown;
}

/**
 * What an imported edit may still set: tags are added up to the limit, the triage and the note
 * only where nobody set one. `null` when the asset already has everything.
 */
function fillUserFields(asset: EditableAsset, edit: HostEdit) {
  const tags = [...new Set([...asset.tags, ...normalizeTags(edit.tags)])].slice(0, MAX_TAGS);
  const fields = {
    ...(tags.length > asset.tags.length && { tags }),
    ...(asset.triage === "unreviewed" && edit.triage !== "unreviewed" && { triage: edit.triage }),
    ...(asset.note === null && edit.note.trim() !== "" && { note: encryptText(edit.note.trim()) ?? Prisma.DbNull }),
  };
  return Object.keys(fields).length > 0 ? fields : null;
}

/** The corrections of an imported edit the service does not have yet. */
function serviceOverridesToFill(
  service: { nameOverride: string | null; productOverride: string | null; versionOverride: string | null },
  edit: ServiceEdit,
) {
  return {
    ...(service.nameOverride === null && edit.nameOverride !== null && { nameOverride: edit.nameOverride.trim() }),
    ...(service.productOverride === null &&
      edit.productOverride !== null && { productOverride: edit.productOverride.trim() }),
    ...(service.versionOverride === null &&
      edit.versionOverride !== null && { versionOverride: edit.versionOverride.trim() }),
  };
}

const HOST_LOOKUP_BATCH = 10_000;

/**
 * Host and Service rows live across scans. Ingest only creates them and moves their seen
 * window; `note`, `tags`, `triage` and the service corrections belong to users (PDF item 14)
 * and only `update`/`updateService`/`tagScanHosts` write them.
 */
export const hostsService = {
  async update(id: string, body: UpdateHostBody): Promise<HostEdits> {
    const { count } = await prisma.host.updateMany({ where: { id }, data: userFields(body) });
    if (count === 0) throw HttpError.notFound("Host not found");
    return toHostEdits(await prisma.host.findUniqueOrThrow({ where: { id } }));
  },

  async updateService(
    hostId: string,
    serviceId: string,
    body: UpdateServiceBody,
  ): Promise<ServiceEdits> {
    const { count } = await prisma.service.updateMany({
      where: { id: serviceId, hostId },
      data: {
        ...userFields(body),
        nameOverride: override(body.nameOverride),
        productOverride: override(body.productOverride),
        versionOverride: override(body.versionOverride),
      },
    });
    if (count === 0) throw HttpError.notFound("Service not found");
    return toServiceEdits(await prisma.service.findUniqueOrThrow({ where: { id: serviceId } }));
  },

  async tagScanHosts(scanId: string, body: TagScanHostsBody): Promise<TagScanHostsResponse> {
    const ids = await scanResultsService.hostIdsIn(scanId, selectorRanges(body.selectors));
    const tag = body.tag.trim();
    const matched = ids.length;
    if (matched === 0) return { matched, changed: 0, unchanged: 0, limitReached: 0 };

    // Raw SQL: one statement for any number of hosts, and Prisma has no array append/remove.
    if (body.action === "remove") {
      const changed = await prisma.$executeRaw`
        UPDATE "Host" SET tags = array_remove(tags, ${tag}), "updatedAt" = now()
        WHERE id = ANY(${ids}::uuid[]) AND ${tag} = ANY(tags)
      `;
      return { matched, changed, unchanged: matched - changed, limitReached: 0 };
    }
    const [changed, rows] = await prisma.$transaction([
      prisma.$executeRaw`
        UPDATE "Host" SET tags = array_append(tags, ${tag}), "updatedAt" = now()
        WHERE id = ANY(${ids}::uuid[]) AND NOT (${tag} = ANY(tags))
          AND cardinality(tags) < ${MAX_TAGS}
      `,
      prisma.$queryRaw<{ tagged: number }[]>`
        SELECT count(*)::int AS tagged FROM "Host"
        WHERE id = ANY(${ids}::uuid[]) AND ${tag} = ANY(tags)
      `,
    ]);
    const tagged = rows[0]?.tagged ?? 0;
    return { matched, changed, unchanged: tagged - changed, limitReached: matched - tagged };
  },

  /**
   * Applies the edits an imported file carries without overwriting anyone's work (PDF item 14):
   * a value is taken only where the host or service has none.
   */
  async mergeEdits(tx: Prisma.TransactionClient, edits: ScanEdits): Promise<ImportedEdits> {
    const counts: ImportedEdits = { applied: 0, kept: 0, missing: 0 };
    const ips = [...new Set([...edits.hosts, ...edits.services].map((edit) => edit.ip))];
    const hosts = new Map<string, Prisma.HostGetPayload<{ include: { services: true } }>>();
    for (const batch of chunks(ips, HOST_LOOKUP_BATCH)) {
      const rows = await tx.host.findMany({ where: { ip: { in: batch } }, include: { services: true } });
      for (const row of rows) hosts.set(row.ip, row);
    }

    for (const edit of edits.hosts) {
      const host = hosts.get(edit.ip);
      const fields = host && fillUserFields(host, edit);
      if (!host) counts.missing += 1;
      else if (!fields) counts.kept += 1;
      else {
        await tx.host.update({ where: { id: host.id }, data: fields });
        counts.applied += 1;
      }
    }
    for (const edit of edits.services) {
      const service = hosts
        .get(edit.ip)
        ?.services.find((row) => row.protocol === edit.protocol && row.port === edit.port);
      if (!service) {
        counts.missing += 1;
        continue;
      }
      const overrides = serviceOverridesToFill(service, edit);
      const fields = { ...fillUserFields(service, edit), ...overrides };
      if (Object.keys(fields).length === 0) counts.kept += 1;
      else {
        await tx.service.update({ where: { id: service.id }, data: fields });
        counts.applied += 1;
      }
    }
    return counts;
  },

  /** Records an address seen `up`; returns the Host id. */
  async recordHostUp(tx: Prisma.TransactionClient, ip: string, seenAt: Date): Promise<string> {
    const host = await tx.host.upsert({
      where: { ip },
      create: { ip, ipNumber: BigInt(ipv4ToInt(ip)), firstSeenAt: seenAt, lastSeenAt: seenAt },
      update: {},
      select: SEEN_WINDOW,
    });
    await widenSeenWindow(tx.host, host, seenAt);
    return host.id;
  },

  /** Records a port seen open on a host; returns the Service id. */
  async recordServiceOpen(
    tx: Prisma.TransactionClient,
    hostId: string,
    protocol: TransportProtocol,
    port: number,
    seenAt: Date,
  ): Promise<string> {
    const service = await tx.service.upsert({
      where: { hostId_protocol_port: { hostId, protocol, port } },
      create: { hostId, protocol, port, firstSeenAt: seenAt, lastSeenAt: seenAt },
      update: {},
      select: SEEN_WINDOW,
    });
    await widenSeenWindow(tx.service, service, seenAt);
    return service.id;
  },
};
