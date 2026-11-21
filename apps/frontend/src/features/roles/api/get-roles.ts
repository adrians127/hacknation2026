import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export const rolesQueryOptions = () => api.queryOptions("get", "/roles");

export const useRoles = (options: { enabled?: boolean } = {}) =>
  useQuery({ ...rolesQueryOptions(), ...options });
