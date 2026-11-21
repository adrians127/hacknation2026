import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export const scansQueryOptions = () => api.queryOptions("get", "/scans");

export const useScans = () => useQuery(scansQueryOptions());
