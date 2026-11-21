import { Router } from "express";

import { authRoutes } from "~backend/modules/auth/auth.routes";
import { healthRoutes } from "~backend/modules/health/health.routes";
import { rolesRoutes } from "~backend/modules/roles/roles.routes";
import { usersRoutes } from "~backend/modules/users/users.routes";

/**
 * Root API router, mounted at `/v1`. Adding a feature = create `modules/<feature>/`
 * and add one `apiRouter.use(...)` line below.
 */
export const apiRouter = Router();

apiRouter.use("/auth", authRoutes);
apiRouter.use("/health", healthRoutes);
apiRouter.use("/roles", rolesRoutes);
apiRouter.use("/users", usersRoutes);
