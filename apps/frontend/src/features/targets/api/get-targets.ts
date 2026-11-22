import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { TargetListQuery } from "@subsurf/contracts/targets/targets.schema";

import { api } from "@/api/client";

export type TargetsQuery = Partial<TargetListQuery>;

export const targetsQueryOptions = (query: TargetsQuery) =>
  api.queryOptions("get", "/targets", { params: { query } });

// The previous page stays on screen while the next one loads.
export const useTargets = (query: TargetsQuery) =>
  useQuery({ ...targetsQueryOptions(query), placeholderData: keepPreviousData });
