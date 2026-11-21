import { existsSync } from "node:fs";

import { defineConfig } from "prisma/config";

import { databaseUrlFromEnv } from "./src/config/database-url";

// The Prisma CLI runs in its own process, so it loads `.env` itself (real env vars win).
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

// `prisma generate` runs on every install and never connects, so a placeholder
// keeps fresh clones and CI green; migrate/studio fail clearly against it.
const url =
  databaseUrlFromEnv() ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder";

export default defineConfig({
  // Every *.prisma under prisma/schema/ is merged into one schema.
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
    // Prisma 7 no longer seeds after `migrate reset`, hence `db:reset` chains `db seed`.
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url,
  },
});
