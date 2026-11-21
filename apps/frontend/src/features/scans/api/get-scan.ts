import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export const scanQueryOptions = (id: string) =>
  api.queryOptions("get", "/scans/{id}", { params: { path: { id } } });

export const useScan = (id: string) => useQuery(scanQueryOptions(id));
