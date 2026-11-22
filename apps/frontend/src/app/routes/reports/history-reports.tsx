import { useSearchParams } from "react-router";

import {
  StabilityReportQuerySchema,
  TimeOfDayReportQuerySchema,
} from "@subsurf/contracts/reports/reports.schema";

import {
  StabilityReportView,
  TimeOfDayReportView,
} from "@/features/reports/components/history-reports";
import { localUtcOffset } from "@/features/reports/lib/format";

const withoutEmpty = (params: URLSearchParams) =>
  Object.fromEntries([...params].filter(([, value]) => value !== ""));

/** `/app/reports/stability?window=&inactiveAfter=&scanId=` */
export function StabilityReportRoute() {
  const [params, setParams] = useSearchParams();
  const parsed = StabilityReportQuerySchema.safeParse(withoutEmpty(params));
  const query = parsed.success ? parsed.data : StabilityReportQuerySchema.parse({});
  return (
    <StabilityReportView
      params={query}
      onChange={(next) =>
        setParams(
          {
            window: String(next.window),
            inactiveAfter: String(next.inactiveAfter),
            ...(next.scanId && { scanId: next.scanId }),
          },
          { replace: true },
        )
      }
    />
  );
}

/** `/app/reports/time-of-day?scans=`; parts of the day follow the browser's time zone. */
export function TimeOfDayReportRoute() {
  const [params, setParams] = useSearchParams();
  const offset = localUtcOffset();
  const parsed = TimeOfDayReportQuerySchema.safeParse({ ...withoutEmpty(params), utcOffsetMinutes: offset });
  const query = parsed.success ? parsed.data : TimeOfDayReportQuerySchema.parse({ utcOffsetMinutes: offset });
  return (
    <TimeOfDayReportView
      scans={query.scans}
      utcOffsetMinutes={query.utcOffsetMinutes}
      onScansChange={(scans) => setParams({ scans: String(scans) }, { replace: true })}
    />
  );
}
