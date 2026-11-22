import type { Logger } from "pino";

import type {
  RetractReason,
  VulnerabilitySeverity,
} from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";

import { chunks } from "~backend/lib/chunks";
import { prisma } from "~backend/lib/prisma";
import {
  componentKey,
  type Component,
} from "~backend/modules/vulnerabilities/components/component";
import { formatCpe } from "~backend/modules/vulnerabilities/cpe/cpe";
import {
  allSubjects,
  subjectsOf,
  type ServiceSubject,
} from "~backend/modules/vulnerabilities/components/service-components";
import type {
  MatchContext,
  PackageTarget,
  PreparedCriterion,
} from "~backend/modules/vulnerabilities/matchers/matcher";
import { MATCHERS, matcherFor } from "~backend/modules/vulnerabilities/matchers/registry";
import {
  resolveMatches,
  type RecordEvaluation,
  type RecordInfo,
  type ResolvedMatch,
} from "~backend/modules/vulnerabilities/matching/resolver";
import { sourceOrder } from "~backend/modules/vulnerabilities/sources/registry";

export interface RematchStats {
  services: number;
  added: number;
  reactivated: number;
  updated: number;
  retracted: number;
}

const SERVICE_CHUNK = 2000;
const KEY_CHUNK = 500;

interface CriterionRow {
  id: bigint;
  kind: string;
  matchKey: string;
  data: unknown;
  vulnerabilityId: string;
  sourceId: string;
  externalId: string;
  canonicalId: string;
  title: string | null;
  severity: VulnerabilitySeverity;
  cvssScore: number | null;
  kev: boolean;
}

interface LoadedCriterion {
  row: CriterionRow;
  record: RecordInfo;
  evaluate: PreparedCriterion;
}

/** Everything one rematch run shares across its chunks of services. */
class MatchRun {
  private readonly criteriaByKey = new Map<string, LoadedCriterion[]>();
  private readonly evaluations = new Map<string, RecordEvaluation[]>();

  constructor(
    readonly context: MatchContext,
    readonly enabledSources: string[],
    readonly order: string[],
    private readonly log: Logger,
  ) {}

  /** Criteria of active records of enabled sources, loaded once per key. */
  async loadKeys(kind: string, keys: Iterable<string>): Promise<void> {
    const missing = [...new Set(keys)].filter((key) => !this.criteriaByKey.has(`${kind}|${key}`));
    for (const batch of chunks(missing, KEY_CHUNK)) {
      for (const key of batch) this.criteriaByKey.set(`${kind}|${key}`, []);
      const rows = await prisma.$queryRaw<CriterionRow[]>`
        SELECT c.id, c.kind, c."matchKey", c.data, c."vulnerabilityId", v."sourceId",
          v."externalId", v."canonicalId", v.title, v.severity::text AS severity, v."cvssScore",
          (v."kevAddedAt" IS NOT NULL) AS kev
        FROM "VulnerabilityCriterion" c
        JOIN "Vulnerability" v ON v.id = c."vulnerabilityId"
        WHERE c.kind = ${kind} AND c."matchKey" = ANY(${batch}::text[])
          AND v.status = 'active' AND v."sourceId" = ANY(${this.enabledSources}::text[])`;
      const matcher = matcherFor(kind);
      if (!matcher) continue;
      for (const row of rows) {
        let evaluate: PreparedCriterion;
        try {
          evaluate = matcher.prepare(row.data);
        } catch (error) {
          this.log.warn({ err: error, criterion: String(row.id) }, "Unreadable criterion skipped");
          continue;
        }
        this.criteriaByKey.get(`${kind}|${row.matchKey}`)?.push({
          row,
          evaluate,
          record: {
            vulnerabilityId: row.vulnerabilityId,
            sourceId: row.sourceId,
            externalId: row.externalId,
            canonicalId: row.canonicalId,
            title: row.title,
            severity: row.severity,
            cvssScore: row.cvssScore,
            kev: row.kev,
          },
        });
      }
    }
  }

  async prepare(subjects: readonly ServiceSubject[]): Promise<void> {
    for (const matcher of MATCHERS) {
      const keys = subjects.flatMap((subject) =>
        subject.components.flatMap((component) => matcher.keysFor(component, this.context)),
      );
      await this.loadKeys(matcher.kind, keys);
    }
  }

