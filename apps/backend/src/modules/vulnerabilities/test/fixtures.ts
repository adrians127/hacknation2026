import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { pino } from "pino";
import { ZipFile } from "yazl";

import type { Fetcher } from "~backend/modules/vulnerabilities/sources/fetcher";
import { HttpStatusError } from "~backend/modules/vulnerabilities/sources/fetcher";
import type {
  NormalizedVulnerability,
  SourceEvent,
  SyncContext,
  VulnerabilitySource,
} from "~backend/modules/vulnerabilities/sources/source";

/** Serves URLs from memory; `file()` writes them to a temporary directory first. */
export class FakeFetcher implements Fetcher {
  readonly requests: string[] = [];
  private readonly files = new Map<string, Buffer>();
  private dir: Promise<string> | undefined;

  set(url: string, content: string | Buffer): this {
    this.files.set(url, typeof content === "string" ? Buffer.from(content) : content);
    return this;
  }

  private get(url: string): Buffer {
    this.requests.push(url);
    const content = this.files.get(url);
    if (!content) throw new HttpStatusError(url, 404);
    return content;
  }

  async file(url: string, cachePath: string): Promise<string> {
    const content = this.get(url);
    this.dir ??= mkdtemp(join(tmpdir(), "subsurf-fetcher-"));
    const path = join(await this.dir, cachePath.replaceAll("/", "_"));
    await writeFile(path, content);
    return path;
  }

  async text(url: string): Promise<string> {
    return this.get(url).toString("utf8");
  }

  async *lines(url: string): AsyncIterable<string> {
    yield* this.get(url).toString("utf8").split("\n");
  }
}

export function syncContext(
  fetcher: Fetcher,
  overrides: Partial<SyncContext> = {},
): SyncContext {
  return {
    mode: "full",
    cursor: null,
    signal: new AbortController().signal,
    fetcher,
    log: pino({ level: "silent" }),
    now: new Date("2026-11-21T12:00:00Z"),
    ...overrides,
  };
}

export async function collect(
  source: VulnerabilitySource,
  context: SyncContext,
): Promise<SourceEvent[]> {
  const events: SourceEvent[] = [];
  for await (const event of source.sync(context)) events.push(event);
  return events;
}

/** An NVD JSON 2.0 feed file (gzipped) and its `.meta`, as nvd.nist.gov serves them. */
export function nvdFeed(cves: object[], lastModified = "2026-11-21T10:00:00-05:00") {
  const json = JSON.stringify({
    resultsPerPage: cves.length,
    format: "NVD_CVE",
    version: "2.0",
    vulnerabilities: cves.map((cve) => ({ cve })),
  });
  const sha256 = createHash("sha256").update(json).digest("hex").toUpperCase();
  return {
    gz: gzipSync(json),
    meta: `lastModifiedDate:${lastModified}\r\nsize:${json.length}\r\nsha256:${sha256}\r\n`,
  };
}

