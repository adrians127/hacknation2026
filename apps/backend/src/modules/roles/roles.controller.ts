import type { Request, Response } from "express";

import type { IdParams } from "@hacknation/contracts/common/common.schema";
import type {
  CreateRoleBody,
  DeleteRoleQuery,
  Role,
  RoleDetailResponse,
  RoleListResponse,
  UpdateRoleBody,
} from "@hacknation/contracts/roles/roles.schema";

import { getAuth } from "~backend/lib/auth-context";
import { rolesService } from "~backend/modules/roles/roles.service";

export const rolesController = {
  list: async (_req: Request, res: Response<RoleListResponse>) => {
    res.status(200).json({ items: await rolesService.list() });
  },

  get: async (req: Request<IdParams>, res: Response<RoleDetailResponse>) => {
    res.status(200).json(await rolesService.get(req.params.id));
  },

  create: async (req: Request<object, unknown, CreateRoleBody>, res: Response<Role>) => {
    res.status(201).json(await rolesService.create(getAuth(req), req.body));
  },

  update: async (req: Request<IdParams, unknown, UpdateRoleBody>, res: Response<Role>) => {
    res.status(200).json(await rolesService.update(getAuth(req), req.params.id, req.body));
  },

  delete: async (req: Request<IdParams, unknown, unknown, DeleteRoleQuery>, res: Response) => {
    await rolesService.delete(getAuth(req), req.params.id, req.query);
    res.status(204).end();
  },
};
