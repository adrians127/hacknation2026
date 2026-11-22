import { useTranslation } from "react-i18next";

import type { TriageStatus } from "@subsurf/contracts/hosts/hosts.schema";
import type { RulePreviewBody, RulePreviewItem } from "@subsurf/contracts/rules/rules.schema";
import type { ChangePriority } from "@subsurf/contracts/scans/scan-changes.schema";
import type { VulnerabilityTriageStatus } from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";

import { Skeleton } from "@/components/ui/skeleton";
import { useRulePreview } from "@/features/rules/api/preview-rule";
import { useErrorMessage } from "@/hooks/use-error-message";
import { formatDateTime } from "@/lib/format";

function Target({ item }: { item: RulePreviewItem }) {
  return (
    <span className="font-mono">
      {item.ip}
      {item.port !== null && `:${item.port}`}
      {item.vulnerabilityId && ` ${item.vulnerabilityId}`}
    </span>
  );
}

/** What the rule in the form would do now, before it is saved. */
export function RulePreview({ body }: { body: RulePreviewBody | null }) {
  const { t } = useTranslation("rules");
  const { t: th } = useTranslation("hosts");
  const { t: tv } = useTranslation("vulnerabilities");
  const { t: tc, i18n } = useTranslation();
  const errorMessage = useErrorMessage();
  const preview = useRulePreview(body);

  const triageLabel = (value: TriageStatus | VulnerabilityTriageStatus) =>
    value === "accepted_risk" ? tv("triage.accepted_risk") : th(`triage.${value}`);
  const priorityLabel = (value: ChangePriority | "muted") =>
    value === "muted" ? t("actions.mute") : tc(`dashboard.priority.${value}`);

  if (body === null) {
    return <p className="text-sm text-muted-foreground">{t("preview.invalid")}</p>;
  }
  if (preview.isPending) return <Skeleton className="h-24 w-full" />;
  if (preview.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorMessage(preview.error)}
      </p>
    );
  }
  const { data } = preview;

  return (
    <div className="grid gap-2 text-sm" aria-live="polite">
      <p>
        {t("preview.counts", {
          matched: data.matched,
          changes: data.changes,
          unchanged: data.unchanged,
          skipped: data.skipped,
        })}
      </p>
      {data.scan && (
        <p className="text-xs text-muted-foreground">
          {t("preview.scan", {
            date: data.scan.startedAt ? formatDateTime(data.scan.startedAt, i18n.language) : data.scan.id,
          })}
        </p>
      )}
      {data.skipped > 0 && <p className="text-xs text-muted-foreground">{t("preview.skippedHint")}</p>}
      {data.samples.length > 0 && (
        <ul className="grid max-h-48 gap-1 overflow-y-auto rounded-md border p-2 text-xs">
          {data.samples.map((item) => (
            <li
              key={[item.hostId, item.serviceId, item.vulnerabilityId, item.field, item.key].join("|")}
              className="flex flex-wrap items-center gap-x-2"
            >
              <Target item={item} />
              {item.field && <span>{th(`fieldChange.fields.${item.field}`)}</span>}
              {item.triage && (
                <span className="text-muted-foreground">
                  {triageLabel(item.triage.before)} → {triageLabel(item.triage.after)}
                </span>
              )}
              {item.tag && <span className="text-muted-foreground">+{item.tag}</span>}
              {item.priority && (
                <span className="text-muted-foreground">
                  {priorityLabel(item.priority.before)} → {priorityLabel(item.priority.after)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
