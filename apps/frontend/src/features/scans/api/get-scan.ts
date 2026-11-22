import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

/** `base`: the older scan to compare with; omitted, the backend takes the previous one. */
export const scanQueryOptions = (id: string, base?: string) =>
  api.queryOptions("get", "/scans/{id}", {
    params: { path: { id }, query: base ? { base } : {} },
  });

export const useScan = (id: string, base?: string, options: { enabled?: boolean } = {}) =>
  useQuery({ ...scanQueryOptions(id, base), enabled: options.enabled ?? true });
