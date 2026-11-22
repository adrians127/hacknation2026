import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";

import {
  TARGETS_PAGE_SIZE_MAX,
  type Target,
  type TargetListQuery,
} from "@subsurf/contracts/targets/targets.schema";

import { apiClient, api } from "@/api/client";

export type TargetsQuery = Partial<TargetListQuery>;

export const targetsQueryOptions = (query: TargetsQuery) =>
  api.queryOptions("get", "/targets", { params: { query } });

// The previous page stays on screen while the next one loads.
export const useTargets = (query: TargetsQuery) =>
  useQuery({ ...targetsQueryOptions(query), placeholderData: keepPreviousData });

async function fetchTargetsPage(page: number) {
  const { data, error } = await apiClient.GET("/targets", {
    params: { query: { page, pageSize: TARGETS_PAGE_SIZE_MAX } },
  });
  if (error !== undefined) throw error;
  return data;
}

/**
 * Every target, page by page: the pipeline target picker counts tags and coverage over the whole
 * inventory. Shares the `["get", "/targets"]` key prefix, so target mutations invalidate it too.
 */
export const allTargetsQueryOptions = () =>
  queryOptions({
    queryKey: ["get", "/targets", "all"] as const,
    queryFn: async (): Promise<{ items: Target[] }> => {
      const first = await fetchTargetsPage(1);
      const pages = Math.ceil(first.total / TARGETS_PAGE_SIZE_MAX);
      const rest = await Promise.all(
        Array.from({ length: Math.max(0, pages - 1) }, (_, index) => fetchTargetsPage(index + 2)),
      );
      return { items: [first, ...rest].flatMap((page) => page.items) };
    },
  });

export const useAllTargets = (options: { enabled?: boolean } = {}) =>
  useQuery({ ...allTargetsQueryOptions(), ...options });
