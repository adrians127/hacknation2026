import express, { Router } from "express";

import {
  ManagerLeaseRequestSchema,
  ManagerResultUploadSchema,
} from "@subsurf/contracts/workers/workers.schema";

import { validate } from "~backend/middleware/validate";
import { requireWorkerToken } from "~backend/middleware/worker-token";
import { managerController as c } from "~backend/modules/workers/manager.controller";

// A result carries up to 1024 hosts, each with HTTP bodies cut at maxBodyBytes.
const RESULT_UPLOAD_LIMIT = "64mb";

/** Machine endpoints of worker-manager (`/workers/manager`): bearer WORKER_TOKEN, no session. */
export const managerRoutes = Router();

managerRoutes.use(requireWorkerToken);

managerRoutes.post("/lease", validate({ body: ManagerLeaseRequestSchema }), c.lease);
// Its own body parser, after the token check: app.ts skips this path in the global 1 MB one.
// express.json inflates gzip bodies; the limit applies to the inflated size.
managerRoutes.post(
  "/results",
  express.json({ limit: RESULT_UPLOAD_LIMIT }),
  validate({ body: ManagerResultUploadSchema }),
  c.submitManagerResult,
);
