import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { FindingSeveritySchema, type FindingSeverity, type FindingsReport } from "@subsurf/contracts/reports/reports.schema";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChangeBadge } from "@/features/hosts/components/change-badge";
import { TriageBadge } from "@/features/hosts/components/triage-badge";
import { useFindingsReport } from "@/features/reports/api/get-findings-report";
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
  TagChips,
} from "@/features/reports/components/report-parts";
import { joinList, reportFileName, type CsvTable } from "@/features/reports/lib/export";
import { scanDate, useReportMeta } from "@/features/reports/lib/use-report-meta";
import { formatNumber } from "@/lib/format";

const SEVERITIES = FindingSeveritySchema.options;
const ALL = "all";

function findingsCsv(report: FindingsReport): CsvTable {
  return {
    columns: ["ip", "hostnames", "score", "triage", "tags", "port", "rule", "severity", "evidence"],
    rows: report.hosts.flatMap((host) =>
      host.findings.map((finding) => [
        host.ip,
        joinList(host.hostnames),
        host.score,
        host.triage,
        joinList(host.tags),
        finding.port,
        finding.rule,
        finding.severity,
        finding.evidence,
      ]),
    ),
  };
}

function FindingsBody({ report }: { report: FindingsReport }) {
  const { t } = useTranslation("reports");
  const meta = useReportMeta();
  const number = (value: number) => formatNumber(value, meta.locale);
  const [minimum, setMinimum] = useState<FindingSeverity | typeof ALL>(ALL);

  const hosts = useMemo(() => {
    if (minimum === ALL) return report.hosts;
    const allowed = new Set(SEVERITIES.slice(0, SEVERITIES.indexOf(minimum) + 1));
    return report.hosts
      .map((host) => ({ ...host, findings: host.findings.filter((finding) => allowed.has(finding.severity)) }))
      .filter((host) => host.findings.length > 0);
  }, [report.hosts, minimum]);

  return (
    <ReportShell
      title={t("kinds.findings.title")}
      description={t("kinds.findings.description")}
      meta={[meta.scan(report.scan), meta.generated(report.generatedAt)]}
      fileName={reportFileName("findings", scanDate(report.scan))}
      json={report}
      csv={() => findingsCsv(report)}
      controls={
        <div className="grid gap-1.5">
          <Label htmlFor="min-severity">{t("findings.minSeverity")}</Label>
          <Select value={minimum} onValueChange={(value) => setMinimum(value === ALL ? ALL : FindingSeveritySchema.parse(value))}>
            <SelectTrigger id="min-severity" className="min-w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("findings.allSeverities")}</SelectItem>
              {SEVERITIES.map((severity) => (
                <SelectItem key={severity} value={severity}>
                  {t(`severity.${severity}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
    >
      <ReportSection title={t("findings.byRule")}>
        <StatGrid>
          {SEVERITIES.map((severity) => (
            <Stat key={severity} label={t(`severity.${severity}`)} value={number(report.counts[severity])} />
          ))}
        </StatGrid>
        <ReportTable
          rows={report.byRule}
          rowKey={(row) => row.rule}
          columns={[
            { header: t("common.severity"), cell: (row) => <SeverityBadge severity={row.severity} /> },
            { header: t("common.rule"), cell: (row) => t(`rules.${row.rule}`) },
            { header: t("common.count"), cell: (row) => number(row.count), className: "text-right" },
          ]}
        />
      </ReportSection>

      <ReportSection title={t("findings.hosts")} description={t("findings.scoreHint")}>
        <ReportTable
          rows={hosts}
          rowKey={(host) => host.hostId}
          limit={30}
          columns={[
            {
              header: t("common.host"),
              cell: (host) => (
                <div className="grid gap-1">
                  <HostCell ip={host.ip} hostnames={host.hostnames} />
                  <span className="flex flex-wrap gap-1">
                    <ChangeBadge change={host.change} />
                    {host.triage !== "unreviewed" && <TriageBadge status={host.triage} />}
                  </span>
                </div>
              ),
            },
            { header: t("common.score"), cell: (host) => <span className="font-semibold tabular-nums">{host.score}</span> },
            {
              header: t("common.findings"),
              cell: (host) => (
                <ul className="grid gap-1.5">
                  {host.findings.map((finding) => (
                    <li key={`${finding.serviceId}:${finding.rule}`} className="grid gap-0.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <SeverityBadge severity={finding.severity} />
                        <span className="font-medium">{t(`rules.${finding.rule}`)}</span>
                        <Mono>{finding.port}/tcp</Mono>
                      </span>
                      <span className="text-xs break-all text-muted-foreground">{finding.evidence}</span>
                    </li>
                  ))}
                </ul>
              ),
            },
            { header: t("common.tags"), cell: (host) => <TagChips tags={host.tags} /> },
          ]}
        />
      </ReportSection>
    </ReportShell>
  );
}

export function FindingsReportView({ scanId }: { scanId: string }) {
  return <ReportQuery query={useFindingsReport(scanId)}>{(report) => <FindingsBody report={report} />}</ReportQuery>;
}
