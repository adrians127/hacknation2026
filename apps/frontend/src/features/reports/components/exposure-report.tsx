import { useTranslation } from "react-i18next";

import type { ExposureReport } from "@subsurf/contracts/reports/reports.schema";

import { useExposureReport } from "@/features/reports/api/get-exposure-report";
import {
  Mono,
  ReportQuery,
  ReportSection,
  ReportShell,
  ReportTable,
  Stat,
  StatGrid,
} from "@/features/reports/components/report-parts";
import { reportFileName, type CsvTable } from "@/features/reports/lib/export";
import { scanDate, useReportMeta } from "@/features/reports/lib/use-report-meta";
import { formatNumber } from "@/lib/format";

function exposureCsv(report: ExposureReport): CsvTable {
  return {
    columns: ["port", "protocol", "hosts", "newHosts", "services"],
    rows: report.ports.map((row) => [
      row.port,
      row.protocol,
      row.hosts,
      row.newHosts,
      row.services.map((service) => `${service.name}:${service.count}`).join(" "),
    ]),
  };
}

/** A bar scaled to the largest value, so the table reads like a chart (and prints as one). */
function Bar({ value, max }: { value: number; max: number }) {
  return (
    <span className="block h-2 w-full min-w-16 rounded-full bg-muted print:border">
      <span
        className="block h-2 rounded-full bg-brand print:bg-neutral-700"
        style={{ width: `${max === 0 ? 0 : Math.max(2, (value / max) * 100)}%` }}
      />
    </span>
  );
}

function ExposureBody({ report }: { report: ExposureReport }) {
  const { t } = useTranslation("reports");
  const meta = useReportMeta();
  const number = (value: number) => formatNumber(value, meta.locale);
  const maxHosts = Math.max(0, ...report.ports.map((row) => row.hosts));
  const maxSubnet = Math.max(0, ...report.subnets.map((row) => row.hostsUp));

  return (
    <ReportShell
      title={t("kinds.exposure.title")}
      description={t("kinds.exposure.description")}
      meta={[meta.scan(report.scan), meta.generated(report.generatedAt)]}
      fileName={reportFileName("exposure", scanDate(report.scan))}
      json={report}
      csv={() => exposureCsv(report)}
    >
      <ReportSection title={t("summary.overview")}>
        <StatGrid>
          <Stat label={t("exposure.hostsUp")} value={number(report.totals.hostsUp)} />
          <Stat label={t("exposure.openPorts")} value={number(report.totals.openPorts)} />
          <Stat label={t("exposure.distinctPorts")} value={number(report.totals.distinctPorts)} />
        </StatGrid>
      </ReportSection>

      <ReportSection title={t("exposure.ports")}>
        <ReportTable
          rows={report.ports}
          rowKey={(row) => String(row.port)}
          limit={40}
          columns={[
            { header: t("common.port"), cell: (row) => <Mono>{row.port}/{row.protocol}</Mono> },
            {
              header: t("common.service"),
              cell: (row) => row.services.map((service) => `${service.name} (${number(service.count)})`).join(", "),
            },
            { header: t("common.hosts"), cell: (row) => number(row.hosts), className: "text-right tabular-nums" },
            { header: "", cell: (row) => <Bar value={row.hosts} max={maxHosts} />, className: "w-1/4" },
            {
              header: t("exposure.newHosts"),
              cell: (row) => (row.newHosts > 0 ? <span className="text-emerald-500">+{number(row.newHosts)}</span> : "—"),
              className: "text-right",
            },
          ]}
        />
      </ReportSection>

      <ReportSection title={t("exposure.subnets")}>
        <ReportTable
          rows={report.subnets}
          rowKey={(row) => row.cidr}
          limit={40}
          columns={[
            { header: t("exposure.network"), cell: (row) => <Mono>{row.cidr}</Mono> },
            { header: t("exposure.hostsUp"), cell: (row) => number(row.hostsUp), className: "text-right tabular-nums" },
            { header: "", cell: (row) => <Bar value={row.hostsUp} max={maxSubnet} />, className: "w-1/4" },
            { header: t("exposure.openPorts"), cell: (row) => number(row.openPorts), className: "text-right tabular-nums" },
            { header: t("exposure.topPorts"), cell: (row) => <Mono>{row.topPorts.join(", ")}</Mono> },
          ]}
        />
      </ReportSection>
    </ReportShell>
  );
}

export function ExposureReportView({ scanId }: { scanId: string }) {
  return <ReportQuery query={useExposureReport(scanId)}>{(report) => <ExposureBody report={report} />}</ReportQuery>;
}
