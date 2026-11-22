import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export const defectDojoStatusQueryOptions = () => api.queryOptions("get", "/defectdojo/sync");

export const useDefectDojoStatus = (enabled = true) =>
  useQuery({ ...defectDojoStatusQueryOptions(), enabled });
