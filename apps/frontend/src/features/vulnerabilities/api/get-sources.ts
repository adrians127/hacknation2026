import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

const POLL_MS = 5_000;

export const vulnerabilitySourcesQueryOptions = () => api.queryOptions("get", "/vulnerabilities/sources");

/** Polls while a sync runs or waits for the sync process, so progress shows without a reload. */
export const useVulnerabilitySources = () =>
  useQuery({
    ...vulnerabilitySourcesQueryOptions(),
    refetchInterval: (query) =>
      query.state.data?.items.some((source) => source.running || source.pendingRequest)
        ? POLL_MS
        : false,
  });
