import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export const tagsReportQueryOptions = (scanId: string, tag: string | undefined) =>
  api.queryOptions("get", "/reports/scans/{id}/tags", { params: { path: { id: scanId }, query: { tag } } });

// Switching tags keeps the tag list on screen instead of a skeleton.
export const useTagsReport = (scanId: string, tag: string | undefined) =>
  useQuery({ ...tagsReportQueryOptions(scanId, tag), placeholderData: keepPreviousData });
