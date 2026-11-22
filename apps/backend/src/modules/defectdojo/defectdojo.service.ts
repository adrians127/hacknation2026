import type {
  DefectDojoStatus,
  DefectDojoSync,
  DefectDojoSyncStats,
} from "@subsurf/contracts/defectdojo/defectdojo.schema";

import { env } from "~backend/config/env";
import type { Prisma } from "~backend/generated/prisma/client";
import { HttpError } from "~backend/lib/http-error";
import { logger } from "~backend/lib/logger";
import { prisma } from "~backend/lib/prisma";
import { configuredClient as client, type DefectDojoClient } from "~backend/modules/defectdojo/defectdojo.client";
import {
  addressKey,
  mergeTags,
  planImport,
  remediationFromFindings,
  triageFromFindings,
  type ImportPlan,
  type ProductData,
  type Remediation,
} from "~backend/modules/defectdojo/defectdojo.import";
import {
  PUSH_INCLUDE,
  SYNC_INCLUDE,
  toDefectDojoPush,
  toDefectDojoSync,
} from "~backend/modules/defectdojo/defectdojo.mapper";

/** A `running` row older than this is a crashed sync, not a parallel one. */
const STALE_SYNC_MS = 10 * 60_000;

const dateOrNull = (day: string | null) => (day ? new Date(`${day}T00:00:00Z`) : null);
const dayOf = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;


async function fetchProducts(dojo: DefectDojoClient) {
  const products = await dojo.listProducts();
  const data: ProductData[] = [];
  for (const product of products) data.push({ product, findings: await dojo.listFindings(product.id) });

  // Owner tags are optional: a token without user access still imports everything else.
  let usernames = new Map<number, string>();
  try {
    usernames = new Map((await dojo.listUsers()).map((user) => [user.id, user.username]));
  } catch (error) {
    logger.warn({ err: error }, "DefectDojo users unavailable; skipping owner tags");
  }
  return { data, usernames };
}

/**
 * Writes the plan onto Host/Service rows. Each update is conditional on the tags and triage
 * read in this transaction, so an edit a user makes meanwhile wins and the next sync retries.
 */
async function applyPlan(tx: Prisma.TransactionClient, plan: ImportPlan) {
  const stats = {
    hostsUpdated: 0,
    servicesUpdated: 0,
    tagsAdded: 0,
    tagsSkipped: 0,
    triageSet: 0,
    remediationUpdated: 0,
  };
  const ips = [...new Set([...plan.hostTags.keys(), ...[...plan.services.values()].map((s) => s.address.ip)])];
  const hosts = await tx.host.findMany({ where: { ip: { in: ips } }, include: { services: true } });
  const matchedFindings = new Set<number>();
  const touchedServices = new Set<string>();

  for (const host of hosts) {
    const merged = mergeTags(host.tags, plan.hostTags.get(host.ip) ?? []);
    stats.tagsSkipped += merged.skipped;
    if (merged.added > 0) {
      const { count } = await tx.host.updateMany({
        where: { id: host.id, tags: { equals: host.tags } },
        data: { tags: merged.tags },
      });
      stats.hostsUpdated += count;
      stats.tagsAdded += count * merged.added;
    }

    for (const service of host.services) {
      const planned = plan.services.get(addressKey({ ip: host.ip, port: service.port }));
      if (!planned) continue;
      touchedServices.add(service.id);
      for (const finding of planned.findings) matchedFindings.add(finding.id);

      const tags = mergeTags(service.tags, planned.tags);
      stats.tagsSkipped += tags.skipped;
      const triage = service.triage === "unreviewed" ? triageFromFindings(planned.findings) : null;
      const remediation = remediationFromFindings(planned.findings);
      const remediationChanged = !sameRemediation(service, remediation);
      if (tags.added === 0 && !triage && !remediationChanged) continue;

      const { count } = await tx.service.updateMany({
        where: { id: service.id, tags: { equals: service.tags }, triage: service.triage },
        data: {
          ...(tags.added > 0 && { tags: tags.tags }),
          ...(triage && { triage }),
          ...(remediationChanged && remediationColumns(remediation)),
        },
      });
      if (count === 0) continue;
      stats.servicesUpdated += 1;
      stats.tagsAdded += tags.added;
      if (triage) stats.triageSet += 1;
      if (remediationChanged) stats.remediationUpdated += 1;
    }
  }

  // Dates of findings that are gone from DefectDojo, or no longer match, are stale.
  const cleared = await tx.service.updateMany({
    where: {
      id: { notIn: [...touchedServices] },
      OR: [
        { remediationPlannedOn: { not: null } },
        { slaDueOn: { not: null } },
        { riskAcceptedUntil: { not: null } },
      ],
    },
    data: { remediationPlannedOn: null, slaDueOn: null, riskAcceptedUntil: null },
  });
  stats.remediationUpdated += cleared.count;

  return { ...stats, matchedFindings: matchedFindings.size };
}