  /** Every non-unknown verdict on a component; cached, as many services share software. */
  evaluate(component: Component): RecordEvaluation[] {
    const key = componentKey(component);
    const cached = this.evaluations.get(key);
    if (cached) return cached;
    const results: RecordEvaluation[] = [];
    for (const matcher of MATCHERS) {
      for (const matchKey of matcher.keysFor(component, this.context)) {
        for (const criterion of this.criteriaByKey.get(`${matcher.kind}|${matchKey}`) ?? []) {
          const evaluation = criterion.evaluate(matchKey, component);
          if (evaluation.verdict === "unknown") continue;
          results.push({ record: criterion.record, kind: matcher.kind, component, evaluation });
        }
      }
    }
    this.evaluations.set(key, results);
    return results;
  }

  resolve(subject: ServiceSubject): ResolvedMatch[] {
    const evaluations = subject.components.flatMap((component) => this.evaluate(component));
    return resolveMatches(evaluations, subject.distro, this.order);
  }
}

interface ExistingMatch {
  id: string;
  serviceId: string;
  canonicalId: string;
  status: "active" | "retracted";
  basisHash: string;
  evidence: unknown;
}

function evidenceIds(evidence: unknown): string[] {
  if (!Array.isArray(evidence)) return [];
  return evidence.flatMap((entry: unknown) =>
    typeof entry === "object" &&
    entry !== null &&
    "vulnerabilityId" in entry &&
    typeof entry.vulnerabilityId === "string" &&
    "verdict" in entry &&
    entry.verdict === "affected"
      ? [entry.vulnerabilityId]
      : [],
  );
}

/** Why a match no longer holds: the service changed, or what the sources say did. */
async function retractReasons(
  stale: readonly ExistingMatch[],
  subjects: ReadonlyMap<string, ServiceSubject>,
  enabledSources: readonly string[],
): Promise<Map<string, RetractReason>> {
  const ids = [...new Set(stale.flatMap((match) => evidenceIds(match.evidence)))];
  const records = await prisma.vulnerability.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, sourceId: true },
  });
  const byId = new Map(records.map((record) => [record.id, record]));
  const reasons = new Map<string, RetractReason>();
  for (const match of stale) {
    const subject = subjects.get(match.serviceId);
    const evidence = evidenceIds(match.evidence).flatMap((id) => byId.get(id) ?? []);
    let reason: RetractReason;
    if (!subject || subject.basisHash !== match.basisHash) reason = "service_changed";
    else if (evidence.length > 0 && evidence.every((record) => record.status !== "active")) {
      reason = "source_withdrawn";
    } else if (
      evidence.length > 0 &&
      evidence.every((record) => !enabledSources.includes(record.sourceId))
    ) {
      reason = "source_disabled";
    } else reason = "criteria_changed";
    reasons.set(match.id, reason);
  }
  return reasons;
}

function matchRow(subject: ServiceSubject, match: ResolvedMatch) {
  return {
    serviceId: subject.serviceId,
    canonicalId: match.canonicalId,
    confidence: match.confidence,
    reasons: match.reasons,
    evidence: match.evidence,
    vulnerabilityId: match.best.vulnerabilityId,
    title: match.best.title,
    severity: match.best.severity,
    cvssScore: match.best.cvssScore,
    kev: match.kev,
    basis: {
      scanId: subject.scanId,
      cpe: formatCpe(match.component.cpe),
      version: match.component.version,
      distro: subject.distro,
    },
    basisHash: subject.basisHash,
  };
}

