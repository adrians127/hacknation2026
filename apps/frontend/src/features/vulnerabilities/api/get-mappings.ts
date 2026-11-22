import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export const usePackageMappings = () => useQuery(api.queryOptions("get", "/vulnerabilities/mappings"));
