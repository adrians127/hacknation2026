import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export const pipelinesQueryOptions = () => api.queryOptions("get", "/pipelines");

export const usePipelines = (options: { enabled?: boolean } = {}) =>
  useQuery({ ...pipelinesQueryOptions(), enabled: options.enabled ?? true });