async function writeChunk(
  subjects: readonly ServiceSubject[],
  run: MatchRun,
  now: Date,
): Promise<Omit<RematchStats, "services">> {
  const serviceIds = subjects.map((subject) => subject.serviceId);
  const existing = await prisma.vulnerabilityMatch.findMany({
    where: { serviceId: { in: serviceIds } },
    select: {
      id: true,
      serviceId: true,
      canonicalId: true,
      status: true,
      basisHash: true,
      evidence: true,
    },
  });
  const existingByKey = new Map(
    existing.map((match) => [`${match.serviceId}|${match.canonicalId}`, match]),
  );

  const desired = subjects.flatMap((subject) =>
    run.resolve(subject).map((match) => matchRow(subject, match)),
  );
  const desiredKeys = new Set(desired.map((row) => `${row.serviceId}|${row.canonicalId}`));
  let added = 0;
  let reactivated = 0;
  for (const row of desired) {
    const previous = existingByKey.get(`${row.serviceId}|${row.canonicalId}`);
    if (!previous) added++;
    else if (previous.status === "retracted") reactivated++;
  }

  if (desired.length > 0) {
    await prisma.$executeRaw`
      INSERT INTO "VulnerabilityMatch" AS m (
        "id", "serviceId", "canonicalId", "confidence", "reasons", "evidence", "vulnerabilityId",
        "title", "severity", "cvssScore", "kev", "basis", "basisHash", "status",
        "firstMatchedAt", "lastEvaluatedAt"
      )
      SELECT uuidv7(), r."serviceId", r."canonicalId", r."confidence"::"MatchConfidence",
        r."reasons", r."evidence", r."vulnerabilityId", r."title",
        r."severity"::"VulnerabilitySeverity", r."cvssScore", r."kev", r."basis", r."basisHash",
        'active', ${now}, ${now}
      FROM jsonb_to_recordset(${JSON.stringify(desired)}::jsonb) AS r(
        "serviceId" uuid, "canonicalId" text, "confidence" text, "reasons" text[],
        "evidence" jsonb, "vulnerabilityId" uuid, "title" text, "severity" text,
        "cvssScore" double precision, "kev" boolean, "basis" jsonb, "basisHash" text
      )
      ON CONFLICT ("serviceId", "canonicalId") DO UPDATE SET
        "confidence" = EXCLUDED."confidence",
        "reasons" = EXCLUDED."reasons",
        "evidence" = EXCLUDED."evidence",
        "vulnerabilityId" = EXCLUDED."vulnerabilityId",
        "title" = EXCLUDED."title",
        "severity" = EXCLUDED."severity",
        "cvssScore" = EXCLUDED."cvssScore",
        "kev" = EXCLUDED."kev",
        "basis" = EXCLUDED."basis",
        "basisHash" = EXCLUDED."basisHash",
        "status" = 'active',
        "retractReason" = NULL,
        "retractedAt" = NULL,
        "lastEvaluatedAt" = EXCLUDED."lastEvaluatedAt"`;
  }

  const stale = existing.filter(
    (match) =>
      match.status === "active" && !desiredKeys.has(`${match.serviceId}|${match.canonicalId}`),
  );
  if (stale.length > 0) {
    const bySubject = new Map(subjects.map((subject) => [subject.serviceId, subject]));
    const reasons = await retractReasons(stale, bySubject, run.enabledSources);
    const rows = JSON.stringify(
      stale.map((match) => ({ id: match.id, reason: reasons.get(match.id) })),
    );
    await prisma.$executeRaw`
      UPDATE "VulnerabilityMatch" AS m
      SET "status" = 'retracted',
          "retractReason" = r."reason"::"VulnerabilityRetractReason",
          "retractedAt" = ${now},
          "lastEvaluatedAt" = ${now}
      FROM jsonb_to_recordset(${rows}::jsonb) AS r("id" uuid, "reason" text)
      WHERE m.id = r.id`;
  }

  return {
    added,
    reactivated,
    updated: desired.length - added - reactivated,
    retracted: stale.length,
  };
}

async function startRun(log: Logger): Promise<MatchRun> {
  const [mappings, sources] = await Promise.all([
    prisma.packageMapping.findMany({
      select: { cpeVendor: true, cpeProduct: true, ecosystem: true, packageName: true },
    }),
    prisma.vulnerabilitySource.findMany({ where: { enabled: true }, select: { id: true } }),
  ]);
  const packages = new Map<string, PackageTarget[]>();
  for (const mapping of mappings) {
    const key = `${mapping.cpeVendor}:${mapping.cpeProduct}`;
    const targets = packages.get(key) ?? [];
    targets.push({ ecosystem: mapping.ecosystem, packageName: mapping.packageName });
    packages.set(key, targets);
  }
  const order = sourceOrder();
  const enabled = sources.map((source) => source.id).filter((id) => order.includes(id));
  return new MatchRun({ packages }, enabled, order, log);
}

/**
 * Re-evaluates the vulnerabilities of services against the mirrored records: new matches are
 * added, ones that hold again come back with their history, the others are retracted with a reason.
 * Pass `"all"` after a sync or a mapping change, service ids after new scan results.
 */
export async function rematch(
  target: "all" | readonly string[],
  log: Logger,
): Promise<RematchStats> {
  const run = await startRun(log);
  const now = new Date();
  const stats: RematchStats = { services: 0, added: 0, reactivated: 0, updated: 0, retracted: 0 };

  const process = async (subjects: ServiceSubject[]) => {
    await run.prepare(subjects);
    const written = await writeChunk(subjects, run, now);
    stats.services += subjects.length;
    stats.added += written.added;
    stats.reactivated += written.reactivated;
    stats.updated += written.updated;
    stats.retracted += written.retracted;
  };

  if (target === "all") {
    for await (const subjects of allSubjects(SERVICE_CHUNK)) await process(subjects);
  } else {
    for (const ids of chunks([...new Set(target)], SERVICE_CHUNK)) {
      await process(await subjectsOf(ids));
    }
  }
  return stats;
}
