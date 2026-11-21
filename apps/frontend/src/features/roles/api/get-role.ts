import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export const roleQueryOptions = (id: string) =>
  api.queryOptions("get", "/roles/{id}", { params: { path: { id } } });

export const useRole = (id: string) => useQuery(roleQueryOptions(id));
