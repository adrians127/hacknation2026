import { useTranslation } from "react-i18next";

import type { ReportScan } from "@subsurf/contracts/reports/reports.schema";

import { formatDateTime } from "@/lib/format";

export const scanDate = (scan: Pick<ReportScan, "startedAt" | "createdAt">): string => scan.startedAt ?? scan.createdAt;

/** "Scan of …" and "Generated …" lines for a report header. */
export function useReportMeta() {
  const { t, i18n } = useTranslation("reports");
  const locale = i18n.resolvedLanguage;
  const date = (value: string) => formatDateTime(value, locale);
  return {
    locale,
    date,
    scan: (scan: Pick<ReportScan, "startedAt" | "createdAt">) => t("meta.scan", { date: date(scanDate(scan)) }),
    generated: (generatedAt: string) => t("meta.generated", { date: date(generatedAt) }),
  };
}
