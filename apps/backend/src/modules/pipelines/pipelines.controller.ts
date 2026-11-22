import type { Request, Response } from "express";

import type { IdParams } from "@subsurf/contracts/common/common.schema";
import {
  type Pipeline,
  type PipelineBody,
  type PipelineDetail,
  type PipelineListResponse,
  type RunPipelineResponse,
  type SchedulePreviewBody,
  type SchedulePreviewResponse,
  type UpdatePipelineBody,
} from "@subsurf/contracts/pipelines/pipelines.schema";

import { getAuth } from "~backend/lib/auth-context";
import { pipelineRuns } from "~backend/modules/pipelines/pipeline-runs.service";
import { pipelinesService } from "~backend/modules/pipelines/pipelines.service";
import { nextFireTimes } from "~backend/modules/pipelines/schedule";

const DEFAULT_PREVIEW_COUNT = 5;

export const pipelinesController = {
  list: async (_req: Request, res: Response<PipelineListResponse>) => {
    res.status(200).json({ items: await pipelinesService.list() });
  },

  get: async (req: Request<IdParams>, res: Response<PipelineDetail>) => {
    res.status(200).json(await pipelinesService.get(req.params.id));
  },

  create: async (req: Request<object, unknown, PipelineBody>, res: Response<Pipeline>) => {
    res.status(201).json(await pipelinesService.create(getAuth(req), req.body));
  },

  update: async (req: Request<IdParams, unknown, UpdatePipelineBody>, res: Response<Pipeline>) => {
    res.status(200).json(await pipelinesService.update(getAuth(req), req.params.id, req.body));
  },

  delete: async (req: Request<IdParams>, res: Response) => {
    await pipelinesService.remove(req.params.id);
    res.status(204).end();
  },

  run: async (req: Request<IdParams>, res: Response<RunPipelineResponse>) => {
    const auth = getAuth(req);
    const result = await pipelineRuns.start(req.params.id, {
      trigger: "manual",
      requestedById: auth.user.id,
      windowEndsAt: null,
    });
    res.status(201).json(result);
  },

  previewSchedule: (
    req: Request<object, unknown, SchedulePreviewBody>,
    res: Response<SchedulePreviewResponse>,
  ) => {
    const { schedule, count = DEFAULT_PREVIEW_COUNT } = req.body;
    const times = nextFireTimes(schedule, new Date(), count);
    res.status(200).json({ times: times.map((time) => time.toISOString()) });
  },
};
