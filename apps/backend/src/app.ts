import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";

import { env, isDevelopment } from "~backend/config/env";
import { buildApiDocs } from "~backend/lib/api-docs";
import { requestLogger } from "~backend/lib/logger";
import { errorHandler } from "~backend/middleware/error-handler";
import { notFound } from "~backend/middleware/not-found";
import { apiRouter } from "~backend/routes";

export function buildApp(): Express {
  const app = express();

  app.disable("x-powered-by");

  // Before helmet: its default CSP blocks Swagger UI's inline scripts.
  if (isDevelopment) {
    app.use(
      "/docs",
      swaggerUi.serve,
      swaggerUi.setup(buildApiDocs(), { customSiteTitle: "Attack Surface Intelligence API" }),
    );
  }

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(requestLogger);

  app.use("/v1", apiRouter);

  // Fallthrough handlers — must be registered after all routes.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
