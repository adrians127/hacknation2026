import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export const targetsQueryOptions = () => api.queryOptions("get", "/targets");

export const useTargets = (options: { enabled?: boolean } = {}) =>
  useQuery({ ...targetsQueryOptions(), ...options });
