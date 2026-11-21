import { Router } from "express";

import { healthRoutes } from "~backend/modules/health/health.routes";

/**
 * Root API router, mounted at `/v1`. Adding a feature = create `modules/<feature>/`
 * and add one `apiRouter.use(...)` line below.
 */
export const apiRouter = Router();

apiRouter.use("/health", healthRoutes);
