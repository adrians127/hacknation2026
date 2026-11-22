import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export const diffReportQueryOptions = (from: string, to: string) =>
  api.queryOptions("get", "/reports/diff", { params: { query: { from, to } } });

export const useDiffReport = (from: string, to: string) =>
  useQuery({ ...diffReportQueryOptions(from, to), enabled: from !== "" && to !== "" });