function sameRemediation(
  service: { remediationPlannedOn: Date | null; slaDueOn: Date | null; riskAcceptedUntil: Date | null },
  remediation: Remediation,
): boolean {
  return (
    dayOf(service.remediationPlannedOn) === remediation.plannedOn &&
    dayOf(service.slaDueOn) === remediation.slaDueOn &&
    dayOf(service.riskAcceptedUntil) === remediation.riskAcceptedUntil
  );
}

const remediationColumns = (remediation: Remediation) => ({
  remediationPlannedOn: dateOrNull(remediation.plannedOn),
  slaDueOn: dateOrNull(remediation.slaDueOn),
  riskAcceptedUntil: dateOrNull(remediation.riskAcceptedUntil),
});

async function latestSync() {
  return prisma.defectDojoSync.findFirst({ orderBy: { startedAt: "desc" }, include: SYNC_INCLUDE });
}

let syncInProgress = false;

export const defectDojoService = {
  async status(): Promise<DefectDojoStatus> {
    const [last, push] = await Promise.all([
      latestSync(),
      prisma.defectDojoPush.findFirst({ orderBy: { startedAt: "desc" }, include: PUSH_INCLUDE }),
    ]);
    return {
      configured: Boolean(env.DEFECTDOJO_URL && env.DEFECTDOJO_API_TOKEN),
      url: env.DEFECTDOJO_URL ?? null,
      lastSync: last ? toDefectDojoSync(last) : null,
      lastPush: push ? toDefectDojoPush(push) : null,
    };
  },

  /** Pulls the current state of every product and finding; DefectDojo is only read. */
  async sync(userId: string): Promise<DefectDojoSync> {
    const dojo = client();
    const running = await prisma.defectDojoSync.findFirst({
      where: { status: "running", startedAt: { gt: new Date(Date.now() - STALE_SYNC_MS) } },
    });
    if (syncInProgress || running) {
      throw HttpError.conflict("A DefectDojo sync is already running", "DEFECTDOJO_SYNC_RUNNING");
    }

    syncInProgress = true;
    const row = await prisma.defectDojoSync.create({ data: { startedById: userId } });
    try {
      const { data, usernames } = await fetchProducts(dojo);
      const plan = planImport(data, usernames);
      const applied = await prisma.$transaction((tx) => applyPlan(tx, plan), { timeout: 120_000 });
      const stats: DefectDojoSyncStats = {
        products: data.length,
        findings: plan.findings,
        unmatchedFindings: plan.findings - applied.matchedFindings,
        ...applied,
      };
      const done = await prisma.defectDojoSync.update({
        where: { id: row.id },
        data: { status: "succeeded", finishedAt: new Date(), stats },
        include: SYNC_INCLUDE,
      });
      logger.info({ syncId: row.id, stats }, "DefectDojo sync finished");
      return toDefectDojoSync(done);
    } catch (error) {
      await prisma.defectDojoSync.update({
        where: { id: row.id },
        data: {
          status: "failed",
          finishedAt: new Date(),
          error: error instanceof HttpError ? error.message : "Internal error during the sync",
        },
      });
      throw error;
    } finally {
      syncInProgress = false;
    }
  },
};
