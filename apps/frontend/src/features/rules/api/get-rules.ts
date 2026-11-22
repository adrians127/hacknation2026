import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export const useRules = () => useQuery(api.queryOptions("get", "/rules"));
