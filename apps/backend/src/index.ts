import { buildApp } from "~backend/app";
import { env } from "~backend/config/env";
import { logger } from "~backend/lib/logger";
import { prisma } from "~backend/lib/prisma";

const app = buildApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, `Server listening on :${env.PORT}`);
});

// Non-fatal: keep serving (and reporting `database: down` on /v1/health) rather than crash-loop.
prisma.$queryRaw`SELECT 1`
  .then(() => logger.info("Database connection OK"))
  .catch((err: unknown) => logger.error({ err }, "Database connection failed at startup"));

function shutdown(signal: string): void {
  logger.info({ signal }, "Shutting down");
  server.close((err) => {
    if (err) {
      logger.error({ err }, "Error during shutdown");
      process.exit(1);
    }
    prisma
      .$disconnect()
      .catch((disconnectErr: unknown) =>
        logger.error({ err: disconnectErr }, "Error disconnecting Prisma"),
      )
      .finally(() => process.exit(0));
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
