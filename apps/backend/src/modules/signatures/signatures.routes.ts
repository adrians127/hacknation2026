import { Router } from "express";

import { IdParamsSchema } from "@subsurf/contracts/common/common.schema";
import {
  CreateSignatureBodySchema,
  SignatureExportDocumentSchema,
  SignatureExportQuerySchema,
  SignatureImportQuerySchema,
  SignaturePreviewBodySchema,
  UpdateSignatureBodySchema,
} from "@subsurf/contracts/signatures/signatures.schema";

import { requireAuth } from "~backend/middleware/authenticate";
import { requirePermission } from "~backend/middleware/authorize";
import { validate } from "~backend/middleware/validate";
import { signaturesController as c } from "~backend/modules/signatures/signatures.controller";

export const signaturesRoutes = Router();

signaturesRoutes.use(requireAuth);

signaturesRoutes.get("/", requirePermission("signatures:read"), c.list);
signaturesRoutes.post(
  "/",
  requirePermission("signatures:create"),
  validate({ body: CreateSignatureBodySchema }),
  c.create,
);
// Before `/:id`, which would read these names as ids.
signaturesRoutes.post(
  "/preview",
  requirePermission("signatures:read"),
  validate({ body: SignaturePreviewBodySchema }),
  c.preview,
);
signaturesRoutes.get(
  "/export",
  requirePermission("signatures:read"),
  validate({ query: SignatureExportQuerySchema }),
  c.export,
);
signaturesRoutes.post(
  "/import",
  requirePermission("signatures:create"),
  validate({ query: SignatureImportQuerySchema, body: SignatureExportDocumentSchema }),
  c.import,
);
signaturesRoutes.get(
  "/:id",
  requirePermission("signatures:read"),
  validate({ params: IdParamsSchema }),
  c.get,
);
signaturesRoutes.patch(
  "/:id",
  requirePermission("signatures:update"),
  validate({ params: IdParamsSchema, body: UpdateSignatureBodySchema }),
  c.update,
);
signaturesRoutes.delete(
  "/:id",
  requirePermission("signatures:delete"),
  validate({ params: IdParamsSchema }),
  c.remove,
);
