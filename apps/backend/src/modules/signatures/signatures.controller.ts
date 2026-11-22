import type { Request, Response } from "express";

import type { IdParams } from "@subsurf/contracts/common/common.schema";
import type {
  CreateSignatureBody,
  Signature,
  SignatureExportDocument,
  SignatureExportQuery,
  SignatureImportQuery,
  SignatureImportResponse,
  SignatureListResponse,
  SignaturePreviewBody,
  SignaturePreviewResponse,
  UpdateSignatureBody,
} from "@subsurf/contracts/signatures/signatures.schema";

import { getAuth } from "~backend/lib/auth-context";
import { signaturesService } from "~backend/modules/signatures/signatures.service";

export const signaturesController = {
  list: async (_req: Request, res: Response<SignatureListResponse>) => {
    res.status(200).json(await signaturesService.list());
  },

  get: async (req: Request<IdParams>, res: Response<Signature>) => {
    res.status(200).json(await signaturesService.get(req.params.id));
  },

  create: async (req: Request<object, unknown, CreateSignatureBody>, res: Response<Signature>) => {
    res.status(201).json(await signaturesService.create(getAuth(req).user.id, req.body));
  },

  update: async (req: Request<IdParams, unknown, UpdateSignatureBody>, res: Response<Signature>) => {
    res.status(200).json(await signaturesService.update(req.params.id, req.body));
  },

  remove: async (req: Request<IdParams>, res: Response) => {
    await signaturesService.remove(req.params.id);
    res.status(204).end();
  },

  preview: async (
    req: Request<object, unknown, SignaturePreviewBody>,
    res: Response<SignaturePreviewResponse>,
  ) => {
    res.status(200).json(await signaturesService.preview(req.body));
  },

  export: async (
    req: Request<object, unknown, unknown, SignatureExportQuery>,
    res: Response<SignatureExportDocument>,
  ) => {
    res.status(200).json(await signaturesService.export(req.query));
  },

  import: async (
    req: Request<object, unknown, SignatureExportDocument, SignatureImportQuery>,
    res: Response<SignatureImportResponse>,
  ) => {
    res.status(200).json(await signaturesService.import(getAuth(req).user.id, req.body, req.query));
  },
};
