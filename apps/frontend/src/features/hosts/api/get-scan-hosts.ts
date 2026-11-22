import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { ScanHostListQuery } from "@subsurf/contracts/scans/scan-results.schema";

import { api } from "@/api/client";

export type ScanHostsQuery = Partial<ScanHostListQuery>;

export const scanHostsQueryOptions = (scanId: string, query: ScanHostsQuery) =>
  api.queryOptions("get", "/scans/{id}/hosts", { params: { path: { id: scanId }, query } });

// The previous page stays on screen while the next one loads.
export const useScanHosts = (
  scanId: string,
  query: ScanHostsQuery,
  options: { enabled?: boolean } = {},
) =>
  useQuery({
    ...scanHostsQueryOptions(scanId, query),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
