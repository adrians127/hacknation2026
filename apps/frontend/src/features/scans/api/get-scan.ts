import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";
import { isScanActive, LIVE_SCAN_REFRESH_MS } from "@/features/scans/lib/status";

/** `base`: the older scan to compare with; omitted, the backend takes the previous one. */
export const scanQueryOptions = (id: string, base?: string) =>
  api.queryOptions("get", "/scans/{id}", {
    params: { path: { id }, query: base ? { base } : {} },
  });

export const useScan = (id: string, base?: string, options: { enabled?: boolean } = {}) =>
  useQuery({
    ...scanQueryOptions(id, base),
    enabled: options.enabled ?? true,
    refetchInterval: (query) => (isScanActive(query.state.data?.status) ? LIVE_SCAN_REFRESH_MS : false),
  });
