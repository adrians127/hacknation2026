import { ArrowLeftRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { DiffReport, ServiceSnapshot } from "@subsurf/contracts/reports/reports.schema";
import type { Scan } from "@subsurf/contracts/scans/scans.schema";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChangeBadge } from "@/features/hosts/components/change-badge";
import { useDiffReport } from "@/features/reports/api/get-diff-report";
import {
  HostCell,
  Mono,
  ReportQuery,
  ReportSection,
  ReportShell,
  ReportTable,
  Stat,
  StatGrid,
} from "@/features/reports/components/report-parts";
import { joinList, reportFileName, type CsvTable } from "@/features/reports/lib/export";
import { serviceLabel } from "@/features/reports/lib/format";
import { scanDate, useReportMeta } from "@/features/reports/lib/use-report-meta";
import { formatNumber } from "@/lib/format";

const snapshotText = (snapshot: ServiceSnapshot | null): string => {
  if (!snapshot) return "";
  const http = snapshot.http.map((endpoint) => `${endpoint.statusCode ?? "-"} ${endpoint.title ?? ""}`.trim());
  return [serviceLabel(snapshot.identity), ...snapshot.software, ...http, snapshot.certNotAfter ? `cert until ${snapshot.certNotAfter.slice(0, 10)}` : null]
    .filter(Boolean)
    .join(" | ");
};

function diffCsv(report: DiffReport): CsvTable {
  return {
    columns: ["ip", "hostnames", "hostChange", "status", "port", "serviceChange", "fields", "before", "after"],
    rows: report.hosts.flatMap((host) =>
      (host.services.length > 0 ? host.services : [null]).map((service) => [
        host.ip,
        joinList(host.hostnames),
        host.change,
        host.status,
        service?.port,
        service?.change,
        service ? joinList(service.fields) : null,
        snapshotText(service?.before ?? null),
        snapshotText(service?.after ?? null),
      ]),
    ),
  };
}

function Snapshot({ snapshot }: { snapshot: ServiceSnapshot | null }) {
  if (!snapshot) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="grid gap-0.5 text-xs">
      <span className="text-sm">{serviceLabel(snapshot.identity)}</span>
      {snapshot.software.map((line) => (
        <Mono key={line}>{line}</Mono>
      ))}
      {snapshot.http.map((endpoint) => (
        <span key={endpoint.url} className="break-all text-muted-foreground">
          {endpoint.statusCode ?? "—"} {endpoint.title ? `“${endpoint.title}”` : ""}
          {endpoint.finalUrl !== endpoint.url && ` → ${endpoint.finalUrl}`}
        </span>
      ))}
      {snapshot.certNotAfter && <span className="text-muted-foreground">TLS ≤ {snapshot.certNotAfter.slice(0, 10)}</span>}
    </div>
  );
}

function DiffBody({ report }: { report: DiffReport }) {
  const { t } = useTranslation("reports");
  const meta = useReportMeta();
  const number = (value: number) => formatNumber(value, meta.locale);
  const { counts } = report;

  return (
    <>
      <ReportSection
        title={t("diff.counts")}
        description={t("meta.range", { from: meta.date(scanDate(report.from)), to: meta.date(scanDate(report.to)) })}
      >
        <StatGrid>
          <Stat label={t("summary.newHosts")} value={number(counts.hosts.new)} tone="text-emerald-500" />
          <Stat label={t("summary.goneHosts")} value={number(counts.hosts.gone)} tone="text-red-500" />
          <Stat label={t("summary.unknownHosts")} value={number(counts.hosts.unknown)} />
          <Stat label={t("summary.changedServices")} value={number(counts.services.changed)} tone="text-amber-500" />
          <Stat label={`${t("common.services")}: +`} value={number(counts.services.new)} tone="text-emerald-500" />
          <Stat label={`${t("common.services")}: −`} value={number(counts.services.gone)} tone="text-red-500" />
        </StatGrid>
      </ReportSection>

      <ReportSection title={`${t("diff.hostsHeading")} (${number(report.hosts.length)})`}>
        <ReportTable
          rows={report.hosts}
          rowKey={(host) => host.hostId}
          limit={30}
          empty={t("diff.noChanges")}
          columns={[
            {
              header: t("common.host"),
              cell: (host) => (
                <div className="grid gap-1">
                  <HostCell ip={host.ip} hostnames={host.hostnames} />
                  <span>
                    <ChangeBadge change={host.change} />
                  </span>
                </div>
              ),
              className: "w-56",
            },
            {
              header: t("common.services"),
              cell: (host) =>
                host.services.length === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <div className="grid gap-2">
                    <div className="grid grid-cols-[5rem_1fr_1fr_8rem] gap-2 text-xs text-muted-foreground">
                      <span>{t("common.port")}</span>
                      <span>{t("diff.before")}</span>
                      <span>{t("diff.after")}</span>
                      <span>{t("diff.what")}</span>
                    </div>
                    {host.services.map((service) => (
                      <div key={service.serviceId} className="grid grid-cols-[5rem_1fr_1fr_8rem] gap-2 border-t pt-2 print:break-inside-avoid">
                        <div className="grid content-start gap-1">
                          <Mono>{service.port}/tcp</Mono>
                          <span>
                            <ChangeBadge change={service.change} />
                          </span>
                        </div>
                        <Snapshot snapshot={service.before} />
                        <Snapshot snapshot={service.after} />
                        <span className="text-xs">
                          {service.fields.map((field) => t(`diff.fields.${field}`)).join(", ") || "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                ),
            },
          ]}
        />
      </ReportSection>
    </>
  );
}

export function DiffReportView({
  scans,
  from,
  to,
  onChange,
}: {
  scans: readonly Scan[];
  from: string;
  to: string;
  onChange: (next: { from: string; to: string }) => void;
}) {
  const { t } = useTranslation("reports");
  const meta = useReportMeta();
  const query = useDiffReport(from, to);
  const label = (scan: Scan) => meta.date(scan.startedAt ?? scan.createdAt);
  const picker = (id: string, value: string, key: "from" | "to") => (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{t(`hub.${key}`)}</Label>
      <Select value={value} onValueChange={(next) => onChange(key === "from" ? { from: next, to } : { from, to: next })}>
        <SelectTrigger id={id} className="min-w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {scans.map((scan) => (
            <SelectItem key={scan.id} value={scan.id}>
              {label(scan)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <ReportShell
      title={t("kinds.diff.title")}
      description={t("kinds.diff.description")}
      meta={query.data ? [meta.generated(query.data.generatedAt)] : []}
      fileName={
        query.data
          ? reportFileName(`diff-${scanDate(query.data.from).slice(0, 10)}`, scanDate(query.data.to))
          : reportFileName("diff", null)
      }
      json={query.data ?? null}
      csv={() => (query.data ? diffCsv(query.data) : { columns: [], rows: [] })}
      controls={
        <>
          {picker("diff-from", from, "from")}
          <Button variant="outline" aria-label={t("actions.swap")} title={t("actions.swap")} onClick={() => onChange({ from: to, to: from })}>
            <ArrowLeftRight />
          </Button>
          {picker("diff-to", to, "to")}
        </>
      }
    >
      <ReportQuery query={query}>{(report) => <DiffBody report={report} />}</ReportQuery>
    </ReportShell>
  );
}
