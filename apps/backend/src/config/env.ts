import { existsSync } from "node:fs";

import { z } from "zod";

import {
  buildDatabaseUrl,
  DB_SSL_MODES,
  DEFAULT_DB_PORT,
  DEFAULT_DB_SSLMODE,
} from "~backend/config/database-url";

// Containers pass an unset variable through as an empty string; treat it as absent.
const blankAsAbsent = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

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
  })
  // camelCase on purpose: derived here, not read from the environment.
  .transform((value) => ({ ...value, databaseUrl: buildDatabaseUrl(value) }));

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // No logger yet (the logger depends on this module), so go straight to stderr.
  console.error("Invalid environment variables:\n", z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = Object.freeze(parsed.data);

/** Local-laptop mode: pretty logs, Swagger UI and stack traces in error responses. */
export const isDevelopment = env.NODE_ENV === "development";

export type Env = typeof env;
