import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type {
  HostHistoryEntry,
  ScanServiceDetail,
} from "@subsurf/contracts/scans/scan-results.schema";
import type { ServiceVulnerability } from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";

import { GuardedButton } from "@/components/guarded-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateVulnerabilityTriage } from "@/features/vulnerabilities/api/update-triage";
import { KevBadge } from "@/features/vulnerabilities/components/kev-badge";
import { SeverityBadge } from "@/features/vulnerabilities/components/severity-badge";
import { VulnerabilityTriageControl } from "@/features/vulnerabilities/components/vulnerability-triage-control";
import { useErrorMessage } from "@/hooks/use-error-message";
import { useCan } from "@/lib/auth/use-can";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

function NoteEditor({ serviceId, match }: { serviceId: string; match: ServiceVulnerability }) {
  const { t } = useTranslation("vulnerabilities");
  const errorMessage = useErrorMessage();
  const canEdit = useCan("vulnerabilities:update");
  const update = useUpdateVulnerabilityTriage();
  const [note, setNote] = useState(match.note);

  if (!canEdit) {
    return match.note ? <p className="text-sm whitespace-pre-wrap">{match.note}</p> : null;
  }
  return (
    <div className="grid gap-1.5">
      <Textarea
        value={note}
        maxLength={2000}
        rows={2}
        aria-label={t("service.note")}
        placeholder={t("service.notePlaceholder")}
        onChange={(event) => setNote(event.target.value)}
      />
      <GuardedButton
        size="sm"
        variant="outline"
        className="w-fit"
        permissions={["vulnerabilities:update"]}
        disabled={update.isPending || note.trim() === match.note}
        onClick={() =>
          update.mutate(
            {
              params: { path: { serviceId, canonicalId: match.canonicalId } },
              body: { note: note.trim() },
            },
            {
              onSuccess: () => toast.success(t("toast.noteSaved")),
              onError: (error) => toast.error(errorMessage(error)),
            },
          )
        }
      >
        {t("service.saveNote")}
      </GuardedButton>
    </div>
  );
}

