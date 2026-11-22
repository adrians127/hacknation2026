import { readFile } from "node:fs/promises";

import { z } from "zod";

import { chunks } from "~backend/lib/chunks";
import { HttpStatusError } from "~backend/modules/vulnerabilities/sources/fetcher";
import {
  osvConfig,
  type OsvConfig,
} from "~backend/modules/vulnerabilities/sources/osv/osv.config";
import {
  normalizeOsvRecord,
  parseOsvRecord,
  splitEcosystem,
} from "~backend/modules/vulnerabilities/sources/osv/osv.parser";
import { readZipJson } from "~backend/modules/vulnerabilities/sources/osv/osv.zip";
import type {
  NormalizedVulnerability,
  SourceEvent,
  SyncContext,
  VulnerabilitySource,
} from "~backend/modules/vulnerabilities/sources/source";

const OsvCursorSchema = z.object({
  /** Per ecosystem: the newest `modified` already applied (modified_id.csv timestamps). */
  ecosystems: z.record(z.string(), z.string()),
  at: z.iso.datetime(),
});

const FETCH_CONCURRENCY = 8;

interface Changes {
  ids: string[];
  newest: string | null;
  tooMany: boolean;
}

/** OSV.dev's bulk export: `<ecosystem>/all.zip`, plus `<ecosystem>/modified_id.csv` for changes. */
export function createOsvSource(config: OsvConfig = osvConfig()): VulnerabilitySource {
  const skipped = (id: string) => config.skipPrefixes.some((prefix) => id.startsWith(prefix));
  const keep = (fileName: string) => !skipped(fileName);
  const offline = config.baseUrl.startsWith("file://");
  const ecosystemUrl = (ecosystem: string) =>
    `${config.baseUrl}/${encodeURIComponent(ecosystem)}`;

  const toRecord = (text: string): NormalizedVulnerability | null => {
    const record = parseOsvRecord(text);
    if (!record || skipped(record.id)) return null;
    const raw = record.affected?.find((entry) => entry.package)?.package?.ecosystem;
    return normalizeOsvRecord(record, raw ? splitEcosystem(raw).ecosystem : "imported");
  };

  async function* wholeEcosystem(
    context: SyncContext,
    ecosystem: string,
  ): AsyncGenerator<SourceEvent, string | null> {
    const path = await context.fetcher.file(
      `${ecosystemUrl(ecosystem)}/all.zip`,
      `osv/${ecosystem}/all.zip`,
      context.signal,
    );
    let newest: string | null = null;
    let invalid = 0;
    for await (const text of readZipJson(path, keep, context.signal)) {
      const record = parseOsvRecord(text);
      if (!record) {
        invalid++;
        continue;
      }
      if (newest === null || Date.parse(record.modified) > Date.parse(newest)) {
        newest = record.modified;
      }
      yield { type: "upsert", record: normalizeOsvRecord(record, ecosystem) };
    }
    // Unreadable records count as unseen: a full sync would withdraw them (or refuse to).
    if (invalid > 0) context.log.warn({ ecosystem, invalid }, "Unreadable OSV records");
    context.log.info({ ecosystem }, "OSV ecosystem read");
    return newest;
  }

  /** modified_id.csv is newest first: read until the cursor. */
  async function changesSince(context: SyncContext, ecosystem: string, since: string) {
    const changes: Changes = { ids: [], newest: null, tooMany: false };
    const sinceTime = Date.parse(since);
    for await (const line of context.fetcher.lines(
      `${ecosystemUrl(ecosystem)}/modified_id.csv`,
      context.signal,
    )) {
      const [timestamp, path] = line.split(",");
      if (!timestamp || !path) continue;
      if (Date.parse(timestamp) <= sinceTime) break;
      changes.newest ??= timestamp;
      const id = path.trim().split("/").at(-1);
      if (!id || skipped(id)) continue;
      changes.ids.push(id);
      if (changes.ids.length > config.incrementalMaxRecords) {
        changes.tooMany = true;
        break;
      }
    }
    return changes;
  }

  async function* changedRecords(
    context: SyncContext,
    ecosystem: string,
    ids: string[],
  ): AsyncGenerator<SourceEvent> {
    for (const batch of chunks([...new Set(ids)], FETCH_CONCURRENCY)) {
      const texts = await Promise.all(
        batch.map(async (id) => {
          try {
            return await context.fetcher.text(
              `${ecosystemUrl(ecosystem)}/${encodeURIComponent(id)}.json`,
              context.signal,
            );
          } catch (error) {
            // Gone from the export: the weekly full sync withdraws it.
            if (error instanceof HttpStatusError && error.status === 404) return null;
            throw error;
          }
        }),
      );
      for (const text of texts) {
        const record = text === null ? null : parseOsvRecord(text);
        if (record) yield { type: "upsert", record: normalizeOsvRecord(record, ecosystem) };
      }
    }
  }

  return {
    id: "osv",
    displayName: "OSV.dev",
    baseUrl: config.baseUrl,
    scopes: config.ecosystems,

    detailUrl: (externalId) => `https://osv.dev/vulnerability/${encodeURIComponent(externalId)}`,

    async *sync(context) {
      const cursor = OsvCursorSchema.safeParse(context.cursor);
      const state: Record<string, string> = cursor.success ? { ...cursor.data.ecosystems } : {};

      for (const ecosystem of config.ecosystems) {
        const since = state[ecosystem];
        // A mirror directory has no per-record files: an incremental run re-reads the zip.
        if (context.mode === "full" || since === undefined || offline) {
          const newest = yield* wholeEcosystem(context, ecosystem);
          if (context.mode === "full") yield { type: "scopeCompleted", scope: ecosystem };
          if (newest) state[ecosystem] = newest;
        } else {
          const changes = await changesSince(context, ecosystem, since);
          if (changes.tooMany) {
            context.log.info({ ecosystem }, "Many OSV changes: reading the whole ecosystem");
            const newest = yield* wholeEcosystem(context, ecosystem);
            if (newest) state[ecosystem] = newest;
          } else {
            context.log.info({ ecosystem, changed: changes.ids.length }, "OSV changes");
            yield* changedRecords(context, ecosystem, changes.ids);
            if (changes.newest) state[ecosystem] = changes.newest;
          }
        }
        yield {
          type: "checkpoint",
          cursor: { ecosystems: state, at: context.now.toISOString() },
        };
      }
    },

    async *importFile(path, signal) {
      if (path.endsWith(".zip")) {
        for await (const text of readZipJson(path, () => true, signal)) {
          const record = toRecord(text);
          if (record) yield record;
        }
        return;
      }
      // One record, or an array of them (the demo data).
      const text = await readFile(path, "utf8");
      const parsed: unknown = JSON.parse(text);
      const texts = Array.isArray(parsed) ? parsed.map((item) => JSON.stringify(item)) : [text];
      for (const item of texts) {
        const record = toRecord(item);
        if (record) yield record;
      }
    },
  };
}
