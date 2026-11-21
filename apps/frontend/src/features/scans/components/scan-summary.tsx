import { useTranslation } from "react-i18next";

import type { ScanChangeFilter, ScanDetail } from "@subsurf/contracts/scans/scan-results.schema";

import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime, formatDuration, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}

const CHANGE_TONE: Record<Exclude<ScanChangeFilter, "any">, string> = {
  new: "text-emerald-500",
  gone: "text-red-500",
  changed: "text-amber-500",
  unknown: "text-muted-foreground",
};

/** What the scan found, and buttons that filter the host list by kind of change. */
export function ScanSummary({
  scan,
  activeChange,
  onChangeFilter,
}: {
  scan: ScanDetail;
  activeChange: ScanChangeFilter | undefined;
  onChangeFilter: (change: ScanChangeFilter | undefined) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const number = (value: number) => formatNumber(value, locale);
  const noAnswer = scan.hosts.timeout + scan.hosts.cancelled + scan.hosts.failed;
  const jobsDone = scan.jobs.completed + scan.jobs.stopped + scan.jobs.failed;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label={t("scans.detail.addresses")} value={number(scan.addressCount)} />
            <Stat
              label={t("scans.detail.up")}
              value={number(scan.hosts.up)}
              hint={t("scans.detail.down", { formatted: number(scan.hosts.down) })}
            />
            <Stat label={t("scans.detail.noAnswer")} value={number(noAnswer)} />
            <Stat label={t("scans.detail.openPorts")} value={number(scan.openPorts)} />
            <Stat
              label={t("scans.detail.jobs")}
              value={`${number(jobsDone)}/${number(scan.jobCount)}`}
              hint={scan.jobs.stopped > 0 ? t("scans.detail.stoppedJobs", { formatted: number(scan.jobs.stopped) }) : undefined}
            />
            <Stat
              label={t("scans.detail.duration")}
              value={scan.durationMs === null ? "—" : formatDuration(Math.round(scan.durationMs / 1000))}
            />
            <Stat label={t("scans.detail.rate")} value={`${number(scan.maxRate)}/s`} />
            <div className="col-span-full grid gap-0.5">
              <dt className="text-xs text-muted-foreground">{t("scans.detail.ports")}</dt>
              <dd className="font-mono text-xs break-all">{scan.ports}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-3">
          {scan.changes && scan.baseScan ? (
            <>
              <p className="text-sm text-muted-foreground">
                {t("scans.detail.comparedWith", {
                  date: scan.baseScan.startedAt ? formatDateTime(scan.baseScan.startedAt, locale) : "—",
                })}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(["new", "gone", "changed", "unknown"] as const).map((change) => {
                  const active = activeChange === change;
                  return (
                    <button
                      key={change}
                      type="button"
                      aria-pressed={active}
                      onClick={() => onChangeFilter(active ? undefined : change)}
                      className={cn(
                        "grid gap-0.5 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50",
                        active && "border-brand bg-brand/10",
                      )}
                    >
                      <span className={cn("text-xl font-semibold tabular-nums", CHANGE_TONE[change])}>
                        {number(scan.changes?.hosts[change] ?? 0)}
                      </span>
                      <span className="text-xs text-muted-foreground">{t(`scans.detail.hosts.${change}`)}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("scans.detail.serviceChanges", {
                  new: number(scan.changes.services.new),
                  gone: number(scan.changes.services.gone),
                  changed: number(scan.changes.services.changed),
                })}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("scans.detail.firstScan")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
