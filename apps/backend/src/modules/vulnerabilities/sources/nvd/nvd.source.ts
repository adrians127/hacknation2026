import { readFile } from "node:fs/promises";

import { z } from "zod";

import { HttpStatusError } from "~backend/modules/vulnerabilities/sources/fetcher";
import {
  nvdConfig,
  type NvdConfig,
} from "~backend/modules/vulnerabilities/sources/nvd/nvd.config";
import {
  normalizeNvdCve,
  readNvdFeed,
} from "~backend/modules/vulnerabilities/sources/nvd/nvd.parser";
import type {
  SourceEvent,
  SyncContext,
  VulnerabilitySource,
} from "~backend/modules/vulnerabilities/sources/source";

const NvdCursorSchema = z.object({
  /** Checksum of the `modified` feed last applied: unchanged means nothing to do. */
  metaSha256: z.string().nullable(),
  lastModified: z.string().nullable(),
  /** When the data was last brought up to date. */
  at: z.iso.datetime(),
});

type NvdCursor = z.infer<typeof NvdCursorSchema>;

// The `modified` feed covers the last 8 days; keep a day of margin.
const MODIFIED_FEED_REACH_MS = 7 * 24 * 60 * 60 * 1000;

interface FeedMeta {
  sha256: string;
  lastModifiedDate: string | null;
}

function parseMeta(text: string): FeedMeta {
  const fields = new Map(
    text
      .split(/\r?\n/)
      .map((line) => line.split(/:(.*)/s))
      .filter((parts) => parts.length >= 2)
      .map(([key, value]) => [key.trim(), value.trim()]),
  );
  const sha256 = fields.get("sha256");
  if (!sha256) throw new Error("NVD feed .meta has no sha256");
  return { sha256, lastModifiedDate: fields.get("lastModifiedDate") ?? null };
}

/** NVD's JSON 2.0 data feeds: one file per CVE year, plus `modified` (the last 8 days). */
export function createNvdSource(config: NvdConfig = nvdConfig()): VulnerabilitySource {
  async function feedMeta(context: SyncContext, name: string): Promise<FeedMeta> {
    const path = await context.fetcher.file(
      `${config.feedUrl}/${name}.meta`,
      `nvd/${name}.meta`,
      context.signal,
    );
    return parseMeta(await readFile(path, "utf8"));
  }

  async function* feed(context: SyncContext, name: string): AsyncGenerator<SourceEvent, FeedMeta> {
    const meta = await feedMeta(context, name);
    const path = await context.fetcher.file(
      `${config.feedUrl}/${name}.json.gz`,
      `nvd/${name}.json.gz`,
      context.signal,
    );
    let invalid = 0;
    let example: string | undefined;
    const onInvalid = (error: z.ZodError) => {
      invalid++;
      example ??= z.prettifyError(error);
    };
    for await (const cve of readNvdFeed(path, context.signal, meta.sha256, onInvalid)) {
      yield { type: "upsert", record: normalizeNvdCve(cve) };
    }
    // Unreadable records count as unseen: a full sync would withdraw them (or refuse to).
    if (invalid > 0) context.log.warn({ feed: name, invalid, example }, "Unreadable NVD records");
    return meta;
  }

  async function* modified(context: SyncContext): AsyncGenerator<SourceEvent> {
    const meta = yield* feed(context, "nvdcve-2.0-modified");
    const cursor: NvdCursor = {
      metaSha256: meta.sha256,
      lastModified: meta.lastModifiedDate,
      at: context.now.toISOString(),
    };
    yield { type: "checkpoint", cursor };
  }

  return {
    id: "nvd",
    displayName: "NVD",
    baseUrl: config.feedUrl,
    scopes: [],

    detailUrl: (externalId) => `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(externalId)}`,

    async *sync(context) {
      if (context.mode === "incremental") {
        const cursor = NvdCursorSchema.safeParse(context.cursor);
        if (!cursor.success) {
          yield { type: "needsFull", reason: "No full sync yet" };
          return;
        }
        if (context.now.getTime() - Date.parse(cursor.data.at) > MODIFIED_FEED_REACH_MS) {
          yield { type: "needsFull", reason: "The last sync is older than the modified feed" };
          return;
        }
        const meta = await feedMeta(context, "nvdcve-2.0-modified");
        if (meta.sha256 === cursor.data.metaSha256) {
          context.log.info("NVD modified feed unchanged since the last sync");
          yield { type: "checkpoint", cursor: { ...cursor.data, at: context.now.toISOString() } };
          return;
        }
        yield* modified(context);
        return;
      }

      const lastYear = context.now.getUTCFullYear();
      for (let year = config.firstYear; year <= lastYear; year++) {
        try {
          yield* feed(context, `nvdcve-2.0-${year}`);
        } catch (error) {
          // A new year's file appears some time after New Year.
          if (year === lastYear && error instanceof HttpStatusError && error.status === 404) {
            context.log.warn({ year }, "NVD has no feed for this year yet");
            continue;
          }
          throw error;
        }
        context.log.info({ year }, "NVD year feed read");
      }
      yield { type: "scopeCompleted", scope: null };
      // The year files are rebuilt daily; `modified` brings the last hours and sets the cursor.
      yield* modified(context);
    },

    async *importFile(path, signal) {
      for await (const cve of readNvdFeed(path, signal)) yield normalizeNvdCve(cve);
    },
  };
}
