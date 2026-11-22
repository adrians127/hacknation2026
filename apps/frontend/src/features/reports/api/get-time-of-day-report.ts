import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

export const timeOfDayReportQueryOptions = (scans: number, utcOffsetMinutes: number) =>
  api.queryOptions("get", "/reports/time-of-day", { params: { query: { scans, utcOffsetMinutes } } });

export const useTimeOfDayReport = (scans: number, utcOffsetMinutes: number) =>
  useQuery(timeOfDayReportQueryOptions(scans, utcOffsetMinutes));
