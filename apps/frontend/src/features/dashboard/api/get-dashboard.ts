import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export const dashboardQueryOptions = () => api.queryOptions("get", "/dashboard");

export const useDashboard = () => useQuery(dashboardQueryOptions());