function VulnerabilityItem({ serviceId, match }: { serviceId: string; match: ServiceVulnerability }) {
  const { t, i18n } = useTranslation("vulnerabilities");
  const locale = i18n.resolvedLanguage;
  const [expanded, setExpanded] = useState(false);
  const link = match.evidence[0]?.url;
  const retracted = match.status === "retracted";

  return (
    <li className={cn("grid gap-1.5 rounded-lg border p-2.5", retracted && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-2">
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className={cn("font-mono text-sm font-medium hover:underline", retracted && "line-through")}
          >
            {match.canonicalId}
          </a>
        ) : (
          <span className="font-mono text-sm font-medium">{match.canonicalId}</span>
        )}
        <SeverityBadge severity={match.severity} score={match.cvssScore} />
        {match.kevAddedAt && (
          <KevBadge hint={t("service.kevSince", { date: formatDateTime(match.kevAddedAt, locale) })} />
        )}
        {match.confidence === "potential" && (
          <Badge variant="outline" className="border-dashed text-muted-foreground">
            {t("confidence.potential")}
          </Badge>
        )}
        <span className="ml-auto">
          <VulnerabilityTriageControl
            serviceId={serviceId}
            canonicalId={match.canonicalId}
            value={match.triage}
          />
        </span>
      </div>

      {match.title && <p className="text-sm font-medium">{match.title}</p>}
      {match.description && (
        <p className={cn("text-sm text-muted-foreground", !expanded && "line-clamp-2")}>
          {match.description}
        </p>
      )}
      {match.reasons.length > 0 && (
        <ul className="list-inside list-disc text-xs text-muted-foreground">
          {match.reasons.map((reason) => (
            <li key={reason}>{t(`reasons.${reason}`)}</li>
          ))}
        </ul>
      )}
      {retracted && match.retractedAt && match.retractReason && (
        <p className="text-xs text-muted-foreground">
          {t("service.retracted", {
            date: formatDateTime(match.retractedAt, locale),
            reason: t(`retractReasons.${match.retractReason}`),
          })}
        </p>
      )}

      {expanded && (
        <div className="grid gap-2 border-t pt-2 text-xs">
          <p className="text-muted-foreground">
            {match.publishedAt &&
              `${t("service.published", { date: formatDateTime(match.publishedAt, locale) })} · `}
            {t("service.firstMatched", { date: formatDateTime(match.firstMatchedAt, locale) })}
            {match.cvssVector && <span className="ml-1 font-mono break-all">· {match.cvssVector}</span>}
          </p>
          <div className="grid gap-0.5">
            <span className="text-muted-foreground">{t("service.sources")}</span>
            <ul className="grid gap-0.5">
              {match.evidence.map((entry) => (
                <li key={`${entry.sourceId} ${entry.externalId}`}>
                  <a href={entry.url} target="_blank" rel="noreferrer" className="font-mono hover:underline">
                    {entry.externalId}
                  </a>{" "}
                  <span className="text-muted-foreground">
                    ({entry.sourceId}: {t(`verdict.${entry.verdict}`)})
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {match.references.length > 0 && (
            <div className="grid gap-0.5">
              <span className="text-muted-foreground">{t("service.references")}</span>
              <ul className="grid gap-0.5">
                {match.references.map((url) => (
                  <li key={url} className="truncate">
                    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                      <ExternalLink className="size-3 shrink-0" />
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <NoteEditor serviceId={serviceId} match={match} />
        </div>
      )}
      {!expanded && match.note && (
        <p className="line-clamp-1 text-xs text-muted-foreground">{match.note}</p>
      )}

      <Button
        variant="link"
        size="sm"
        className="h-auto w-fit p-0 text-xs"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      >
        {expanded ? t("service.less") : t("service.more")}
      </Button>
    </li>
  );
}

function Toggle({ open, label, onToggle }: { open: boolean; label: string; onToggle: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="w-fit text-xs" aria-expanded={open} onClick={onToggle}>
      {label}
    </Button>
  );
}

/**
 * The vulnerabilities of one service, from its newest observation (matches belong to the service,
 * not to the viewed scan). Confirmed ones first; potential and retracted ones folded away.
 */
export function ServiceVulnerabilities({
  service,
  scanId,
  history,
}: {
  service: ScanServiceDetail;
  scanId: string;
  history: readonly HostHistoryEntry[];
}) {
  const { t, i18n } = useTranslation("vulnerabilities");
  const locale = i18n.resolvedLanguage;
  const [showPotential, setShowPotential] = useState(false);
  const [showRetracted, setShowRetracted] = useState(false);

  const matches = service.vulnerabilityMatches;
  if (matches.length === 0 && service.cpe.length === 0) return null;

  const active = matches.filter((match) => match.status === "active");
  const confirmed = active.filter((match) => match.confidence === "confirmed");
  const potential = active.filter((match) => match.confidence === "potential");
  const retracted = matches.filter((match) => match.status === "retracted");
  const basisScanId = active[0]?.basis.scanId ?? null;
  const basisScan = basisScanId ? history.find((entry) => entry.scanId === basisScanId) : undefined;

  return (
    <div className="grid gap-2">
      <h5 className="text-xs text-muted-foreground">{t("service.heading")}</h5>
      {service.change === "gone" && active.length > 0 && (
        <p className="text-xs text-muted-foreground">{t("service.notSeenInLatest")}</p>
      )}
      {basisScanId && basisScanId !== scanId && (
        <p className="text-xs text-muted-foreground">
          {t("service.basisOtherScan", {
            date: basisScan ? formatDateTime(basisScan.scannedAt, locale) : "—",
          })}
        </p>
      )}
      {active.length === 0 && <p className="text-sm text-muted-foreground">{t("service.empty")}</p>}

      {confirmed.length > 0 && (
        <ul className="grid gap-2">
          {confirmed.map((match) => (
            <VulnerabilityItem key={match.canonicalId} serviceId={service.id} match={match} />
          ))}
        </ul>
      )}

      {potential.length > 0 && (
        <Toggle
          open={showPotential}
          label={
            showPotential
              ? t("service.hidePotential")
              : t("service.showPotential", { count: potential.length })
          }
          onToggle={() => setShowPotential((open) => !open)}
        />
      )}
      {showPotential && (
        <ul className="grid gap-2">
          {potential.map((match) => (
            <VulnerabilityItem key={match.canonicalId} serviceId={service.id} match={match} />
          ))}
        </ul>
      )}

      {retracted.length > 0 && (
        <Toggle
          open={showRetracted}
          label={
            showRetracted
              ? t("service.hideRetracted")
              : t("service.showRetracted", { count: retracted.length })
          }
          onToggle={() => setShowRetracted((open) => !open)}
        />
      )}
      {showRetracted && (
        <ul className="grid gap-2">
          {retracted.map((match) => (
            <VulnerabilityItem key={match.canonicalId} serviceId={service.id} match={match} />
          ))}
        </ul>
      )}
    </div>
  );
}
