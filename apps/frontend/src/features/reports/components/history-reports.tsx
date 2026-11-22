import { useTranslation } from "react-i18next";

import {
  DayPeriodSchema,
  StabilityClassSchema,
  type StabilityReport,
  type TimeOfDayReport,
} from "@subsurf/contracts/reports/reports.schema";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStabilityReport, type StabilityParams } from "@/features/reports/api/get-stability-report";
import { useTimeOfDayReport } from "@/features/reports/api/get-time-of-day-report";
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
import { STATUS_CELL } from "@/features/reports/lib/badges";
import { joinList, reportFileName, type CsvTable } from "@/features/reports/lib/export";
import { formatUtcOffset } from "@/features/reports/lib/format";
import { scanDate, useReportMeta } from "@/features/reports/lib/use-report-meta";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

function NumberSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  options: readonly number[];
  onChange: (value: number) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={String(value)} onValueChange={(next) => onChange(Number(next))}>
        <SelectTrigger id={id} className="min-w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[...new Set([...options, value])].toSorted((a, b) => a - b).map((option) => (
            <SelectItem key={option} value={String(option)}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// --- Stability --------------------------------------------------------------------------------

function stabilityCsv(report: StabilityReport): CsvTable {
  return {
    columns: ["ip", "hostnames", "class", "up", "transitions", "sinceLastUp", "unstablePorts", "recheck", ...report.scans.map((scan) => scanDate(scan))],
    rows: report.hosts.map((host) => [
      host.ip,
      joinList(host.hostnames),
      host.class,
      host.up,
      host.transitions,
      host.sinceLastUp,
      joinList(host.unstablePorts),
      host.recheck,
      ...host.history.map((status) => status ?? ""),
    ]),
  };
}

const CLASS_TONE: Record<StabilityReport["hosts"][number]["class"], string> = {
  flapping: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  unresponsive: "border-dashed text-muted-foreground",
  inactive: "border-red-500/40 bg-red-500/10 text-red-500",
  "going-quiet": "border-red-500/30 text-red-400",
  "unstable-ports": "border-sky-500/40 bg-sky-500/10 text-sky-500",
  returned: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
};

function StabilityBody({ report }: { report: StabilityReport }) {
  const { t } = useTranslation("reports");
  const { t: th } = useTranslation("hosts");
  const meta = useReportMeta();
  const number = (value: number) => formatNumber(value, meta.locale);

  const [first] = report.scans;
  const last = report.scans.at(-1);
  if (!first || !last || report.scans.length < 2) {
    return <p className="text-sm text-muted-foreground">{t("stability.needScans")}</p>;
  }
  return (
    <>
      <ReportSection
        title={t("summary.overview")}
        description={t("meta.range", { from: meta.date(scanDate(first)), to: meta.date(scanDate(last)) })}
      >
        <StatGrid>
          {StabilityClassSchema.options.map((name) => (
            <Stat key={name} label={t(`stability.classes.${name}`)} value={number(report.counts[name])} hint={t(`stability.hints.${name}`)} />
          ))}
        </StatGrid>
      </ReportSection>
      <ReportSection title={`${t("common.hosts")} (${number(report.hosts.length)})`}>
        <ReportTable
          rows={report.hosts}
          rowKey={(host) => host.hostId}
          limit={40}
          empty={t("stability.none")}
          columns={[
            { header: t("common.host"), cell: (host) => <HostCell ip={host.ip} hostnames={host.hostnames} /> },
            {
              header: t("common.status"),
              cell: (host) => (
                <Badge variant="outline" className={CLASS_TONE[host.class]} title={t(`stability.hints.${host.class}`)}>
                  {t(`stability.classes.${host.class}`)}
                </Badge>
              ),
            },
            {
              header: t("stability.history"),
              cell: (host) => (
                <span className="flex gap-0.5">
                  {host.history.map((status, index) => {
                    const scan = report.scans[index];
                    const when = scan ? meta.date(scanDate(scan)) : "";
                    return (
                      <span
                        key={scan?.id ?? index}
                        title={`${when}: ${status ? th(`observation.${status}`) : t("stability.notCovered")}`}
                        className={cn("size-3.5 rounded-sm", status ? STATUS_CELL[status] : "border border-dashed")}
                      />
                    );
                  })}
                </span>
              ),
            },
            { header: t("stability.transitions"), cell: (host) => number(host.transitions), className: "text-right" },
            { header: t("stability.sinceLastUp"), cell: (host) => number(host.sinceLastUp), className: "text-right" },
            { header: t("stability.unstablePorts"), cell: (host) => <Mono>{host.unstablePorts.join(", ") || "—"}</Mono> },
            { header: t("stability.recheck"), cell: (host) => (host.recheck ? t("stability.recheckYes") : "—") },
          ]}
        />
      </ReportSection>
    </>
  );
}

