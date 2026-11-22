import type { Request, Response } from "express";

import type { IdParams } from "@subsurf/contracts/common/common.schema";
import type {
  CreateRuleBody,
  Rule,
  RuleListResponse,
  RulePreviewBody,
  RulePreviewResponse,
  UpdateRuleBody,
} from "@subsurf/contracts/rules/rules.schema";

import { getAuth } from "~backend/lib/auth-context";
import { rulesService } from "~backend/modules/rules/rules.service";

export const rulesController = {
  list: async (_req: Request, res: Response<RuleListResponse>) => {
    res.status(200).json(await rulesService.list());
  },

  create: async (req: Request<object, unknown, CreateRuleBody>, res: Response<Rule>) => {
    res.status(201).json(await rulesService.create(getAuth(req).user.id, req.body));
  },

  update: async (req: Request<IdParams, unknown, UpdateRuleBody>, res: Response<Rule>) => {
    res.status(200).json(await rulesService.update(req.params.id, req.body));
  },

  remove: async (req: Request<IdParams>, res: Response) => {
    await rulesService.remove(req.params.id);
    res.status(204).end();
  },

  preview: async (
    req: Request<object, unknown, RulePreviewBody>,
    res: Response<RulePreviewResponse>,
  ) => {
    res.status(200).json(await rulesService.preview(req.body));
  },
};
