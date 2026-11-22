import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

/** Matches per detection signature in a scan (the signature filter, the dashboard). */
export const useScanDetections = (scanId: string | undefined) =>
  useQuery({
    ...api.queryOptions("get", "/scans/{id}/detections", { params: { path: { id: scanId ?? "" } } }),
    enabled: scanId !== undefined && scanId !== "",
  });
