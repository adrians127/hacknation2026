import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export const pipelineQueryOptions = (id: string) =>
  api.queryOptions("get", "/pipelines/{id}", { params: { path: { id } } });

export const usePipeline = (id: string, options: { enabled?: boolean } = {}) =>
  useQuery({ ...pipelineQueryOptions(id), enabled: options.enabled ?? true });
