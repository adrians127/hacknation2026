import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

// Managers check in on every lease request: refresh so "online" stays true to life.
const REFRESH_MS = 30_000;

export const workersQueryOptions = () => api.queryOptions("get", "/workers");

export const useWorkers = (options: { enabled?: boolean; live?: boolean } = {}) =>
  useQuery({
    ...workersQueryOptions(),
    enabled: options.enabled ?? true,
    refetchInterval: options.live ? REFRESH_MS : false,
  });
