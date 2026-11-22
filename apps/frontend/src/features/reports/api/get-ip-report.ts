import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export const ipReportQueryOptions = (ip: string) =>
  api.queryOptions("get", "/reports/ips/{ip}", { params: { path: { ip } } });

export const useIpReport = (ip: string) => useQuery(ipReportQueryOptions(ip));
