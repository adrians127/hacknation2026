import { useTranslation } from "react-i18next";

import type { ScanSummaryReport } from "@subsurf/contracts/reports/reports.schema";

import { ChangeBadge } from "@/features/hosts/components/change-badge";
import { useScanSummaryReport } from "@/features/reports/api/get-summary-report";
import {
  HostCell,
  Mono,
  ReportQuery,
  ReportSection,
  ReportShell,
  ReportTable,
  SeverityBadge,
  Stat,
  StatGrid,
} from "@/features/reports/components/report-parts";
import { reportFileName, type CsvTable } from "@/features/reports/lib/export";
import { useReportMeta } from "@/features/reports/lib/use-report-meta";
import { formatDuration, formatNumber } from "@/lib/format";

const TRIAGE = ["unreviewed", "reviewed", "important", "false_positive"] as const;
const SEVERITIES = ["high", "medium", "low", "info"] as const;
const PHASES = ["hostDiscovery", "portScan", "serviceDetection", "http"] as const;
const STOP_REASONS = ["deadline", "stop_requested", "lease_lost", "error"] as const;
type StopReason = (typeof STOP_REASONS)[number];
const isStopReason = (reason: string): reason is StopReason => (STOP_REASONS as readonly string[]).includes(reason);

function summaryCsv(report: ScanSummaryReport): CsvTable {
  const { scan } = report;
  const rows: [string, string | number | null][] = [
    ["scan.id", scan.id],
    ["scan.status", scan.status],
    ["scan.startedAt", scan.startedAt],
    ["scan.finishedAt", scan.finishedAt],
    ["scan.durationMs", scan.durationMs],
    ["scan.addresses", scan.addressCount],
    ["scan.ports", scan.ports],
    ["scan.maxRate", scan.maxRate],
    ...Object.entries(scan.hosts).map(([status, count]): [string, number] => [`hosts.${status}`, count]),
    ["openPorts", scan.openPorts],
    ...SEVERITIES.map((severity): [string, number] => [`findings.${severity}`, report.findings[severity]]),
    ...(scan.changes
      ? [
          ...Object.entries(scan.changes.hosts).map(([kind, count]): [string, number] => [`changes.hosts.${kind}`, count]),
          ...Object.entries(scan.changes.services).map(([kind, count]): [string, number] => [`changes.services.${kind}`, count]),
        ]
      : []),
    ...report.topPorts.map(({ port, hosts }): [string, number] => [`topPorts.${port}`, hosts]),
    ...report.topTechnologies.map(({ name, hosts }): [string, number] => [`topTechnologies.${name}`, hosts]),
    ...report.topHosts.map(({ ip, score }): [string, number] => [`topHosts.${ip}`, score]),
    ["execution.results", report.execution.results],
    ["execution.partialResults", report.execution.partialResults],
    ["execution.failedResults", report.execution.failedResults],
    ...PHASES.map((phase): [string, number] => [`execution.phasesMs.${phase}`, report.execution.phasesMs[phase]]),
    ["execution.httpRequests", report.execution.httpRequests],
  ];
  return { columns: ["metric", "value"], rows };
}