/** A zip of OSV records named `<id>.json`, like the export's `all.zip`. */
export async function osvZip(records: { id: string }[]): Promise<Buffer> {
  const zip = new ZipFile();
  for (const record of records) {
    zip.addBuffer(Buffer.from(JSON.stringify(record)), `${record.id}.json`);
  }
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** CVE-2024-6387 (regreSSHion), trimmed to what the parser reads. */
export const REGRESSHION = {
  id: "CVE-2024-6387",
  published: "2024-07-01T13:15:01.633",
  lastModified: "2026-06-16T21:47:34.460",
  vulnStatus: "Modified",
  descriptions: [
    { lang: "en", value: "A signal handler race condition was found in OpenSSH's server (sshd)." },
  ],
  metrics: {
    cvssMetricV31: [
      {
        source: "secalert@redhat.com",
        type: "Secondary",
        cvssData: {
          version: "3.1",
          vectorString: "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H",
          baseScore: 8.1,
          baseSeverity: "HIGH",
        },
      },
    ],
    // Since 2026 NVD also lists SSVC decisions here, with no CVSS data.
    ssvcV203: [{ source: "134c704f-9b21-4f2e-91b3-4a467353bcc0", type: "Secondary", ssvcData: {} }],
  },
  configurations: [
    {
      nodes: [
        {
          operator: "OR",
          negate: false,
          cpeMatch: [
            {
              vulnerable: true,
              criteria: "cpe:2.3:a:openbsd:openssh:*:*:*:*:*:*:*:*",
              versionEndExcluding: "4.4",
            },
            {
              vulnerable: true,
              criteria: "cpe:2.3:a:openbsd:openssh:*:*:*:*:*:*:*:*",
              versionStartIncluding: "8.5",
              versionEndExcluding: "9.8",
            },
            { vulnerable: true, criteria: "cpe:2.3:a:openbsd:openssh:4.4:-:*:*:*:*:*:*" },
            { vulnerable: true, criteria: "cpe:2.3:a:openbsd:openssh:4.4:p1:*:*:*:*:*:*" },
          ],
        },
      ],
    },
    {
      operator: "AND",
      nodes: [
        {
          operator: "OR",
          negate: false,
          cpeMatch: [
            { vulnerable: true, criteria: "cpe:2.3:o:netapp:ontap:-:*:*:*:*:*:*:*" },
          ],
        },
        {
          operator: "OR",
          negate: false,
          cpeMatch: [{ vulnerable: false, criteria: "cpe:2.3:h:netapp:a250:-:*:*:*:*:*:*:*" }],
        },
      ],
    },
  ],
  references: [{ url: "https://www.openssh.com/txt/release-9.8" }],
};

/** CVE-2014-9222 (Misfortune Cookie): in CISA KEV, NVD's own score. */
export const MISFORTUNE_COOKIE = {
  id: "CVE-2014-9222",
  published: "2014-12-24T18:59:00.067",
  lastModified: "2025-04-12T10:46:40.837",
  vulnStatus: "Analyzed",
  descriptions: [
    {
      lang: "en",
      value: "AllegroSoft RomPager 4.34 and earlier allows remote attackers to gain privileges.",
    },
  ],
  metrics: {
    cvssMetricV31: [
      {
        type: "Primary",
        cvssData: {
          version: "3.1",
          vectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
          baseScore: 9.8,
          baseSeverity: "CRITICAL",
        },
      },
    ],
  },
  configurations: [
    {
      nodes: [
        {
          operator: "OR",
          cpeMatch: [
            {
              vulnerable: true,
              criteria: "cpe:2.3:a:allegrosoft:rompager:*:*:*:*:*:*:*:*",
              versionEndIncluding: "4.34",
            },
          ],
        },
      ],
    },
  ],
  references: [],
  cisaExploitAdd: "2022-03-28",
  cisaActionDue: "2022-04-18",
  cisaVulnerabilityName: "AllegroSoft RomPager Authentication Bypass Vulnerability",
};

export const REJECTED = {
  id: "CVE-2024-99999",
  lastModified: "2026-11-01T00:00:00.000",
  vulnStatus: "Rejected",
  descriptions: [{ lang: "en", value: "** REJECT ** Duplicate." }],
};

/** DEBIAN-CVE-2023-48795 (Terrapin): the CVE is only in `upstream`. */
export const TERRAPIN_DEBIAN = {
  id: "DEBIAN-CVE-2023-48795",
  modified: "2026-10-01T00:00:00Z",
  published: "2023-12-18T16:15:10Z",
  upstream: ["CVE-2023-48795"],
  summary: "The SSH transport protocol with certain OpenSSH extensions allows prefix truncation",
  severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:H/A:N" }],
  affected: [
    {
      package: { ecosystem: "Debian:12", name: "openssh" },
      ranges: [
        { type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "1:9.2p1-2+deb12u2" }] },
      ],
      versions: ["1:9.2p1-2", "1:9.2p1-2+deb12u1"],
    },
    {
      package: { ecosystem: "Debian:13", name: "openssh" },
      ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "1:9.6p1-1" }] }],
    },
  ],
};

/** A GHSA for Jetty with a CVSS 4.0 vector. */
export const JETTY_GHSA = {
  id: "GHSA-g8m5-722r-8whq",
  modified: "2026-09-01T00:00:00Z",
  published: "2024-10-14T15:14:58Z",
  aliases: ["CVE-2024-6763"],
  summary: "Jetty URI parsing of invalid authority",
  severity: [
    { type: "CVSS_V4", score: "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:L/VA:N/SC:N/SI:N/SA:N" },
  ],
  affected: [
    {
      package: { ecosystem: "Maven", name: "org.eclipse.jetty:jetty-http" },
      ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "7.0.0" }, { fixed: "12.0.12" }] }],
    },
  ],
  database_specific: { severity: "LOW" },
};

/** A normalized record with one CPE criterion (OpenSSH before 9.8), changed by `overrides`. */
export function vulnerabilityRecord(
  externalId: string,
  overrides: Partial<NormalizedVulnerability> = {},
): NormalizedVulnerability {
  return {
    externalId,
    canonicalId: externalId,
    aliases: [],
    scopes: [],
    title: null,
    description: `${externalId} description`,
    status: "active",
    withdrawnAt: null,
    severity: "high",
    cvssScore: 7.5,
    cvssVector: null,
    cvssVersion: null,
    kevAddedAt: null,
    kevDueDate: null,
    references: [],
    publishedAt: null,
    sourceModifiedAt: new Date("2026-01-01T00:00:00Z"),
    criteria: [
      {
        kind: "cpe",
        matchKey: "cpe:a:openbsd:openssh",
        data: { conditions: [{ endExcluding: "9.8" }] },
      },
    ],
    ...overrides,
  };
}
