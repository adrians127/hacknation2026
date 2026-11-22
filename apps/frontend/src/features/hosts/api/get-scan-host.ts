import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

/** `base`: the older scan to compare with; omitted, the backend takes the previous one. */
export const scanHostQueryOptions = (scanId: string, hostId: string, base?: string) =>
  api.queryOptions("get", "/scans/{id}/hosts/{hostId}", {
    params: { path: { id: scanId, hostId }, query: base ? { base } : {} },
  });

export const useScanHost = (scanId: string, hostId: string, base?: string) =>
  useQuery(scanHostQueryOptions(scanId, hostId, base));
