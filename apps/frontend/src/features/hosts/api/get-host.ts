import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export const hostQueryOptions = (id: string) =>
  api.queryOptions("get", "/hosts/{id}", { params: { path: { id } } });

export const useHost = (id: string) => useQuery(hostQueryOptions(id));
