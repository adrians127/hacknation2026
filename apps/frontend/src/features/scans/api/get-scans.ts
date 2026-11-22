import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";
import { isScanActive, LIVE_SCAN_REFRESH_MS } from "@/features/scans/lib/status";

export const scansQueryOptions = () => api.queryOptions("get", "/scans");

export const useScans = () =>
  useQuery({
    ...scansQueryOptions(),
    refetchInterval: (query) =>
      query.state.data?.items.some((scan) => isScanActive(scan.status)) ? LIVE_SCAN_REFRESH_MS : false,
  });
