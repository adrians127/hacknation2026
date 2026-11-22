import express, { Router } from "express";

import { ManagerResultUploadSchema } from "@subsurf/contracts/workers/workers.schema";

import { validate } from "~backend/middleware/validate";
import { requireWorkerToken } from "~backend/middleware/worker-token";
import { workersController as c } from "~backend/modules/workers/workers.controller";

// A result carries up to 1024 hosts, each with HTTP bodies cut at maxBodyBytes.
const RESULT_UPLOAD_LIMIT = "64mb";

export const workersRoutes = Router();

workersRoutes.use(requireWorkerToken);

// Its own body parser, after the token check: app.ts skips this path in the global 1 MB one.
// express.json inflates gzip bodies; the limit applies to the inflated size.
workersRoutes.post(
  "/manager/results",
  express.json({ limit: RESULT_UPLOAD_LIMIT }),
  validate({ body: ManagerResultUploadSchema }),
  c.submitManagerResult,
);
