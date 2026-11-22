import {
  Activity,
  ArrowRight,
  Clock,
  FileText,
  GitCompare,
  Layers,
  ListChecks,
  Network,
  ScanSearch,
  Tags,
  type LucideIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import { IpReportParamsSchema } from "@subsurf/contracts/reports/reports.schema";
import type { Scan } from "@subsurf/contracts/scans/scans.schema";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useScans } from "@/features/scans/api/get-scans";
import { SCAN_REPORT_KINDS, type ScanReportKind } from "@/features/reports/lib/report-kinds";
import { useReportMeta } from "@/features/reports/lib/use-report-meta";
import { useErrorMessage } from "@/hooks/use-error-message";

const ICONS: Record<ScanReportKind, LucideIcon> = {
  summary: FileText,
  findings: ScanSearch,
  technologies: Layers,
  exposure: Network,
  triage: ListChecks,
  tags: Tags,
};

const hasResults = (scan: Scan) => Object.values(scan.hosts).some((count) => count > 0);

function ReportLink({ to, Icon, title, description }: { to: string; Icon: LucideIcon; title: string; description: string }) {
  return (
    <Link
      to={to}
      className="group grid gap-1 rounded-xl border p-4 transition-colors hover:border-brand/60 hover:bg-brand/5 focus-visible:outline-2 focus-visible:outline-brand"
    >
      <span className="flex items-center gap-2 font-medium">
        <Icon className="size-4 text-brand" />
        {title}
        <ArrowRight className="ml-auto size-4 opacity-0 transition-opacity group-hover:opacity-100" />
      </span>
      <span className="text-sm text-muted-foreground">{description}</span>
    </Link>
  );
}

function ScanSelect({
  id,
  label,
  scans,
  value,
  onChange,
}: {
  id: string;
  label: string;
  scans: readonly Scan[];
  value: string;
  onChange: (id: string) => void;
}) {
  const meta = useReportMeta();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="min-w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {scans.map((scan) => (
            <SelectItem key={scan.id} value={scan.id}>
              {meta.date(scan.startedAt ?? scan.createdAt)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Hub({ scans }: { scans: readonly Scan[] }) {
  const { t } = useTranslation("reports");
  const navigate = useNavigate();
  const [newest, previous] = scans;
  const [scanId, setScanId] = useState(newest?.id ?? "");
  const [from, setFrom] = useState(previous?.id ?? newest?.id ?? "");
  const [to, setTo] = useState(newest?.id ?? "");
  const [ip, setIp] = useState("");
  const [ipError, setIpError] = useState(false);

  const openIp = (event: FormEvent) => {
    event.preventDefault();
    const parsed = IpReportParamsSchema.shape.ip.safeParse(ip.trim());
    setIpError(!parsed.success);
    if (parsed.success) void navigate(`/app/reports/ips/${parsed.data}`);
  };

  return (
    <div className="grid gap-6">
      <Card>
        <CardContent className="grid gap-4">
          <header className="flex flex-wrap items-end justify-between gap-4">
            <div className="grid gap-1">
              <h2 className="text-lg font-semibold">{t("hub.scanTitle")}</h2>
              <p className="text-sm text-muted-foreground">{t("hub.scanDescription")}</p>
            </div>
            {scans.length > 0 && (
              <ScanSelect id="hub-scan" label={t("hub.scanLabel")} scans={scans} value={scanId} onChange={setScanId} />
            )}
          </header>
          {scans.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("hub.noScans")}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {SCAN_REPORT_KINDS.map((kind) => (
                <ReportLink
                  key={kind}
                  to={`/app/reports/scans/${scanId}/${kind}`}
                  Icon={ICONS[kind]}
                  title={t(`kinds.${kind}.title`)}
                  description={t(`kinds.${kind}.description`)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="grid gap-4">
            <div className="grid gap-1">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <GitCompare className="size-4 text-brand" />
                {t("hub.diffTitle")}
              </h2>
              <p className="text-sm text-muted-foreground">{t("hub.diffDescription")}</p>
            </div>
            {scans.length < 2 ? (
              <p className="text-sm text-muted-foreground">{t("stability.needScans")}</p>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <ScanSelect id="hub-from" label={t("hub.from")} scans={scans} value={from} onChange={setFrom} />
                <ScanSelect id="hub-to" label={t("hub.to")} scans={scans} value={to} onChange={setTo} />
                <Button disabled={from === to} onClick={() => void navigate(`/app/reports/diff?from=${from}&to=${to}`)}>
                  {t("actions.open")}
                </Button>
              </div>
            )}
            {from === to && scans.length >= 2 && <p className="text-sm text-amber-500">{t("errors.SAME_SCAN", { ns: "common" })}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid gap-4">
            <div className="grid gap-1">
              <h2 className="text-lg font-semibold">{t("hub.ipTitle")}</h2>
              <p className="text-sm text-muted-foreground">{t("hub.ipDescription")}</p>
            </div>
            <form onSubmit={openIp} className="flex flex-wrap items-end gap-3" noValidate>
              <div className="grid min-w-56 flex-1 gap-1.5">
                <Label htmlFor="hub-ip">{t("hub.ipLabel")}</Label>
                <Input
                  id="hub-ip"
                  value={ip}
                  inputMode="decimal"
                  placeholder="10.40.1.10"
                  aria-invalid={ipError}
                  aria-describedby={ipError ? "hub-ip-error" : undefined}
                  onChange={(event) => setIp(event.target.value)}
                  className="font-mono"
                />
              </div>
              <Button type="submit">{t("actions.open")}</Button>
            </form>
            {ipError && (
              <p id="hub-ip-error" role="alert" className="text-sm text-destructive">
                {t("hub.ipInvalid")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="grid gap-4">
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold">{t("hub.historyTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("hub.historyDescription")}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <ReportLink
              to="/app/reports/stability"
              Icon={Activity}
              title={t("kinds.stability.title")}
              description={t("kinds.stability.description")}
            />
            <ReportLink
              to="/app/reports/time-of-day"
              Icon={Clock}
              title={t("kinds.timeOfDay.title")}
              description={t("kinds.timeOfDay.description")}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** Where every report starts: pick a scan, two scans or an address. */
export function ReportsHub() {
  const scans = useScans();
  const errorMessage = useErrorMessage();
  if (scans.isPending) return <Skeleton className="h-96 w-full" />;
  if (scans.isError) {
    return (
      <p role="alert" className="text-destructive">
        {errorMessage(scans.error)}
      </p>
    );
  }
  return <Hub scans={scans.data.items.filter(hasResults)} />;
}
