import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export const exposureReportQueryOptions = (scanId: string) =>
  api.queryOptions("get", "/reports/scans/{id}/exposure", { params: { path: { id: scanId } } });

export const useExposureReport = (scanId: string) => useQuery(exposureReportQueryOptions(scanId));