function SummaryBody({ report }: { report: ScanSummaryReport }) {
  const { t } = useTranslation("reports");
  const { t: th } = useTranslation("hosts");
  const meta = useReportMeta();
  const number = (value: number) => formatNumber(value, meta.locale);
  const { scan, execution } = report;
  const noAnswer = scan.hosts.timeout + scan.hosts.cancelled + scan.hosts.failed;

  return (
    <ReportShell
      title={t("kinds.summary.title")}
      meta={[
        meta.scan(scan),
        scan.baseScan?.startedAt ? t("meta.compared", { date: meta.date(scan.baseScan.startedAt) }) : t("meta.firstScan"),
        meta.generated(report.generatedAt),
      ]}
      fileName={reportFileName("summary", scan.startedAt ?? scan.createdAt)}
      json={report}
      csv={() => summaryCsv(report)}
    >
      <ReportSection title={t("summary.overview")}>
        <StatGrid>
          <Stat label={t("summary.addresses")} value={number(scan.addressCount)} />
          <Stat label={t("summary.up")} value={number(scan.hosts.up)} />
          <Stat label={t("summary.noAnswer")} value={number(noAnswer)} />
          <Stat label={t("summary.openPorts")} value={number(scan.openPorts)} />
          <Stat
            label={t("summary.duration")}
            value={scan.durationMs === null ? "—" : formatDuration(Math.round(scan.durationMs / 1000))}
          />
          <Stat label={t("summary.rate")} value={`${number(scan.maxRate)}/s`} />
          {SEVERITIES.slice(0, 2).map((severity) => (
            <Stat
              key={severity}
              label={`${t("common.findings")}: ${t(`severity.${severity}`)}`}
              value={number(report.findings[severity])}
              tone={severity === "high" ? "text-red-500" : "text-amber-500"}
            />
          ))}
        </StatGrid>
      </ReportSection>

      <ReportSection title={t("summary.changes")} description={scan.changes ? undefined : t("meta.firstScan")}>
        {scan.changes && report.changes && (
          <>
            <StatGrid>
              <Stat label={t("summary.newHosts")} value={number(scan.changes.hosts.new)} tone="text-emerald-500" />
              <Stat label={t("summary.goneHosts")} value={number(scan.changes.hosts.gone)} tone="text-red-500" />
              <Stat label={t("summary.changedServices")} value={number(scan.changes.services.changed)} tone="text-amber-500" />
              <Stat label={t("summary.unknownHosts")} value={number(scan.changes.hosts.unknown)} />
            </StatGrid>
            <div className="grid gap-4 lg:grid-cols-2">
              {(["newHosts", "goneHosts"] as const).map((kind) => (
                <div key={kind} className="grid gap-2">
                  <h3 className="text-sm font-medium">{t(`summary.${kind}`)}</h3>
                  <ReportTable
                    rows={report.changes?.[kind] ?? []}
                    rowKey={(host) => host.hostId}
                    limit={10}
                    columns={[
                      { header: t("common.host"), cell: (host) => <HostCell ip={host.ip} hostnames={host.hostnames} /> },
                      { header: t("common.ports"), cell: (host) => <Mono>{host.ports.join(", ") || "—"}</Mono> },
                    ]}
                  />
                </div>
              ))}
            </div>
            <h3 className="text-sm font-medium">{t("summary.changedServices")}</h3>
            <ReportTable
              rows={report.changes.changedServices}
              rowKey={(row) => `${row.hostId}:${row.port}`}
              limit={10}
              columns={[
                { header: t("common.host"), cell: (row) => <HostCell ip={row.ip} /> },
                { header: t("common.port"), cell: (row) => <Mono>{row.port}/tcp</Mono> },
                { header: t("common.change"), cell: (row) => <ChangeBadge change={row.change} /> },
              ]}
            />
          </>
        )}
      </ReportSection>

      <ReportSection title={t("summary.topHosts")} description={t("findings.scoreHint")}>
        <StatGrid>
          {SEVERITIES.map((severity) => (
            <Stat key={severity} label={t(`severity.${severity}`)} value={number(report.findings[severity])} />
          ))}
        </StatGrid>
        <ReportTable
          rows={report.topHosts}
          rowKey={(host) => host.hostId}
          columns={[
            { header: t("common.host"), cell: (host) => <HostCell ip={host.ip} hostnames={host.hostnames} /> },
            { header: t("common.score"), cell: (host) => <span className="font-semibold tabular-nums">{host.score}</span> },
            {
              header: t("common.findings"),
              cell: (host) => (
                <ul className="grid gap-1">
                  {host.findings.slice(0, 4).map((finding) => (
                    <li key={`${finding.rule}:${finding.port}`} className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={finding.severity} />
                      <span>{t(`rules.${finding.rule}`)}</span>
                      <Mono>{finding.port}/tcp</Mono>
                    </li>
                  ))}
                </ul>
              ),
            },
          ]}
        />
      </ReportSection>

      <div className="grid gap-6 lg:grid-cols-2 print:grid-cols-2">
        <ReportSection title={t("summary.topPorts")}>
          <ReportTable
            rows={report.topPorts}
            rowKey={(row) => String(row.port)}
            columns={[
              { header: t("common.port"), cell: (row) => <Mono>{row.port}/tcp</Mono> },
              { header: t("common.hosts"), cell: (row) => number(row.hosts), className: "text-right" },
            ]}
          />
        </ReportSection>
        <ReportSection title={t("summary.topTechnologies")}>
          <ReportTable
            rows={report.topTechnologies}
            rowKey={(row) => row.name}
            columns={[
              { header: t("common.service"), cell: (row) => row.name },
              { header: t("common.category"), cell: (row) => t(`categories.${row.category}`) },
              { header: t("common.hosts"), cell: (row) => number(row.hosts), className: "text-right" },
            ]}
          />
        </ReportSection>
      </div>

      <ReportSection title={t("summary.triage")}>
        <div className="grid gap-4 sm:grid-cols-2">
          {(["hosts", "services"] as const).map((kind) => (
            <div key={kind} className="grid gap-2">
              <h3 className="text-sm font-medium">{t(`common.${kind}`)}</h3>
              <StatGrid>
                {TRIAGE.map((status) => (
                  <Stat key={status} label={th(`triage.${status}`)} value={number(report.triage[kind][status])} />
                ))}
              </StatGrid>
            </div>
          ))}
        </div>
      </ReportSection>

      <ReportSection title={t("summary.execution")}>
        <StatGrid>
          <Stat label={t("summary.results")} value={number(execution.results)} />
          <Stat label={t("summary.partial")} value={number(execution.partialResults)} />
          <Stat label={t("summary.failed")} value={number(execution.failedResults)} />
          <Stat label={t("summary.httpRequests")} value={number(execution.httpRequests)} hint={`${t("summary.httpEndpoints")}: ${number(execution.httpEndpoints)}`} />
        </StatGrid>
        {execution.stopReasons.length > 0 && (
          <p className="text-sm">
            {t("summary.stopReasons")}:{" "}
            {execution.stopReasons
              .map(({ reason, count }) => `${isStopReason(reason) ? t(`summary.stopReason.${reason}`) : reason} (${number(count)})`)
              .join(", ")}
          </p>
        )}
        <div className="grid gap-2">
          <h3 className="text-sm font-medium">{t("summary.phases")}</h3>
          <StatGrid>
            {PHASES.map((phase) => (
              <Stat
                key={phase}
                label={t(`summary.phase.${phase}`)}
                value={formatDuration(Math.round(execution.phasesMs[phase] / 1000))}
              />
            ))}
          </StatGrid>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("summary.workers")}:{" "}
          {execution.workers.map((worker) => `${worker.id} ${worker.version}${worker.nmapVersion ? ` (nmap ${worker.nmapVersion})` : ""}`).join(", ") || "—"}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("common.ports")}: <Mono>{scan.ports}</Mono>
        </p>
      </ReportSection>
    </ReportShell>
  );
}

export function SummaryReport({ scanId }: { scanId: string }) {
  return <ReportQuery query={useScanSummaryReport(scanId)}>{(report) => <SummaryBody report={report} />}</ReportQuery>;
}
