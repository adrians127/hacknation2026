import type { Logger } from "pino";

import type {
  SyncMode,
  VulnerabilitySeverity,
} from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";

import type { Criterion } from "~backend/modules/vulnerabilities/matchers/matcher";
import type { Fetcher } from "~backend/modules/vulnerabilities/sources/fetcher";

/** One record of a source in the shape every source produces and the database stores. */
export interface NormalizedVulnerability {
  externalId: string;
  /** CVE id when there is one (see `canonicalIdOf`). */
  canonicalId: string;
  aliases: string[];
  /** The part of the source the record came from (an OSV ecosystem); empty for NVD. */
  scopes: string[];
  title: string | null;
  description: string | null;
  status: "active" | "rejected" | "withdrawn";
  withdrawnAt: Date | null;
  severity: VulnerabilitySeverity;
  cvssScore: number | null;
  cvssVector: string | null;
  cvssVersion: string | null;
  kevAddedAt: Date | null;
  kevDueDate: Date | null;
  references: string[];
  publishedAt: Date | null;
  sourceModifiedAt: Date | null;
  criteria: Criterion[];
}

export type SourceEvent =
  | { type: "upsert"; record: NormalizedVulnerability }
  /** Everything before this point is stored; the cursor can move here. */
  | { type: "checkpoint"; cursor: unknown }
  /** Full runs only: every record of `scope` (null = the whole source) has been seen. */
  | { type: "scopeCompleted"; scope: string | null }
  /** An incremental run cannot catch up (e.g. the change feed no longer reaches back enough). */
  | { type: "needsFull"; reason: string };

export interface SyncContext {
  mode: SyncMode;
  /** What the last checkpoint stored; `null` before the first run. Shape owned by the source. */
  cursor: unknown;
  signal: AbortSignal;
  fetcher: Fetcher;
  log: Logger;
  now: Date;
}

/**
 * A vulnerability database mirrored into ours. Adding one: implement this, list it in
 * `registry.ts`, and emit criteria of an existing kind (`cpe`, `package`) or add a matcher.
 */
export interface VulnerabilitySource {
  /** Stable: the `VulnerabilitySource` row id. */
  readonly id: string;
  readonly displayName: string;
  /** Where it downloads from, for the admin panel. */
  readonly baseUrl: string;
  /** Parts synced separately (OSV ecosystems); empty when the source is one whole. */
  readonly scopes: readonly string[];
  detailUrl(externalId: string): string;
  sync(context: SyncContext): AsyncIterable<SourceEvent>;
  /** Records in a file in the source's own format (offline import, demo data). */
  importFile(path: string, signal: AbortSignal): AsyncIterable<NormalizedVulnerability>;
}
