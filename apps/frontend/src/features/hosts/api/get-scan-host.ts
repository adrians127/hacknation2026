import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export const scanHostQueryOptions = (scanId: string, hostId: string) =>
  api.queryOptions("get", "/scans/{id}/hosts/{hostId}", {
    params: { path: { id: scanId, hostId } },
  });

export const useScanHost = (scanId: string, hostId: string) =>
  useQuery(scanHostQueryOptions(scanId, hostId));
