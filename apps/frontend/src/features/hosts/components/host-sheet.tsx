import { Pencil } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { HostDetail, ServiceDetail } from "@subsurf/contracts/hosts/hosts.schema";

import { GuardedButton } from "@/components/guarded-button";
import { IconAction } from "@/components/icon-action";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useHost } from "@/features/hosts/api/get-host";
import { HostStatusBadge } from "@/features/hosts/components/host-status-badge";
import { HttpEndpointDetails } from "@/features/hosts/components/http-endpoint-details";
import { ServiceIdentity } from "@/features/hosts/components/service-identity";
import { TagList } from "@/features/hosts/components/tag-list";
import { TriageBadge } from "@/features/hosts/components/triage-badge";
import { useErrorMessage } from "@/hooks/use-error-message";
import { formatDateTime } from "@/lib/format";

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
  onEdit,
}: {
  service: ServiceDetail;
  onEdit: (service: ServiceDetail) => void;
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
        {!service.seenInLatestScan && (
          <Badge variant="outline" className="text-muted-foreground">
            {t("service.notSeen")}
          </Badge>
        )}
        <TriageBadge status={service.triage} />
        <span className="ml-auto">
          <IconAction
            label={t("actions.editService", { name: String(service.port) })}
            icon={<Pencil />}
            permissions={["hosts:update"]}
            onClick={() => onEdit(service)}
          />
        </span>
      </header>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <Field label={t("detail.observedAt")}>
          {service.observedAt ? formatDateTime(service.observedAt, locale) : "—"}
        </Field>
        <Field label={t("detail.firstSeen")}>{formatDateTime(service.firstSeenAt, locale)}</Field>
        <Field label={t("detail.detection")}>
          {service.method ?? "—"}
          {service.confidence !== null && ` · ${service.confidence}/10`}
        </Field>
        {service.extraInfo && <Field label={t("detail.extraInfo")}>{service.extraInfo}</Field>}
        {service.identity.ttl !== null && <Field label="TTL">{service.identity.ttl}</Field>}
        {service.cpe.length > 0 && (
          <Field label="CPE">
            <span className="font-mono text-xs break-all">{service.cpe.join(", ")}</span>
          </Field>
        )}
      </dl>

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
  host,
  onEditHost,
  onEditService,
}: {
  host: HostDetail;
  onEditHost: (host: HostDetail) => void;
  onEditService: (host: HostDetail, service: ServiceDetail) => void;
}) {
  const { t, i18n } = useTranslation("hosts");
  const locale = i18n.resolvedLanguage;

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle className="font-mono text-lg">{host.ip}</SheetTitle>
        <SheetDescription>
          {host.hostnames.length > 0 ? host.hostnames.join(", ") : t("detail.noHostnames")}
        </SheetDescription>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <HostStatusBadge status={host.lastStatus} />
          <TriageBadge status={host.triage} />
          <TagList tags={host.tags} />
          <GuardedButton
            size="sm"
            variant="outline"
            className="ml-auto"
            permissions={["hosts:update"]}
            onClick={() => onEditHost(host)}
          >
            <Pencil />
            {t("actions.edit")}
          </GuardedButton>
        </div>
      </SheetHeader>

      <div className="grid gap-6 px-4 pb-6">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Field label={t("detail.firstSeen")}>{formatDateTime(host.firstSeenAt, locale)}</Field>
          <Field label={t("detail.lastSeen")}>{formatDateTime(host.lastSeenAt, locale)}</Field>
          <Field label={t("detail.lastAnswer")}>
            {host.lastScannedAt ? formatDateTime(host.lastScannedAt, locale) : "—"}
          </Field>
        </dl>

        <section className="grid gap-1">
          <h4 className="text-sm font-medium">{t("detail.note")}</h4>
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">
            {host.note || t("detail.noNote")}
          </p>
        </section>

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
                <tr key={entry.scanId} className="border-b last:border-0">
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
                onEdit={(selected) => onEditService(host, selected)}
              />
            ))
          )}
        </section>
      </div>
    </>
  );
}

/** Everything known about one host: decrypted HTTP details, TLS, banners and scan history. */
export function HostSheet({
  hostId,
  onClose,
  onEditHost,
  onEditService,
}: {
  hostId: string;
  onClose: () => void;
  onEditHost: (host: HostDetail) => void;
  onEditService: (host: HostDetail, service: ServiceDetail) => void;
}) {
  const { t } = useTranslation("hosts");
  const errorMessage = useErrorMessage();
  const host = useHost(hostId);

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="gap-0 overflow-y-auto sm:max-w-3xl">
        {host.isSuccess ? (
          <HostDetails host={host.data} onEditHost={onEditHost} onEditService={onEditService} />
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
