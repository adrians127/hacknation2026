import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { Schedule } from "@subsurf/contracts/pipelines/pipelines.schema";

import { api } from "@/api/client";

/** The next run times of a schedule being edited; `null` (an invalid schedule) asks for nothing. */
export const useSchedulePreview = (schedule: Schedule | null) =>
  useQuery({
    ...api.queryOptions("post", "/pipelines/schedule/preview", {
      body: { schedule: schedule ?? DUMMY_SCHEDULE, count: 5 },
    }),
    enabled: schedule !== null,
    placeholderData: keepPreviousData,
  });

// Never sent (the query is disabled); keeps the query key well-formed.
const DUMMY_SCHEDULE: Schedule = {
  every: 1,
  unit: "day",
  startsAt: "2026-01-01T00:00",
  daysOfWeek: [],
  windowMinutes: null,
  timezone: "UTC",
};
