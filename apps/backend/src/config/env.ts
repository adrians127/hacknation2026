import { existsSync } from "node:fs";

import { z } from "zod";

import { isPortSpecWithin } from "@subsurf/contracts/scans/port-spec";
import { PortSpecSchema } from "@subsurf/contracts/scans/scans.schema";

import {
  buildDatabaseUrl,
  DB_SSL_MODES,
  DEFAULT_DB_PORT,
  DEFAULT_DB_SSLMODE,
} from "~backend/config/database-url";

// Containers pass an unset variable through as an empty string; treat it as absent.
const blankAsAbsent = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

// Must match .env.example; production refuses to start with these public values.
const EXAMPLE_JWT_SECRET = "dev-only-jwt-secret-change-me-in-production";
const EXAMPLE_ADMIN_PASSWORD = "admin-change-me-now";
const EXAMPLE_DATA_ENCRYPTION_KEY = "ZGV2LW9ubHktZGF0YS1rZXktY2hhbmdlLW1lLTAwMDA=";
const EXAMPLE_WORKER_TOKEN = "dev-only-worker-token-change-me";

// Must match .env.example.
const DEFAULT_SCAN_PORTS =
  "21,22,23,25,53,80,110,111,135,139,143,443,445,993,995,1433,1521,2049,3306,3389,5432,5900,6379,8000,8080,8443,9200,27017";

const isPowerOfTwo = (value: number) => Number.isInteger(Math.log2(value));

