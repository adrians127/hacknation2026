import { useTranslation } from "react-i18next";

import type { SeverityCounts, TagsReport } from "@subsurf/contracts/reports/reports.schema";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChangeBadge } from "@/features/hosts/components/change-badge";
import { HostStatusBadge } from "@/features/hosts/components/host-status-badge";
import { TriageBadge } from "@/features/hosts/components/triage-badge";
import { useTagsReport } from "@/features/reports/api/get-tags-report";
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
import { serviceLabel } from "@/features/reports/lib/format";
import { scanDate, useReportMeta } from "@/features/reports/lib/use-report-meta";
import { formatNumber } from "@/lib/format";

const NONE = "__none__";
const SEVERITIES = ["high", "medium", "low", "info"] as const;

function tagsCsv(report: TagsReport): CsvTable {
  if (report.selected) {
    return {
      columns: ["tag", "ip", "hostnames", "status", "change", "triage", "hostTags", "port", "service", "serviceChange", "serviceTriage", "serviceTags"],
      rows: report.selected.hosts.flatMap((host) =>
        (host.services.length > 0 ? host.services : [null]).map((service) => [
          report.selected?.tag,
          host.ip,
          joinList(host.hostnames),
          host.status,
          host.change,
          host.triage,
          joinList(host.tags),
          service?.port,
          service ? serviceLabel(service.identity) : null,
          service?.change,
          service?.triage,
          service ? joinList(service.tags) : null,
        ]),
      ),
    };
  }
  return {
    columns: ["tag", "hosts", "services", "changedHosts", "high", "medium", "low", "info"],
    rows: report.tags.map((row) => [row.tag, row.hosts, row.services, row.changedHosts, ...SEVERITIES.map((severity) => row.findings[severity])]),
  };
}

function SeverityCountsCell({ counts }: { counts: SeverityCounts }) {
  const shown = SEVERITIES.filter((severity) => counts[severity] > 0 && severity !== "info");
  if (shown.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((severity) => (
        <span key={severity} className="flex items-center gap-1">
          <SeverityBadge severity={severity} />
          <span className="tabular-nums">{counts[severity]}</span>
        </span>
      ))}
    </span>
  );
}

function TagsBody({ report, tag, onTag }: { report: TagsReport; tag: string | undefined; onTag: (tag: string | undefined) => void }) {
  const { t } = useTranslation("reports");
  const meta = useReportMeta();
  const number = (value: number) => formatNumber(value, meta.locale);
  const selected = report.selected;

  return (
    <ReportShell
      title={selected ? t("tags.selected", { tag: selected.tag }) : t("kinds.tags.title")}
      description={t("kinds.tags.description")}
      meta={[meta.scan(report.scan), meta.generated(report.generatedAt)]}
      fileName={reportFileName(selected ? `tag-${selected.tag}` : "tags", scanDate(report.scan))}
      json={report}
      csv={() => tagsCsv(report)}
      controls={
        report.tags.length > 0 && (
          <div className="grid gap-1.5">
            <Label htmlFor="report-tag">{t("tags.pick")}</Label>
            <Select value={tag ?? NONE} onValueChange={(value) => onTag(value === NONE ? undefined : value)}>
              <SelectTrigger id="report-tag" className="min-w-56">
                <SelectValue placeholder={t("tags.pickPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("tags.all")}</SelectItem>
                {report.tags.map((row) => (
                  <SelectItem key={row.tag} value={row.tag}>
                    {row.tag} ({number(row.hosts)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )
      }
    >
      {selected ? (
        <>
          {selected.changes && (
            <ReportSection title={t("summary.changes")}>
              <StatGrid>
                <Stat label={t("summary.newHosts")} value={number(selected.changes.hosts.new)} tone="text-emerald-500" />
                <Stat label={t("summary.goneHosts")} value={number(selected.changes.hosts.gone)} tone="text-red-500" />
                <Stat label={t("summary.changedServices")} value={number(selected.changes.services.changed)} tone="text-amber-500" />
                <Stat label={t("summary.unknownHosts")} value={number(selected.changes.hosts.unknown)} />
              </StatGrid>
            </ReportSection>
          )}
          <ReportSection title={`${t("common.hosts")} (${number(selected.hosts.length)})`}>
            <ReportTable
              rows={selected.hosts}
              rowKey={(host) => host.hostId}
              limit={40}
              columns={[
                {
                  header: t("common.host"),
                  cell: (host) => (
                    <div className="grid gap-1">
                      <HostCell ip={host.ip} hostnames={host.hostnames} />
                      <span className="flex flex-wrap gap-1">
                        <HostStatusBadge status={host.status} />
                        <ChangeBadge change={host.change} />
                        <TriageBadge status={host.triage} />
                      </span>
                    </div>
                  ),
                },
                {
                  header: t("common.services"),
                  cell: (host) => (
                    <ul className="grid gap-1">
                      {host.services.map((service) => (
                        <li key={service.serviceId} className="flex flex-wrap items-center gap-2">
                          <Mono>{service.port}/tcp</Mono>
                          <span>{serviceLabel(service.identity)}</span>
                          <ChangeBadge change={service.change} />
                        </li>
                      ))}
                    </ul>
                  ),
                },
                { header: t("common.findings"), cell: (host) => <SeverityCountsCell counts={host.findings} /> },
                { header: t("common.tags"), cell: (host) => <TagChips tags={host.tags} /> },
              ]}
            />
          </ReportSection>
        </>
      ) : (
        <ReportSection title={t("tags.all")}>
          <ReportTable
            rows={report.tags}
            rowKey={(row) => row.tag}
            empty={t("tags.noTags")}
            limit={50}
            columns={[
              {
                header: t("tags.pick"),
                cell: (row) => (
                  <button type="button" className="text-brand hover:underline print:text-foreground" onClick={() => onTag(row.tag)}>
                    {row.tag}
                  </button>
                ),
              },
              { header: t("common.hosts"), cell: (row) => number(row.hosts), className: "text-right" },
              { header: t("common.services"), cell: (row) => number(row.services), className: "text-right" },
              { header: t("tags.changedHosts"), cell: (row) => number(row.changedHosts), className: "text-right" },
              { header: t("common.findings"), cell: (row) => <SeverityCountsCell counts={row.findings} /> },
            ]}
          />
        </ReportSection>
      )}
    </ReportShell>
  );
}

export function TagsReportView({
  scanId,
  tag,
  onTag,
}: {
  scanId: string;
  tag: string | undefined;
  onTag: (tag: string | undefined) => void;
}) {
  const query = useTagsReport(scanId, tag);
  return <ReportQuery query={query}>{(report) => <TagsBody report={report} tag={tag} onTag={onTag} />}</ReportQuery>;
}
