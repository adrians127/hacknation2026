import { queryOptions, useQuery } from "@tanstack/react-query";

import type { ScanListResponse } from "@subsurf/contracts/scans/scans.schema";

import { mockResponse } from "@/api/mock";
import { mockScans } from "@/features/scans/api/mocks";

// MOCK: api.queryOptions("get", "/scans")
export const scansQueryOptions = () =>
  queryOptions({
    queryKey: ["get", "/scans"] as const,
    queryFn: (): Promise<ScanListResponse> => mockResponse(mockScans.list()),
  });

export const useScans = () => useQuery(scansQueryOptions());
