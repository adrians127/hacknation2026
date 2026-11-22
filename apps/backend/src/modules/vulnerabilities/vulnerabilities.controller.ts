import type { Request, Response } from "express";

import type { IdParams } from "@subsurf/contracts/common/common.schema";
import type {
  CreatePackageMappingBody,
  JobRequest,
  PackageMapping,
  PackageMappingListResponse,
  RequestSyncBody,
  ServiceVulnerabilityParams,
  ServiceVulnerabilityTriage,
  SourceParams,
  SyncRunListResponse,
  UpdateServiceVulnerabilityBody,
  UpdateSourceBody,
  VulnerabilitySource,
  VulnerabilitySourceListResponse,
} from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";

import { getAuth } from "~backend/lib/auth-context";
import {
  vulnerabilitiesService as service,
} from "~backend/modules/vulnerabilities/vulnerabilities.service";

export const vulnerabilitiesController = {
  listSources: async (_req: Request, res: Response<VulnerabilitySourceListResponse>) => {
    res.status(200).json(await service.listSources());
  },

  listRuns: async (req: Request<SourceParams>, res: Response<SyncRunListResponse>) => {
    res.status(200).json({ items: await service.listRuns(req.params.id) });
  },

  requestSync: async (
    req: Request<SourceParams, unknown, RequestSyncBody>,
    res: Response<JobRequest>,
  ) => {
    const { user } = getAuth(req);
    res.status(202).json(await service.requestSync(user.id, req.params.id, req.body.mode));
  },

  updateSource: async (
    req: Request<SourceParams, unknown, UpdateSourceBody>,
    res: Response<VulnerabilitySource>,
  ) => {
    const { user } = getAuth(req);
    res.status(200).json(await service.updateSource(user.id, req.params.id, req.body.enabled));
  },

  listMappings: async (_req: Request, res: Response<PackageMappingListResponse>) => {
    res.status(200).json(await service.listMappings());
  },

  createMapping: async (
    req: Request<object, unknown, CreatePackageMappingBody>,
    res: Response<PackageMapping>,
  ) => {
    res.status(201).json(await service.createMapping(getAuth(req).user.id, req.body));
  },

  deleteMapping: async (req: Request<IdParams>, res: Response) => {
    await service.deleteMapping(getAuth(req).user.id, req.params.id);
    res.status(204).end();
  },

  updateTriage: async (
    req: Request<ServiceVulnerabilityParams, unknown, UpdateServiceVulnerabilityBody>,
    res: Response<ServiceVulnerabilityTriage>,
  ) => {
    const { serviceId, canonicalId } = req.params;
    res
      .status(200)
      .json(await service.updateTriage(getAuth(req).user.id, serviceId, canonicalId, req.body));
  },
};
