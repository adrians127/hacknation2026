import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export interface StabilityParams {
  scanId?: string;
  window: number;
  inactiveAfter: number;
}

export const stabilityReportQueryOptions = ({ scanId, window, inactiveAfter }: StabilityParams) =>
  api.queryOptions("get", "/reports/stability", { params: { query: { scanId, window, inactiveAfter } } });

export const useStabilityReport = (params: StabilityParams) => useQuery(stabilityReportQueryOptions(params));
