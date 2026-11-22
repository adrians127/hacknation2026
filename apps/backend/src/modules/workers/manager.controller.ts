import type { Request, Response } from "express";

import type {
  ManagerJobList,
  ManagerLeaseRequest,
  ManagerResultUpload,
  ManagerResultUploadResponse,
} from "@subsurf/contracts/workers/workers.schema";

import { pipelineRuns } from "~backend/modules/pipelines/pipeline-runs.service";
import { utcSeconds } from "~backend/modules/pipelines/manager-job";
import { resultsService } from "~backend/modules/results/results.service";
import { leaseJobs } from "~backend/modules/workers/manager-lease.service";
import { workersService } from "~backend/modules/workers/workers.service";

/** Longest the backend holds a lease request, whatever `wait_seconds` asks for. */
const MAX_LONG_POLL_MS = 60_000;
const LONG_POLL_STEP_MS = 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const managerController = {
  lease: async (
    req: Request<object, unknown, ManagerLeaseRequest>,
    res: Response<ManagerJobList>,
  ) => {
    const request = req.body;
    await workersService.recordManager(request);

    let isGone = false;
    res.on("close", () => {
      isGone = true;
    });
    const until = Date.now() + Math.min((request.wait_seconds ?? 0) * 1000, MAX_LONG_POLL_MS);
    for (;;) {
      // Checked before leasing: jobs leased to a manager that hung up would wait for the lease to expire.
      if (isGone) return;
      const jobs = await leaseJobs(request);
      if (jobs.length > 0) {
        req.log.info(
          { managerId: request.manager_id, jobs: jobs.map((job) => job.job_id) },
          "jobs leased",
        );
        res.status(200).json({
          schema_version: 1,
          server_time: utcSeconds(new Date()),
          next_poll_ms: 0,
          jobs,
        });
        return;
      }
      if (Date.now() + LONG_POLL_STEP_MS > until) break;
      await sleep(LONG_POLL_STEP_MS);
    }
    res.status(204).end();
  },

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
    if (result.scan.jobId && result.scan.leaseId) {
      await pipelineRuns.onResultStored(result.scan.jobId, result.scan.leaseId, taskCount);
    }
    res.status(200).json({ status: outcome.status, resultId: outcome.resultId });
  },
};
