import { z } from "zod";

const list = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

// Must match .env.example.
const envSchema = z.object({
  OSV_BASE_URL: z
    .string()
    .regex(/^(https?|file):\/\//, "An http(s):// or file:// URL")
    .default("https://storage.googleapis.com/osv-vulnerabilities"),
  OSV_ECOSYSTEMS: z.string().default("Maven,Go,Packagist,PyPI,Debian,Alpine,npm"),
  // Malicious-package reports, and Debian advisories bundling CVEs that DEBIAN-CVE-* cover anyway.
  OSV_SKIP_PREFIXES: z.string().default("MAL-,DSA-,DLA-,DTSA-"),
  OSV_INCREMENTAL_MAX_RECORDS: z.coerce.number().int().positive().default(2000),
});

const blankAsAbsent = (value: string | undefined) => (value === "" ? undefined : value);

export function osvConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = envSchema.parse({
    OSV_BASE_URL: blankAsAbsent(env.OSV_BASE_URL),
    OSV_ECOSYSTEMS: blankAsAbsent(env.OSV_ECOSYSTEMS),
    OSV_SKIP_PREFIXES: blankAsAbsent(env.OSV_SKIP_PREFIXES),
    OSV_INCREMENTAL_MAX_RECORDS: blankAsAbsent(env.OSV_INCREMENTAL_MAX_RECORDS),
  });
  return {
    baseUrl: config.OSV_BASE_URL.replace(/\/+$/, ""),
    ecosystems: list(config.OSV_ECOSYSTEMS),
    skipPrefixes: list(config.OSV_SKIP_PREFIXES),
    incrementalMaxRecords: config.OSV_INCREMENTAL_MAX_RECORDS,
  };
}

export type OsvConfig = ReturnType<typeof osvConfig>;
