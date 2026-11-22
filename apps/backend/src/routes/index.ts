import { Router } from "express";

import { authRoutes } from "~backend/modules/auth/auth.routes";
import { defectDojoRoutes } from "~backend/modules/defectdojo/defectdojo.routes";
import { healthRoutes } from "~backend/modules/health/health.routes";
import { hostsRoutes } from "~backend/modules/hosts/hosts.routes";
import { reportsRoutes } from "~backend/modules/reports/reports.routes";
import { rolesRoutes } from "~backend/modules/roles/roles.routes";
import { scansRoutes } from "~backend/modules/scans/scans.routes";
import { targetsRoutes } from "~backend/modules/targets/targets.routes";
import { usersRoutes } from "~backend/modules/users/users.routes";

/**
 * Root API router, mounted at `/v1`. Adding a feature = create `modules/<feature>/`
 * and add one `apiRouter.use(...)` line below.
 */
export const apiRouter = Router();

apiRouter.use("/auth", authRoutes);
apiRouter.use("/defectdojo", defectDojoRoutes);
apiRouter.use("/health", healthRoutes);
apiRouter.use("/hosts", hostsRoutes);
apiRouter.use("/reports", reportsRoutes);
apiRouter.use("/roles", rolesRoutes);
apiRouter.use("/scans", scansRoutes);
apiRouter.use("/targets", targetsRoutes);
apiRouter.use("/users", usersRoutes);
