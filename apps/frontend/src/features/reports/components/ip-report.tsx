import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { IpReport } from "@subsurf/contracts/reports/reports.schema";

import { HostStatusBadge } from "@/features/hosts/components/host-status-badge";
import { TriageBadge } from "@/features/hosts/components/triage-badge";
import { useIpReport } from "@/features/reports/api/get-ip-report";
import {
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
import { STATUS_CELL } from "@/features/reports/lib/badges";
import { joinList, reportFileName, type CsvTable } from "@/features/reports/lib/export";
import { formatPercent, serviceLabel } from "@/features/reports/lib/format";
import { useReportMeta } from "@/features/reports/lib/use-report-meta";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

function Ports({ values, tone, sign = "" }: { values: readonly number[]; tone?: string; sign?: string }) {
  if (values.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <Mono>
      <span className={tone}>{values.map((port) => `${sign}${port}`).join(", ")}</span>
    </Mono>
  );
}

function ipCsv(report: IpReport): CsvTable {
  return {
    columns: ["kind", "scanId", "from", "to", "status", "latencyMs", "port", "openPorts", "opened", "closed", "changed", "service", "titles"],
    rows: [
      ...report.timeline.map((entry) => [
        "scan",
        entry.scanId,
        entry.scannedAt,
        null,
        entry.status,
        entry.latencyMs,
        null,
        joinList(entry.openPorts),
        joinList(entry.opened),
        joinList(entry.closed),
        joinList(entry.changed),
        null,
        null,
      ]),
      ...report.services.flatMap((service) =>
        service.states.map((state) => [
          "service-state",
          null,
          state.firstScanAt,
          state.lastScanAt,
          service.isOpen ? "open" : "closed",
          null,
          service.port,
          null,
          null,
          null,
          null,
          serviceLabel(state.snapshot.identity),
          state.snapshot.http.map((endpoint) => endpoint.title ?? "").filter(Boolean).join(" | "),
        ]),
      ),
    ],
  };
}

function IpBody({ report }: { report: IpReport }) {
  const { t } = useTranslation("reports");
  const { t: th } = useTranslation("hosts");
  const meta = useReportMeta();
  const number = (value: number) => formatNumber(value, meta.locale);
  const { host, stats } = report;

  return (
    <ReportShell
      title={`${t("kinds.ip.title")}: ${report.ip}`}
      description={host?.hostnames.join(", ") || undefined}
      meta={[meta.generated(report.generatedAt)]}
      fileName={reportFileName(`ip-${report.ip}`, report.generatedAt)}
      json={report}
      csv={() => ipCsv(report)}
    >
      <ReportSection title={t("ip.asset")}>
        <StatGrid>
          <Stat label={t("ip.scans")} value={number(stats.scans)} />
          <Stat
            label={t("ip.availability")}
            value={stats.availability === null ? "—" : formatPercent(stats.availability, meta.locale)}
            hint={`${number(stats.up)}/${number(stats.scans)} up`}
          />
          <Stat label={t("ip.transitions")} value={number(stats.transitions)} />
          <Stat label={t("ip.lastStatus")} value={<HostStatusBadge status={stats.lastStatus} />} />
        </StatGrid>
        {host ? (
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Stat label={t("ip.firstSeen")} value={<span className="text-sm font-normal">{meta.date(host.firstSeenAt)}</span>} />
            <Stat label={t("ip.lastSeen")} value={<span className="text-sm font-normal">{meta.date(host.lastSeenAt)}</span>} />
            <Stat label={t("common.triage")} value={<TriageBadge status={host.triage} />} />
            <Stat label={t("common.tags")} value={<TagChips tags={host.tags} />} />
            {host.note && (
              <div className="col-span-full grid gap-0.5">
                <dt className="text-xs text-muted-foreground">{t("ip.note")}</dt>
                <dd className="whitespace-pre-wrap">{host.note}</dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">{t("ip.noAsset")}</p>
        )}
        <div className="flex flex-wrap gap-1" aria-hidden="true">
          {report.timeline.map((entry) => (
            <span
              key={entry.scanId}
              title={`${meta.date(entry.scannedAt)}: ${th(`observation.${entry.status}`)}`}
              className={cn("size-4 rounded-sm", STATUS_CELL[entry.status])}
            />
          ))}
        </div>
      </ReportSection>

      <ReportSection title={t("ip.timeline")}>
        <ReportTable
          rows={report.timeline.toReversed()}
          rowKey={(entry) => entry.scanId}
          limit={20}
          columns={[
            {
              header: t("ip.scannedAt"),
              cell: (entry) => (
                <Link to={`/app/scans/${entry.scanId}`} className="text-brand hover:underline print:text-foreground">
                  {meta.date(entry.scannedAt)}
                </Link>
              ),
            },
            { header: t("common.status"), cell: (entry) => <HostStatusBadge status={entry.status} /> },
            { header: t("ip.latency"), cell: (entry) => (entry.latencyMs === null ? "—" : `${number(entry.latencyMs)} ms`), className: "text-right" },
            { header: t("ip.openPorts"), cell: (entry) => <Ports values={entry.openPorts} /> },
            { header: t("ip.opened"), cell: (entry) => <Ports values={entry.opened} tone="text-emerald-500" sign="+" /> },
            { header: t("ip.closed"), cell: (entry) => <Ports values={entry.closed} tone="text-red-500" sign="−" /> },
            { header: t("ip.changed"), cell: (entry) => <Ports values={entry.changed} tone="text-amber-500" /> },
          ]}
        />
      </ReportSection>

      <ReportSection title={t("ip.services")}>
        <ReportTable
          rows={report.services}
          rowKey={(service) => service.serviceId}
          columns={[
            {
              header: t("common.port"),
              cell: (service) => (
                <div className="grid gap-1">
                  <Mono>{service.port}/{service.protocol}</Mono>
                  <span className={cn("text-xs", service.isOpen ? "text-emerald-500" : "text-muted-foreground")}>
                    {service.isOpen ? t("ip.open") : t("ip.notOpen")}
                  </span>
                </div>
              ),
            },
            {
              header: t("ip.states"),
              cell: (service) => (
                <ol className="grid gap-1.5">
                  {service.states.map((state) => (
                    <li key={state.firstScanAt} className="grid gap-0.5">
                      <span className="text-xs text-muted-foreground">
                        {t("ip.stateRange", { from: meta.date(state.firstScanAt), to: meta.date(state.lastScanAt), count: state.scans })}
                      </span>
                      <span>{serviceLabel(state.snapshot.identity)}</span>
                      {state.snapshot.http.map((endpoint) => (
                        <span key={endpoint.url} className="text-xs break-all text-muted-foreground">
                          {endpoint.url} {endpoint.statusCode ?? "—"} {endpoint.title ?? ""}
                        </span>
                      ))}
                    </li>
                  ))}
                </ol>
              ),
            },
            { header: t("ip.seenIn"), cell: (service) => number(service.seenInScans), className: "text-right" },
            { header: t("common.triage"), cell: (service) => <TriageBadge status={service.triage} /> },
            { header: t("common.tags"), cell: (service) => <TagChips tags={service.tags} /> },
          ]}
        />
      </ReportSection>

      <div className="grid gap-6 lg:grid-cols-2 print:grid-cols-1">
        <ReportSection title={t("ip.findings")}>
          <ReportTable
            rows={report.findings}
            rowKey={(finding) => `${finding.serviceId}:${finding.rule}`}
            columns={[
              { header: t("common.severity"), cell: (finding) => <SeverityBadge severity={finding.severity} /> },
              {
                header: t("common.rule"),
                cell: (finding) => (
                  <div className="grid gap-0.5">
                    <span>
                      {t(`rules.${finding.rule}`)} <Mono>{finding.port}/tcp</Mono>
                    </span>
                    <span className="text-xs break-all text-muted-foreground">{finding.evidence}</span>
                  </div>
                ),
              },
            ]}
          />
        </ReportSection>
        <ReportSection title={t("ip.technologies")}>
          <ReportTable
            rows={report.technologies}
            rowKey={(technology) => `${technology.name}:${technology.port}`}
            columns={[
              { header: t("common.service"), cell: (technology) => technology.name },
              { header: t("common.version"), cell: (technology) => technology.version ?? "—" },
              { header: t("common.category"), cell: (technology) => t(`categories.${technology.category}`) },
              { header: t("common.port"), cell: (technology) => <Mono>{technology.port}</Mono> },
            ]}
          />
        </ReportSection>
      </div>
    </ReportShell>
  );
}

export function IpReportView({ ip }: { ip: string }) {
  return <ReportQuery query={useIpReport(ip)}>{(report) => <IpBody report={report} />}</ReportQuery>;
}
