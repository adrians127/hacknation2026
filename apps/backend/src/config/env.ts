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

// Must match .env.example; production refuses to start with these public values.
const EXAMPLE_JWT_SECRET = "dev-only-jwt-secret-change-me-in-production";
const EXAMPLE_ADMIN_PASSWORD = "admin-change-me-now";

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

    // First admin, created at startup while there are no users (and by the seed).
    ADMIN_EMAIL: blankAsAbsent(z.email().optional()),
    ADMIN_PASSWORD: blankAsAbsent(z.string().min(12).max(128).optional()),
  })
  .refine((value) => value.NODE_ENV !== "production" || value.JWT_SECRET !== EXAMPLE_JWT_SECRET, {
    path: ["JWT_SECRET"],
    message: "Set a real JWT_SECRET in production (the .env.example value is public)",
  })
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
  process.exit(1);
}

export const env = Object.freeze(parsed.data);

/** Local-laptop mode: pretty logs, Swagger UI and stack traces in error responses. */
export const isDevelopment = env.NODE_ENV === "development";

export type Env = typeof env;
