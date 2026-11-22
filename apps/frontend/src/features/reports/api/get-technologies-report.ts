import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export const technologiesReportQueryOptions = (scanId: string) =>
  api.queryOptions("get", "/reports/scans/{id}/technologies", { params: { path: { id: scanId } } });

export const useTechnologiesReport = (scanId: string) => useQuery(technologiesReportQueryOptions(scanId));
