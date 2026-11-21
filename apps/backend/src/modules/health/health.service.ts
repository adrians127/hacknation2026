import type { HealthResponse } from "@subsurf/contracts/health/health.schema";

import { prisma } from "~backend/lib/prisma";

const DB_PROBE_TIMEOUT_MS = 2_000;

async function isDatabaseUp(): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("DB probe timed out")), DB_PROBE_TIMEOUT_MS);
  });
  try {
    await Promise.race([prisma.$queryRaw`SELECT 1`, timeout]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export const healthService = {
  async getStatus(): Promise<HealthResponse> {
    const databaseUp = await isDatabaseUp();
    return {
      status: databaseUp ? "ok" : "degraded",
      database: databaseUp ? "up" : "down",
      version: process.env.npm_package_version ?? "0.0.0",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  },
};
