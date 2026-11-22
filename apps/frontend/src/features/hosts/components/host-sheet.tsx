import { Columns2, FileText, Pencil } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import type {
  HostHistoryEntry,
  ScanHostDetail,
  ScanServiceDetail,
} from "@subsurf/contracts/scans/scan-results.schema";

import { GuardedButton } from "@/components/guarded-button";
import { IconAction } from "@/components/icon-action";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useScanHost } from "@/features/hosts/api/get-scan-host";
import { ChangeBadge } from "@/features/hosts/components/change-badge";
import { FieldChangeList } from "@/features/hosts/components/field-change-list";
import { HostStatusBadge } from "@/features/hosts/components/host-status-badge";
import { HostTimeline } from "@/features/hosts/components/host-timeline";
import { HttpEndpointDetails } from "@/features/hosts/components/http-endpoint-details";
import { LifecycleBadge } from "@/features/hosts/components/lifecycle-badge";
import { RemediationDates } from "@/features/hosts/components/remediation-dates";
import { ServiceIdentity } from "@/features/hosts/components/service-identity";
import { TagList } from "@/features/hosts/components/tag-list";
import { TriageBadge } from "@/features/hosts/components/triage-badge";
import { compareUrl } from "@/features/scans/lib/pair";
import { ServiceVulnerabilities } from "@/features/vulnerabilities/components/service-vulnerabilities";
import { VulnerabilitySummaryBadge } from "@/features/vulnerabilities/components/vulnerability-summary";
import { useErrorMessage } from "@/hooks/use-error-message";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function ServiceSection({
  service,
  ip,
  scanId,
  history,
  onEdit,
}: {
  service: ScanServiceDetail;
  ip: string;
  scanId: string;
  history: readonly HostHistoryEntry[];
  onEdit: (service: ScanServiceDetail) => void;
}) {
  const { t, i18n } = useTranslation("hosts");
  const locale = i18n.resolvedLanguage;

  return (
    <section className="grid gap-3 rounded-xl border p-3" aria-label={`${service.port}/${service.protocol}`}>
      <header className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-medium">
          {service.port}/{service.protocol}
        </span>
        <ServiceIdentity service={service} />
        <ChangeBadge change={service.change} />
        <TriageBadge status={service.triage} />
        <VulnerabilitySummaryBadge summary={service.vulnerabilities} />
        <span className="ml-auto">
          <IconAction
            label={t("actions.editService", { name: String(service.port) })}
            icon={<Pencil />}
            permissions={["hosts:update"]}
            onClick={() => onEdit(service)}
          />
        </span>
      </header>

      {service.fieldChanges.length > 0 && (
        <div className="grid gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2">
          <h5 className="text-xs font-medium text-amber-500">{t("fieldChange.title")}</h5>
          <FieldChangeList changes={service.fieldChanges} ip={ip} port={service.port} />
        </div>
      )}

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <Field label={t("detail.firstSeen")}>{formatDateTime(service.firstSeenAt, locale)}</Field>
        <Field label={t("detail.lastSeen")}>{formatDateTime(service.lastSeenAt, locale)}</Field>
        <Field label={t("detail.detection")}>
          {service.method ?? "—"}
          {service.confidence !== null && ` · ${service.confidence}/10`}
        </Field>
        {service.extraInfo && <Field label={t("detail.extraInfo")}>{service.extraInfo}</Field>}
        {service.identity.ttl !== null && <Field label="TTL">{service.identity.ttl}</Field>}
        {service.remediation && (
          <Field label={t("columns.remediation")}>
            <RemediationDates remediation={service.remediation} />
          </Field>
        )}
        {service.cpe.length > 0 && (
          <Field label="CPE">
            <span className="font-mono text-xs break-all">{service.cpe.join(", ")}</span>
          </Field>
        )}
      </dl>

      <ServiceVulnerabilities service={service} scanId={scanId} history={history} />

      {(service.note || service.tags.length > 0) && (
        <div className="grid gap-1.5 rounded-lg bg-muted/40 p-2 text-sm">
          <TagList tags={service.tags} />
          {service.note && <p className="whitespace-pre-wrap">{service.note}</p>}
        </div>
      )}

      {service.banner && (
        <div className="grid gap-1">
          <h5 className="text-xs text-muted-foreground">{t("detail.banner")}</h5>
          <pre className="overflow-auto rounded-md bg-muted/50 p-2 text-xs whitespace-pre-wrap">{service.banner}</pre>
        </div>
      )}

      {service.scripts.map((script) => (
        <details key={script.id} className="rounded-lg border">
          <summary className="cursor-pointer px-3 py-2 font-mono text-xs">{script.id}</summary>
          <pre className="overflow-auto border-t p-2 text-xs whitespace-pre-wrap">{script.output}</pre>
        </details>
      ))}

      {service.http.length > 0 && (
        <div className="grid gap-2">
          <h5 className="text-xs text-muted-foreground">{t("detail.endpoints")}</h5>
          {service.http.map((endpoint) => (
            <HttpEndpointDetails key={`${endpoint.scheme} ${endpoint.vhost ?? ""}`} endpoint={endpoint} />
          ))}
        </div>
      )}
    </section>
  );
}

