import { History, RefreshCw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type {
  SyncMode,
  VulnerabilitySource,
} from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";

import { GuardedButton } from "@/components/guarded-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useVulnerabilitySources } from "@/features/vulnerabilities/api/get-sources";
import { useRequestSync } from "@/features/vulnerabilities/api/request-sync";
import { useUpdateSource } from "@/features/vulnerabilities/api/update-source";
import { SyncRunsDialog } from "@/features/vulnerabilities/components/sync-runs-dialog";
import { useErrorMessage } from "@/hooks/use-error-message";
import { useCan } from "@/lib/auth/use-can";
import { formatDateTime, formatNumber } from "@/lib/format";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function SourceCard({
  source,
  onShowRuns,
}: {
  source: VulnerabilitySource;
  onShowRuns: (source: VulnerabilitySource) => void;
}) {
  const { t, i18n } = useTranslation("vulnerabilities");
  const locale = i18n.resolvedLanguage;
  const errorMessage = useErrorMessage();
  const canRun = useCan("vulnerabilities:run");
  const requestSync = useRequestSync();
  const updateSource = useUpdateSource();
  const date = (value: string | null) => (value ? formatDateTime(value, locale) : t("sources.never"));
  const next = [source.nextIncrementalAt, source.nextFullAt]
    .filter((value): value is string => value !== null)
    .toSorted()[0];
  const busy = source.running !== null || source.pendingRequest !== null;

  const sync = (mode: SyncMode) =>
    requestSync.mutate(
      { params: { path: { id: source.id } }, body: { mode } },
      {
        onSuccess: () => toast.success(t("toast.syncRequested")),
        onError: (error) => toast.error(errorMessage(error)),
      },
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {source.displayName}
          <Badge variant={source.enabled ? "secondary" : "outline"}>
            {source.enabled ? t("sources.enabled") : t("sources.disabled")}
          </Badge>
        </CardTitle>
        <CardAction className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => onShowRuns(source)}>
            <History />
            {t("sources.runs")}
          </Button>
          <GuardedButton
            size="sm"
            variant="outline"
            permissions={["vulnerabilities:run"]}
            disabled={!source.enabled || busy || requestSync.isPending}
            onClick={() => sync("full")}
          >
            {t("sources.fullSync")}
          </GuardedButton>
          <GuardedButton
            size="sm"
            permissions={["vulnerabilities:run"]}
            disabled={!source.enabled || busy || requestSync.isPending}
            onClick={() => sync("incremental")}
          >
            <RefreshCw className={busy ? "animate-spin" : undefined} />
            {t("sources.syncNow")}
          </GuardedButton>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        {source.running && (
          <p className="text-sm text-brand">
            {t("sources.running", {
              mode: t(`sources.modes.${source.running.mode}`),
              date: formatDateTime(source.running.startedAt, locale),
            })}
          </p>
        )}
        {!source.running && source.pendingRequest && (
          <p className="text-sm text-muted-foreground">
            {t("sources.pending", { kind: t(`sources.requests.${source.pendingRequest.kind}`) })}
          </p>
        )}
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label={t("sources.records")}>{formatNumber(source.recordCount, locale)}</Field>
          <Field label={t("sources.lastFull")}>{date(source.lastFullAt)}</Field>
          <Field label={t("sources.lastIncremental")}>{date(source.lastIncrementalAt)}</Field>
          <Field label={t("sources.nextSync")}>{next ? formatDateTime(next, locale) : "—"}</Field>
          <Field label={t("sources.baseUrl")}>
            <span className="font-mono text-xs break-all">{source.baseUrl}</span>
          </Field>
          {source.scopes.length > 0 && (
            <Field label={t("sources.scopes")}>{source.scopes.join(", ")}</Field>
          )}
        </dl>
        {source.lastError && (
          <p role="alert" className="text-sm text-destructive">
            {t("sources.lastError")}: {source.lastError}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Checkbox
            id={`source-${source.id}`}
            checked={source.enabled}
            disabled={!canRun || updateSource.isPending}
            onCheckedChange={(checked) =>
              updateSource.mutate(
                { params: { path: { id: source.id } }, body: { enabled: checked === true } },
                {
                  onSuccess: (updated) =>
                    toast.success(t(updated.enabled ? "toast.sourceEnabled" : "toast.sourceDisabled")),
                  onError: (error) => toast.error(errorMessage(error)),
                },
              )
            }
          />
          <Label htmlFor={`source-${source.id}`}>
            {t("sources.toggle", { name: source.displayName })}
          </Label>
        </div>
      </CardContent>
    </Card>
  );
}

/** The mirrored vulnerability databases: their sync state, history and manual syncs. */
export function SourcesPanel() {
  const { t } = useTranslation("vulnerabilities");
  const errorMessage = useErrorMessage();
  const sources = useVulnerabilitySources();
  const [runsOf, setRunsOf] = useState<VulnerabilitySource | null>(null);

  if (sources.isPending) return <Skeleton className="h-64 w-full" />;
  if (sources.isError) {
    return (
      <p role="alert" className="text-destructive">
        {errorMessage(sources.error)}
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      <p className={sources.data.syncProcessActive ? "text-sm text-muted-foreground" : "text-sm text-amber-600 dark:text-amber-400"}>
        {sources.data.syncProcessActive ? t("sources.processActive") : t("sources.processInactive")}
      </p>
      {sources.data.items.map((source) => (
        <SourceCard key={source.id} source={source} onShowRuns={setRunsOf} />
      ))}
      <p className="text-xs text-muted-foreground">{t("sources.attribution")}</p>
      {runsOf && <SyncRunsDialog source={runsOf} onClose={() => setRunsOf(null)} />}
    </div>
  );
}