// Real environment variables win over `.env` (Node does not override them).
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: blankAsAbsent(z.coerce.number().int().positive().default(3001)),
    LOG_LEVEL: z
      .enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"])
      .default("info"),
    CORS_ORIGIN: z.string().min(1).default("http://localhost:3000"),

    // Postgres as discrete parts; see config/database-url.ts.
    DB_HOST: z.string().min(1),
    DB_PORT: blankAsAbsent(z.coerce.number().int().positive().default(DEFAULT_DB_PORT)),
    DB_NAME: z.string().min(1),
    DB_USER: z.string().min(1),
    DB_PASSWORD: z.string().min(1),
    DB_SSLMODE: blankAsAbsent(z.enum(DB_SSL_MODES).default(DEFAULT_DB_SSLMODE)),

    // HS256 key for access tokens (src/lib/tokens.ts).
    JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),

    // AES-256-GCM key for sensitive fields encrypted at rest (src/lib/crypto.ts).
    DATA_ENCRYPTION_KEY: z
      .base64()
      .refine((value) => Buffer.from(value, "base64").length === 32, {
        message: "DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded",
      }),

    // Bearer token of the scan workers on /workers/* (src/middleware/worker-token.ts). Unset:
    // those endpoints answer 503.
    WORKER_TOKEN: blankAsAbsent(
      z.string().min(16, "WORKER_TOKEN must be at least 16 characters").optional(),
    ),

    // First admin, created at startup while there are no users (and by the seed).
    ADMIN_EMAIL: blankAsAbsent(z.email().optional()),
    ADMIN_PASSWORD: blankAsAbsent(z.string().min(12).max(128).optional()),

    // Snapshotted onto every queued scan (src/modules/scans).
    SCAN_DEFAULT_PORTS: blankAsAbsent(PortSpecSchema.default(DEFAULT_SCAN_PORTS)),
    SCAN_DEFAULT_MAX_RATE: blankAsAbsent(z.coerce.number().int().positive().max(100_000).default(100)),
    // At most 1024: the Nmap job contract caps a job at 1024 targets.
    SCAN_BATCH_SIZE: blankAsAbsent(
      z.coerce
        .number()
        .int()
        .min(16)
        .max(1024)
        .refine(isPowerOfTwo, "SCAN_BATCH_SIZE must be a power of two")
        .default(256),
    ),
    SCAN_ALLOWED_PORTS: blankAsAbsent(PortSpecSchema.default("1-65535")),
    SCAN_JOB_MAX_ATTEMPTS: blankAsAbsent(z.coerce.number().int().min(1).max(20).default(3)),

    PIPELINE_SCHEDULER_ENABLED: blankAsAbsent(z.stringbool().default(true)),
    PIPELINE_SCHEDULER_TICK_SECONDS: blankAsAbsent(
      z.coerce.number().int().min(1).max(3600).default(15),
    ),
    WORKER_LEASE_GRACE_SECONDS: blankAsAbsent(
      z.coerce.number().int().min(10).max(86_400).default(300),
    ),
    WORKER_LEASE_JOBS_PER_SLOT: blankAsAbsent(z.coerce.number().int().min(1).max(64).default(2)),

    // Vulnerability databases (src/modules/vulnerabilities): used by the vuln-sync process and,
    // for the sources' state and links, by the API. Source-specific settings live next to each
    // source (nvd.config.ts, osv.config.ts).
    VULN_SOURCES: blankAsAbsent(
      z
        .string()
        .regex(/^[a-z0-9-]+(,[a-z0-9-]+)*$/, "Comma-separated source ids, e.g. nvd,osv")
        .default("nvd,osv"),
    ),
    VULN_SYNC_INTERVAL_HOURS: blankAsAbsent(z.coerce.number().positive().max(24 * 7).default(8)),
    VULN_FULL_SYNC_INTERVAL_DAYS: blankAsAbsent(z.coerce.number().positive().max(90).default(7)),
    VULN_SYNC_POLL_SECONDS: blankAsAbsent(z.coerce.number().int().min(5).max(3600).default(30)),
    // A full sync that would withdraw more than this share of a source's records stops instead.
    VULN_SWEEP_MAX_RATIO: blankAsAbsent(z.coerce.number().min(0).max(1).default(0.05)),
    // Downloads land here, in the sources' own layout: the directory doubles as an offline mirror.
    VULN_CACHE_DIR: blankAsAbsent(z.string().min(1).default(".cache/vulnerabilities")),
  })
  .refine((value) => isPortSpecWithin(value.SCAN_DEFAULT_PORTS, value.SCAN_ALLOWED_PORTS), {
    path: ["SCAN_DEFAULT_PORTS"],
    message: "SCAN_DEFAULT_PORTS must stay within SCAN_ALLOWED_PORTS",
  })
  .refine((value) => value.NODE_ENV !== "production" || value.JWT_SECRET !== EXAMPLE_JWT_SECRET, {
    path: ["JWT_SECRET"],
    message: "Set a real JWT_SECRET in production (the .env.example value is public)",
  })
  .refine(
    (value) =>
      value.NODE_ENV !== "production" || value.DATA_ENCRYPTION_KEY !== EXAMPLE_DATA_ENCRYPTION_KEY,
    {
      path: ["DATA_ENCRYPTION_KEY"],
      message: "Set a real DATA_ENCRYPTION_KEY in production (the .env.example value is public)",
    },
  )
  .refine(
    (value) => value.NODE_ENV !== "production" || value.WORKER_TOKEN !== EXAMPLE_WORKER_TOKEN,
    {
      path: ["WORKER_TOKEN"],
      message: "Set a real WORKER_TOKEN in production (the .env.example value is public)",
    },
  )
  .refine(
    (value) => value.NODE_ENV !== "production" || value.ADMIN_PASSWORD !== EXAMPLE_ADMIN_PASSWORD,
    {
      path: ["ADMIN_PASSWORD"],
      message: "Set a real ADMIN_PASSWORD in production (the .env.example value is public)",
    },
  )
  // camelCase on purpose: derived here, not read from the environment.
  .transform((value) => ({ ...value, databaseUrl: buildDatabaseUrl(value) }));

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // No logger yet (the logger depends on this module), so go straight to stderr.
  console.error("Invalid environment variables:\n", z.prettifyError(parsed.error));
  if (process.env.NODE_ENV !== "production") {
    console.error("\nNew variable in .env.example? `pnpm project:setup` adds it to your .env.");
  }
  process.exit(1);
}

export const env = Object.freeze(parsed.data);

/** Local-laptop mode: pretty logs, Swagger UI and stack traces in error responses. */
export const isDevelopment = env.NODE_ENV === "development";

export type Env = typeof env;