function HostDetails({
  scanId,
  baseScanId,
  host,
  onEditHost,
  onEditService,
}: {
  scanId: string;
  baseScanId: string | null;
  host: ScanHostDetail;
  onEditHost: (host: ScanHostDetail) => void;
  onEditService: (host: ScanHostDetail, service: ScanServiceDetail) => void;
}) {
  const { t, i18n } = useTranslation("hosts");
  const { t: tc } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const navigate = useNavigate();

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle className="font-mono text-lg">{host.ip}</SheetTitle>
        <SheetDescription>
          {host.hostnames.length > 0 ? host.hostnames.join(", ") : t("detail.noHostnames")}
        </SheetDescription>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <HostStatusBadge status={host.status} />
          <ChangeBadge change={host.change} />
          <LifecycleBadge lifecycle={host.lifecycle} />
          <TriageBadge status={host.triage} />
          <VulnerabilitySummaryBadge summary={host.vulnerabilities} />
          <TagList tags={host.tags} />
          <span className="ml-auto flex gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to={`/app/reports/ips/${host.ip}`}>
                <FileText />
                {t("actions.ipReport")}
              </Link>
            </Button>
            {baseScanId && (
              <Button asChild size="sm" variant="outline">
                <Link to={compareUrl({ base: baseScanId, target: scanId, host: host.id })}>
                  <Columns2 />
                  {tc("scans.compare.openSideBySide")}
                </Link>
              </Button>
            )}
            <GuardedButton
              size="sm"
              variant="outline"
              permissions={["hosts:update"]}
              onClick={() => onEditHost(host)}
            >
              <Pencil />
              {t("actions.edit")}
            </GuardedButton>
          </span>
        </div>
      </SheetHeader>

      <div className="grid gap-6 px-4 pt-4 pb-6">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Field label={t("detail.observedAt")}>
            {host.observedAt ? formatDateTime(host.observedAt, locale) : "—"}
          </Field>
          <Field label={t("detail.latency")}>
            {host.latencyMs === null ? "—" : `${host.latencyMs} ms`}
          </Field>
          <Field label={t("detail.firstSeen")}>{formatDateTime(host.firstSeenAt, locale)}</Field>
          <Field label={t("detail.lastSeen")}>{formatDateTime(host.lastSeenAt, locale)}</Field>
        </dl>

        <section className="grid gap-1">
          <h4 className="text-sm font-medium">{t("detail.note")}</h4>
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">
            {host.note || t("detail.noNote")}
          </p>
        </section>

        {host.fieldChanges.length > 0 && (
          <section className="grid gap-2">
            <h4 className="text-sm font-medium">{t("fieldChange.title")}</h4>
            <FieldChangeList changes={host.fieldChanges} ip={host.ip} />
          </section>
        )}

        <HostTimeline
          history={host.history}
          baseScanId={baseScanId}
          targetScanId={scanId}
          // The compare page puts the older scan on the left whichever way round they come.
          onPick={(entry) =>
            void navigate(compareUrl({ base: entry.scanId, target: scanId, host: host.id }))
          }
        />

        <section className="grid gap-2">
          <h4 className="text-sm font-medium">{t("detail.history")}</h4>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-1 text-left font-normal">{t("detail.scannedAt")}</th>
                <th className="py-1 text-left font-normal">{t("columns.status")}</th>
                <th className="py-1 text-right font-normal">{t("detail.latency")}</th>
                <th className="py-1 text-right font-normal">{t("detail.openPorts")}</th>
              </tr>
            </thead>
            <tbody>
              {host.history.map((entry) => (
                <tr
                  key={entry.scanId}
                  className={cn("border-b last:border-0", entry.scanId === scanId && "font-medium")}
                  aria-current={entry.scanId === scanId ? "true" : undefined}
                >
                  <td className="py-1">{formatDateTime(entry.scannedAt, locale)}</td>
                  <td className="py-1">{t(`observation.${entry.status}`)}</td>
                  <td className="py-1 text-right tabular-nums">
                    {entry.latencyMs === null ? "—" : `${entry.latencyMs} ms`}
                  </td>
                  <td className="py-1 text-right tabular-nums">{entry.openPorts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="grid gap-3">
          <h4 className="text-sm font-medium">{t("detail.services")}</h4>
          {host.services.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("detail.noServices")}</p>
          ) : (
            host.services.map((service) => (
              <ServiceSection
                key={service.id}
                service={service}
                ip={host.ip}
                scanId={scanId}
                history={host.history}
                onEdit={(selected) => onEditService(host, selected)}
              />
            ))
          )}
        </section>
      </div>
    </>
  );
}

/** One host as one scan saw it: decrypted HTTP details, TLS, banners, and its scan history. */
export function HostSheet({
  scanId,
  baseScanId,
  hostId,
  onClose,
  onEditHost,
  onEditService,
}: {
  scanId: string;
  /** The scan this one is compared with, for the side-by-side link. */
  baseScanId: string | null;
  hostId: string;
  onClose: () => void;
  onEditHost: (host: ScanHostDetail) => void;
  onEditService: (host: ScanHostDetail, service: ScanServiceDetail) => void;
}) {
  const { t } = useTranslation("hosts");
  const errorMessage = useErrorMessage();
  const host = useScanHost(scanId, hostId);

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="gap-0 overflow-y-auto sm:max-w-3xl">
        {host.isSuccess ? (
          <HostDetails
            scanId={scanId}
            baseScanId={baseScanId}
            host={host.data}
            onEditHost={onEditHost}
            onEditService={onEditService}
          />
        ) : (
          <SheetHeader>
            <SheetTitle>{t("detail.title")}</SheetTitle>
            <SheetDescription className="sr-only">{t("detail.loading")}</SheetDescription>
            {host.isError ? (
              <p role="alert" className="text-sm text-destructive">
                {errorMessage(host.error)}
              </p>
            ) : (
              <Skeleton className="h-64 w-full" />
            )}
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}
