import { useParams, useSearchParams } from "react-router";

import { NotFoundRoute } from "@/app/routes/not-found";
import { ExposureReportView } from "@/features/reports/components/exposure-report";
import { FindingsReportView } from "@/features/reports/components/findings-report";
import { SummaryReport } from "@/features/reports/components/summary-report";
import { TagsReportView } from "@/features/reports/components/tags-report";
import { TechnologiesReportView } from "@/features/reports/components/technologies-report";
import { TriageReportView } from "@/features/reports/components/triage-report";
import { isScanReportKind } from "@/features/reports/lib/report-kinds";

const VIEWS = {
  summary: SummaryReport,
  findings: FindingsReportView,
  technologies: TechnologiesReportView,
  exposure: ExposureReportView,
  triage: TriageReportView,
} as const;

/** `/app/reports/scans/:scanId/:kind`; the tags report keeps its tag in `?tag=`. */
export function ScanReportRoute() {
  const { scanId = "", kind } = useParams();
  const [params, setParams] = useSearchParams();
  if (!isScanReportKind(kind)) return <NotFoundRoute />;
  if (kind === "tags") {
    return (
      <TagsReportView
        scanId={scanId}
        tag={params.get("tag") ?? undefined}
        onTag={(next) => setParams(next ? { tag: next } : {}, { replace: true })}
      />
    );
  }
  const View = VIEWS[kind];
  return <View scanId={scanId} />;
}
