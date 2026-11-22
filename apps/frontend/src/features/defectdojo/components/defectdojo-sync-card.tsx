import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { toast } from "sonner";

import type { DefectDojoPush, DefectDojoSync } from "@subsurf/contracts/defectdojo/defectdojo.schema";

import { GuardedButton } from "@/components/guarded-button";
import { Card, CardContent } from "@/components/ui/card";
import { useDefectDojoStatus } from "@/features/defectdojo/api/get-defectdojo-status";
import { useSyncDefectDojo } from "@/features/defectdojo/api/sync-defectdojo";
import { useErrorMessage } from "@/hooks/use-error-message";
import { useCan } from "@/lib/auth/use-can";
import { formatDateTime, formatNumber } from "@/lib/format";

function LastSync({ sync }: { sync: DefectDojoSync | null }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  if (!sync) return <>{t("defectdojo.never")}</>;

  const when = formatDateTime(sync.startedAt, locale);
  const by = sync.startedBy?.displayName ?? t("defectdojo.unknownUser");
  if (sync.status === "running") return <>{t("defectdojo.running", { when, by })}</>;
  if (sync.status === "failed" || !sync.stats) {
    return <span className="text-destructive">{t("defectdojo.failed", { when, by, error: sync.error ?? "" })}</span>;
  }
  const n = (value: number) => formatNumber(value, locale);
  return (
    <>
      {t("defectdojo.succeeded", {
        when,
        by,
        findings: n(sync.stats.findings),
        matched: n(sync.stats.matchedFindings),
        services: n(sync.stats.servicesUpdated),
        hosts: n(sync.stats.hostsUpdated),
        tags: n(sync.stats.tagsAdded),
      })}
    </>
  );
}

function LastPush({ push }: { push: DefectDojoPush }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const when = formatDateTime(push.startedAt, locale);
  const by = push.startedBy?.displayName ?? t("defectdojo.unknownUser");
  if (push.status === "failed") {
    return <span className="text-destructive">{t("defectdojo.push.lastFailed", { when, by, error: push.error ?? "" })}</span>;
  }
  if (push.status === "running" || !push.stats) return <>{t("defectdojo.syncing")}</>;
  return (
    <Link to={`/app/scans/${push.scanId}`} className="hover:underline">
      {t("defectdojo.push.last", {
        when,
        by,
        findings: formatNumber(push.findings, locale),
        created: formatNumber(push.stats.created, locale),
        closed: formatNumber(push.stats.closed, locale),
      })}
    </Link>
  );
}

/** Pulls tags, owners, triage and remediation dates from DefectDojo into the hosts. */
export function DefectDojoSyncCard() {
  const { t, i18n } = useTranslation();
  const errorMessage = useErrorMessage();
  const canRead = useCan("defectdojo:read");
  const status = useDefectDojoStatus(canRead);
  const sync = useSyncDefectDojo();
  if (!canRead) return null;

  const configured = status.data?.configured ?? false;
  const run = () =>
    sync.mutate(
      {},
      {
        onSuccess: (result) =>
          toast.success(
            t("defectdojo.toast", {
              services: formatNumber(result.stats?.servicesUpdated ?? 0, i18n.resolvedLanguage),
              hosts: formatNumber(result.stats?.hostsUpdated ?? 0, i18n.resolvedLanguage),
            }),
          ),
        onError: (error) => toast.error(errorMessage(error)),
      },
    );

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <h2 className="text-sm font-medium">{t("defectdojo.title")}</h2>
          <p className="text-sm text-muted-foreground">
            {status.isPending ? (
              "…"
            ) : status.isError ? (
              <span className="text-destructive">{errorMessage(status.error)}</span>
            ) : !configured ? (
              t("defectdojo.notConfigured")
            ) : (
              <LastSync sync={status.data.lastSync} />
            )}
          </p>
          {status.data?.lastPush && (
            <p className="text-sm text-muted-foreground">
              <LastPush push={status.data.lastPush} />
            </p>
          )}
        </div>
        <GuardedButton
          variant="outline"
          permissions={["defectdojo:import"]}
          disabledReason={status.isSuccess && !configured ? t("defectdojo.notConfigured") : undefined}
          tooltip={t("defectdojo.hint")}
          disabled={sync.isPending}
          onClick={run}
        >
          <RefreshCw className={sync.isPending ? "animate-spin" : undefined} />
          {sync.isPending ? t("defectdojo.syncing") : t("defectdojo.sync")}
        </GuardedButton>
      </CardContent>
    </Card>
  );
}