export function StabilityReportView({
  params,
  onChange,
}: {
  params: StabilityParams;
  onChange: (next: StabilityParams) => void;
}) {
  const { t } = useTranslation("reports");
  const meta = useReportMeta();
  const query = useStabilityReport(params);
  const report = query.data;
  const latest = report?.scans.at(-1);

  return (
    <ReportShell
      title={t("kinds.stability.title")}
      description={t("kinds.stability.description")}
      meta={report ? [latest ? meta.scan(latest) : null, meta.generated(report.generatedAt)] : []}
      fileName={reportFileName("stability", latest ? scanDate(latest) : null)}
      json={report ?? null}
      csv={() => (report ? stabilityCsv(report) : { columns: [], rows: [] })}
      controls={
        <>
          <NumberSelect
            id="stability-window"
            label={t("stability.window")}
            value={params.window}
            options={[2, 3, 5, 10, 20, 30]}
            onChange={(window) => onChange({ ...params, window })}
          />
          <NumberSelect
            id="stability-inactive"
            label={t("stability.inactiveAfter")}
            value={params.inactiveAfter}
            options={[1, 2, 3, 5]}
            onChange={(inactiveAfter) => onChange({ ...params, inactiveAfter })}
          />
        </>
      }
    >
      <ReportQuery query={query}>{(data) => <StabilityBody report={data} />}</ReportQuery>
    </ReportShell>
  );
}

// --- Time of day ------------------------------------------------------------------------------

function timeOfDayCsv(report: TimeOfDayReport): CsvTable {
  const periods = DayPeriodSchema.options;
  return {
    columns: ["ip", "hostnames", "upIn", "downIn", "periodPorts", ...periods.flatMap((period) => [`${period}.up`, `${period}.observed`, `${period}.ports`])],
    rows: report.hosts.map((host) => [
      host.ip,
      joinList(host.hostnames),
      joinList(host.upIn),
      joinList(host.downIn),
      joinList(host.periodPorts),
      ...host.periods.flatMap((entry) => [entry.up, entry.observed, joinList(entry.ports)]),
    ]),
  };
}

function TimeOfDayBody({ report }: { report: TimeOfDayReport }) {
  const { t } = useTranslation("reports");
  const meta = useReportMeta();
  const number = (value: number) => formatNumber(value, meta.locale);

  return (
    <>
      <ReportSection title={t("summary.overview")} description={t("timeOfDay.timezone", { offset: formatUtcOffset(report.utcOffsetMinutes) })}>
        <StatGrid>
          {report.periods.map((entry) => (
            <Stat key={entry.period} label={t(`timeOfDay.periods.${entry.period}`)} value={number(entry.scans)} hint={t("ip.scans")} />
          ))}
        </StatGrid>
        {!report.comparable && <p className="text-sm text-amber-500">{t("timeOfDay.notComparable")}</p>}
      </ReportSection>
      {report.comparable && (
        <ReportSection title={`${t("common.hosts")} (${number(report.hosts.length)})`}>
          <ReportTable
            rows={report.hosts}
            rowKey={(host) => host.hostId}
            limit={40}
            empty={t("timeOfDay.none")}
            columns={[
              { header: t("common.host"), cell: (host) => <HostCell ip={host.ip} hostnames={host.hostnames} /> },
              ...DayPeriodSchema.options.map((period) => ({
                header: t(`timeOfDay.periods.${period}`),
                cell: (host: TimeOfDayReport["hosts"][number]) => {
                  const entry = host.periods.find((candidate) => candidate.period === period);
                  if (!entry || entry.observed === 0) return <span className="text-muted-foreground">—</span>;
                  return (
                    <div className="grid gap-0.5">
                      <span className={cn("tabular-nums", host.upIn.includes(period) && "text-emerald-500", host.downIn.includes(period) && "text-red-500")}>
                        {t("timeOfDay.answers", { up: entry.up, observed: entry.observed })}
                      </span>
                      {entry.ports.length > 0 && <Mono>{entry.ports.join(", ")}</Mono>}
                    </div>
                  );
                },
              })),
              { header: t("timeOfDay.periodPorts"), cell: (host) => <Mono>{host.periodPorts.join(", ") || "—"}</Mono> },
            ]}
          />
        </ReportSection>
      )}
    </>
  );
}

export function TimeOfDayReportView({
  scans,
  utcOffsetMinutes,
  onScansChange,
}: {
  scans: number;
  utcOffsetMinutes: number;
  onScansChange: (scans: number) => void;
}) {
  const { t } = useTranslation("reports");
  const meta = useReportMeta();
  const query = useTimeOfDayReport(scans, utcOffsetMinutes);
  return (
    <ReportShell
      title={t("kinds.timeOfDay.title")}
      description={t("kinds.timeOfDay.description")}
      meta={query.data ? [meta.generated(query.data.generatedAt)] : []}
      fileName={reportFileName("time-of-day", query.data?.generatedAt)}
      json={query.data ?? null}
      csv={() => (query.data ? timeOfDayCsv(query.data) : { columns: [], rows: [] })}
      controls={
        <NumberSelect id="tod-scans" label={t("timeOfDay.scans")} value={scans} options={[10, 30, 50, 100]} onChange={onScansChange} />
      }
    >
      <ReportQuery query={query}>{(data) => <TimeOfDayBody report={data} />}</ReportQuery>
    </ReportShell>
  );
}
