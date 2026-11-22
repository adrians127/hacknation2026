import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export const summaryReportQueryOptions = (scanId: string) =>
  api.queryOptions("get", "/reports/scans/{id}/summary", { params: { path: { id: scanId } } });

export const useScanSummaryReport = (scanId: string) => useQuery(summaryReportQueryOptions(scanId));
