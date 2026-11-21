import { queryOptions, useQuery } from "@tanstack/react-query";

import type { DashboardResponse } from "@subsurf/contracts/dashboard/dashboard.schema";

import { mockResponse } from "@/api/mock";
import { mockDashboard } from "@/features/dashboard/api/mocks";

// MOCK: api.queryOptions("get", "/dashboard")
export const dashboardQueryOptions = () =>
  queryOptions({
    queryKey: ["get", "/dashboard"] as const,
    queryFn: (): Promise<DashboardResponse> => mockResponse(mockDashboard()),
  });

export const useDashboard = () => useQuery(dashboardQueryOptions());
