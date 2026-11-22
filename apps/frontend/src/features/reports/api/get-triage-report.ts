import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export const triageReportQueryOptions = (scanId: string) =>
  api.queryOptions("get", "/reports/scans/{id}/triage", { params: { path: { id: scanId } } });

export const useTriageReport = (scanId: string) => useQuery(triageReportQueryOptions(scanId));
