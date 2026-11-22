import type { Request, Response } from "express";

import type {
  ManagerResultUpload,
  ManagerResultUploadResponse,
} from "@subsurf/contracts/workers/workers.schema";

import { resultsService } from "~backend/modules/results/results.service";

export const workersController = {
  submitManagerResult: async (
    req: Request<object, unknown, ManagerResultUpload>,
    res: Response<ManagerResultUploadResponse>,
  ) => {
    const { task_index: taskIndex, task_count: taskCount, result } = req.body;
    const outcome = await resultsService.ingest(result, { taskIndex, taskCount });
    req.log.info(
      {
        scanId: result.scan.scanId,
        jobId: result.scan.jobId,
        leaseId: result.scan.leaseId,
        task: `${taskIndex}/${taskCount}`,
        worker: result.scan.worker.id,
        outcome: outcome.status,
      },
      "worker result received",
    );
    res.status(200).json({ status: outcome.status, resultId: outcome.resultId });
  },
};
