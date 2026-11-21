import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { HostListQuery } from "@subsurf/contracts/hosts/hosts.schema";

import { api } from "@/api/client";

export type HostsQuery = Partial<HostListQuery>;

export const hostsQueryOptions = (query: HostsQuery) =>
  api.queryOptions("get", "/hosts", { params: { query } });

// The previous page stays on screen while the next one loads.
export const useHosts = (query: HostsQuery) =>
  useQuery({ ...hostsQueryOptions(query), placeholderData: keepPreviousData });
