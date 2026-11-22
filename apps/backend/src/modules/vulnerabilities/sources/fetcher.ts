import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

/** Downloads for sources: http(s) into a cache directory, or straight from a `file://` mirror. */
export interface Fetcher {
  /**
   * A local copy of `url`. A `file://` URL is used in place; anything else is downloaded to
   * `cachePath` under the cache directory, which then mirrors the source's layout.
   */
  file(url: string, cachePath: string, signal: AbortSignal): Promise<string>;
  text(url: string, signal: AbortSignal): Promise<string>;
  /** Line by line; stopping the iteration closes the download. */
  lines(url: string, signal: AbortSignal): AsyncIterable<string>;
}

export interface FetcherOptions {
  cacheDir: string;
  /** Tests never reach the network: only `file://` URLs work. */
  allowNetwork: boolean;
  attempts?: number;
}

// A generic client name: no deployment details leave the network.
const USER_AGENT = "SubSurf-vulnerability-sync/1.0";

const isFileUrl = (url: string) => url.startsWith("file://");

export class HttpStatusError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`GET ${url} answered ${status}`);
  }
}

const retryable = (error: unknown) =>
  !(error instanceof HttpStatusError) || error.status >= 500 || error.status === 429;

export function createFetcher(options: FetcherOptions): Fetcher {
  const attempts = options.attempts ?? 3;

  async function request(url: string, signal: AbortSignal): Promise<Response> {
    if (!options.allowNetwork) throw new Error(`Network access is disabled (${url})`);
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await fetch(url, { signal, headers: { "user-agent": USER_AGENT } });
        if (!response.ok) {
          await response.body?.cancel();
          throw new HttpStatusError(url, response.status);
        }
        return response;
      } catch (error) {
        if (signal.aborted || attempt >= attempts || !retryable(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
      }
    }
  }

  return {
    async file(url, cachePath, signal) {
      if (isFileUrl(url)) return fileURLToPath(url);
      const target = join(options.cacheDir, cachePath);
      const partial = `${target}.partial`;
      await mkdir(dirname(target), { recursive: true });
      const response = await request(url, signal);
      if (!response.body) throw new Error(`GET ${url} returned no body`);
      try {
        await pipeline(Readable.fromWeb(response.body), createWriteStream(partial), { signal });
        await rename(partial, target);
      } catch (error) {
        await rm(partial, { force: true });
        throw error;
      }
      return target;
    },

    async text(url, signal) {
      if (isFileUrl(url)) return readFile(fileURLToPath(url), "utf8");
      return (await request(url, signal)).text();
    },

    async *lines(url, signal) {
      const controller = new AbortController();
      const onAbort = () => controller.abort(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        const input = isFileUrl(url)
          ? createReadStream(fileURLToPath(url))
          : Readable.fromWeb((await request(url, controller.signal)).body!);
        const reader = createInterface({ input, crlfDelay: Infinity });
        try {
          for await (const line of reader) yield line;
        } finally {
          reader.close();
          input.destroy();
        }
      } finally {
        controller.abort();
        signal.removeEventListener("abort", onAbort);
      }
    },
  };
}
