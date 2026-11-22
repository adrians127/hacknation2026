import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { ScanJobListQuery } from "@subsurf/contracts/scans/scan-jobs.schema";

import { api } from "@/api/client";
import { LIVE_SCAN_REFRESH_MS } from "@/features/scans/lib/status";

export const scanJobsQueryOptions = (id: string, query: Partial<ScanJobListQuery>) =>
  api.queryOptions("get", "/scans/{id}/jobs", { params: { path: { id }, query } });

/** `live`: the scan is still going, so jobs change under the user's eyes. */
export const useScanJobs = (id: string, query: Partial<ScanJobListQuery>, live: boolean) =>
  useQuery({
    ...scanJobsQueryOptions(id, query),
    placeholderData: keepPreviousData,
    refetchInterval: live ? LIVE_SCAN_REFRESH_MS : false,
  });
