import { useTranslation } from "react-i18next";

import type { TriageItem, TriageReport } from "@subsurf/contracts/reports/reports.schema";

import { ChangeBadge } from "@/features/hosts/components/change-badge";
import { TriageBadge } from "@/features/hosts/components/triage-badge";
import { useTriageReport } from "@/features/reports/api/get-triage-report";
import {
  HostCell,
  Mono,
  ReportQuery,
  ReportSection,
  ReportShell,
  ReportTable,
  Stat,
  StatGrid,
  TagChips,
  type ReportColumn,
} from "@/features/reports/components/report-parts";
import { joinList, reportFileName, type CsvTable } from "@/features/reports/lib/export";
import { formatPercent, serviceLabel } from "@/features/reports/lib/format";
import { scanDate, useReportMeta } from "@/features/reports/lib/use-report-meta";
import { formatDay, formatNumber } from "@/lib/format";

const TRIAGE = ["unreviewed", "reviewed", "important", "false_positive"] as const;
const LISTS = ["newUnreviewed", "important"] as const;
const REMEDIATION = ["overdue", "dueSoon", "riskAcceptanceExpiring"] as const;

function triageCsv(report: TriageReport): CsvTable {
  const rows = [
    ...LISTS.flatMap((list) => report[list].map((item) => [list, item] as const)),
    ...REMEDIATION.flatMap((list) => report.remediation[list].map((item) => [list, item] as const)),
  ];
  return {
    columns: ["list", "ip", "port", "service", "change", "triage", "tags", "slaDueOn", "riskAcceptedUntil"],
    rows: rows.map(([list, item]) => [
      list,
      item.ip,
      item.port,
      serviceLabel(item.identity),
      item.change,
      item.triage,
      joinList(item.tags),
      item.remediation?.slaDueOn,
      item.remediation?.riskAcceptedUntil,
    ]),
  };
}

function TriageBody({ report }: { report: TriageReport }) {
  const { t } = useTranslation("reports");
  const { t: th } = useTranslation("hosts");
  const meta = useReportMeta();
  const number = (value: number) => formatNumber(value, meta.locale);
  const day = (value: string | null | undefined) => (value ? formatDay(value, meta.locale) : "—");

  const columns: ReportColumn<TriageItem>[] = [
    { header: t("common.host"), cell: (item) => <HostCell ip={item.ip} /> },
    { header: t("common.port"), cell: (item) => <Mono>{item.port}/tcp</Mono> },
    { header: t("common.service"), cell: (item) => serviceLabel(item.identity) },
    { header: t("common.change"), cell: (item) => <ChangeBadge change={item.change} /> },
    { header: t("common.triage"), cell: (item) => <TriageBadge status={item.triage} /> },
    { header: t("common.tags"), cell: (item) => <TagChips tags={item.tags} /> },
  ];
  const withDates: ReportColumn<TriageItem>[] = [
    ...columns.slice(0, 3),
    { header: t("triage.sla"), cell: (item: TriageItem) => day(item.remediation?.slaDueOn) },
    { header: t("triage.riskAcceptedUntil"), cell: (item: TriageItem) => day(item.remediation?.riskAcceptedUntil) },
    ...columns.slice(4, 5),
  ];
  const titles = { newUnreviewed: t("triage.newUnreviewed"), important: t("triage.important") };
  const remediationTitles = {
    overdue: t("triage.overdue"),
    dueSoon: t("triage.dueSoon"),
    riskAcceptanceExpiring: t("triage.riskExpiring"),
  };

  return (
    <ReportShell
      title={t("kinds.triage.title")}
      description={t("kinds.triage.description")}
      meta={[meta.scan(report.scan), meta.generated(report.generatedAt)]}
      fileName={reportFileName("triage", scanDate(report.scan))}
      json={report}
      csv={() => triageCsv(report)}
    >
      <ReportSection
        title={t("triage.progress")}
        description={t("triage.progressHint", { percent: formatPercent(report.progress, meta.locale) })}
      >
        <progress
          value={report.progress}
          max={1}
          aria-label={t("triage.progress")}
          className="h-3 w-full appearance-none overflow-hidden rounded-full bg-muted [&::-moz-progress-bar]:bg-brand [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-brand print:border"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {(["hosts", "services"] as const).map((kind) => (
            <div key={kind} className="grid gap-2">
              <h3 className="text-sm font-medium">{t(`triage.${kind}`)}</h3>
              <StatGrid>
                {TRIAGE.map((status) => (
                  <Stat key={status} label={th(`triage.${status}`)} value={number(report[kind][status])} />
                ))}
              </StatGrid>
            </div>
          ))}
        </div>
      </ReportSection>

      {LISTS.map((list) => (
        <ReportSection key={list} title={`${titles[list]} (${number(report[list].length)})`}>
          <ReportTable rows={report[list]} rowKey={(item) => item.serviceId} columns={columns} />
        </ReportSection>
      ))}

      <ReportSection title={t("triage.remediation")}>
        {REMEDIATION.map((list) => (
          <div key={list} className="grid gap-2">
            <h3 className="text-sm font-medium">
              {remediationTitles[list]} ({number(report.remediation[list].length)})
            </h3>
            <ReportTable rows={report.remediation[list]} rowKey={(item) => item.serviceId} columns={withDates} />
          </div>
        ))}
      </ReportSection>
    </ReportShell>
  );
}

export function TriageReportView({ scanId }: { scanId: string }) {
  return <ReportQuery query={useTriageReport(scanId)}>{(report) => <TriageBody report={report} />}</ReportQuery>;
}
