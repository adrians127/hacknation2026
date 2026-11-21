import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export const usersQueryOptions = () => api.queryOptions("get", "/users");

export const useUsers = () => useQuery(usersQueryOptions());
