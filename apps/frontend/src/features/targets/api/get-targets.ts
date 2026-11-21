import { queryOptions, useQuery } from "@tanstack/react-query";

import type { TargetListResponse } from "@hacknation/contracts/targets/targets.schema";

import { mockResponse } from "@/api/mock";
import { mockTargets } from "@/features/targets/api/mocks";

// MOCK: api.queryOptions("get", "/targets")
export const targetsQueryOptions = () =>
  queryOptions({
    queryKey: ["get", "/targets"] as const,
    queryFn: (): Promise<TargetListResponse> => mockResponse(mockTargets.list()),
  });

export const useTargets = () => useQuery(targetsQueryOptions());
