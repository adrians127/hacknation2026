import { execSync } from "node:child_process";

import pg from "pg";

import { TEST_DATABASE_NAME, TEST_ENV } from "./test-env";

/** Creates the test database when missing and applies all migrations to it. */
export default async function globalSetup(): Promise<void> {
  const admin = new pg.Client({
    host: TEST_ENV.DB_HOST,
    port: Number(TEST_ENV.DB_PORT),
    user: TEST_ENV.DB_USER,
    password: TEST_ENV.DB_PASSWORD,
    database: "postgres",
  });

  try {
    await admin.connect();
  } catch (error) {
    throw new Error(
      `Backend tests need PostgreSQL at ${TEST_ENV.DB_HOST}:${TEST_ENV.DB_PORT}. Start it with \`pnpm db:up\`.`,
      { cause: error },
    );
  }

  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      TEST_DATABASE_NAME,
    ]);
    if (existing.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${TEST_DATABASE_NAME}"`);
    }
  } finally {
    await admin.end();
  }

  // prisma.config.ts builds the URL from DB_*; real env vars win over .env.
  // A shell command, so Windows finds `prisma.cmd`; the string is constant.
  execSync("prisma migrate deploy", {
    env: { ...process.env, ...TEST_ENV },
    stdio: "ignore",
  });
}
