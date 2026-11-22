import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export const findingsReportQueryOptions = (scanId: string) =>
  api.queryOptions("get", "/reports/scans/{id}/findings", { params: { path: { id: scanId } } });

export const useFindingsReport = (scanId: string) => useQuery(findingsReportQueryOptions(scanId));
