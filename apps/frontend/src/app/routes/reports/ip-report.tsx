import { useParams } from "react-router";

import { IpReportParamsSchema } from "@subsurf/contracts/reports/reports.schema";

import { NotFoundRoute } from "@/app/routes/not-found";
import { IpReportView } from "@/features/reports/components/ip-report";

export function IpReportRoute() {
  const { ip = "" } = useParams();
  const parsed = IpReportParamsSchema.shape.ip.safeParse(ip);
  if (!parsed.success) return <NotFoundRoute />;
  return <IpReportView key={parsed.data} ip={parsed.data} />;
}
