import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { SECURITY_HEADERS, TECHNOLOGY_HEADERS } from "@subsurf/contracts/scans/compared-fields";
import type {
  FieldChange,
  HostHistoryEntry,
  ScanHostDetail,
  ScanServiceDetail,
  ServiceObservation,
} from "@subsurf/contracts/scans/scan-results.schema";
import type { HttpEndpoint } from "@subsurf/contracts/workers/worker-result.schema";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useScanHost } from "@/features/hosts/api/get-scan-host";
import { ChangeBadge } from "@/features/hosts/components/change-badge";
import { FieldChangeList } from "@/features/hosts/components/field-change-list";
import { HostStatusBadge } from "@/features/hosts/components/host-status-badge";
import { HostTimeline } from "@/features/hosts/components/host-timeline";
import { LifecycleBadge } from "@/features/hosts/components/lifecycle-badge";
import { statusCodeClass } from "@/features/hosts/lib/badges";
import { endpointLabel } from "@/features/hosts/lib/endpoint";
import { useErrorMessage } from "@/hooks/use-error-message";
import { cn } from "@/lib/utils";

const TECHNOLOGY: ReadonlySet<string> = new Set(TECHNOLOGY_HEADERS);
const SECURITY: ReadonlySet<string> = new Set(SECURITY_HEADERS);

type Side = "base" | "target";

const endpointKey = (endpoint: Pick<HttpEndpoint, "scheme" | "vhost">) =>
  `${endpoint.scheme} ${endpoint.vhost ?? ""}`;

/** Which displayed values differ between the scans: `field|endpoint|key`. */
function changedKeys(changes: readonly FieldChange[]): ReadonlySet<string> {
  return new Set(
    changes.map(
      (change) =>
        `${change.field}|${change.endpoint ? endpointKey(change.endpoint) : ""}|${change.key ?? ""}`,
    ),
  );
}

function Mark({ on, children }: { on: boolean; children: ReactNode }) {
  return <span className={cn(on && "rounded bg-amber-500/20 px-1 text-amber-200")}>{children}</span>;
}

function EndpointSummary({
  endpoint,
  ip,
  port,
  changed,
  side,
}: {
  endpoint: HttpEndpoint;
  ip: string;
  port: number;
  changed: ReadonlySet<string>;
  side: Side;
}) {
  const { t } = useTranslation("hosts");
  const key = endpointKey(endpoint);
  const is = (field: FieldChange["field"], name = "") => changed.has(`${field}|${key}|${name}`);
  const cert = endpoint.tls?.cert;
  const headers = endpoint.headers.filter((header) => TECHNOLOGY.has(header.name.toLowerCase()));
  const security = endpoint.headers.filter((header) => SECURITY.has(header.name.toLowerCase()));
  const finalPath = new URL(endpoint.finalUrl).pathname;
  const onlyHere = is("http.endpoint");

  return (
    <div
      className={cn(
        "grid gap-1 rounded-md border p-2 text-xs",
        onlyHere && (side === "base" ? "border-red-500/50" : "border-emerald-500/50"),
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-muted-foreground">{endpointLabel(endpoint, ip, port)}</span>
        {onlyHere && (
          <Badge variant="outline" className={side === "base" ? "text-red-400" : "text-emerald-400"}>
            {t(side === "base" ? "compare.endpointRemoved" : "compare.endpointAdded")}
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Mark on={is("http.status")}>
          <Badge variant="outline" className={statusCodeClass(endpoint.statusCode)}>
            {endpoint.statusCode ?? "—"}
          </Badge>
        </Mark>
        <Mark on={is("http.title")}>{endpoint.title ?? <i className="text-muted-foreground">{t("http.noTitle")}</i>}</Mark>
        {finalPath !== "/" && (
          <Mark on={is("http.redirect")}>
            <span className="font-mono">→ {finalPath}</span>
          </Mark>
        )}
      </div>
      {endpoint.tls && cert && (
        <div className="flex flex-wrap gap-x-2">
          <span className="text-muted-foreground">{t("compare.tls")}</span>
          <Mark on={is("tls.version")}>{endpoint.tls.version}</Mark>
          <Mark on={is("tls.issuer")}>{cert.issuer ?? "—"}</Mark>
          <Mark on={is("tls.expiry")}>{cert.notAfter.slice(0, 10)}</Mark>
          <Mark on={is("tls.cert")}>
            <span className="font-mono" title={cert.sha256}>
              {cert.sha256.slice(0, 8)}…
            </span>
          </Mark>
          {cert.selfSigned && <Mark on={is("tls.selfSigned")}>{t("http.selfSigned")}</Mark>}
        </div>
      )}
      {headers.length > 0 && (
        <ul className="grid gap-0.5 font-mono">
          {headers.map((header) => (
            <li key={header.name}>
              <Mark on={is("http.header", header.name.toLowerCase())}>
                {header.name.toLowerCase()}: {header.value}
              </Mark>
            </li>
          ))}
        </ul>
      )}
      {security.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <span className="text-muted-foreground">{t("compare.securityHeaders")}</span>
          {security.map((header) => (
            <Mark key={header.name} on={is("http.securityHeader", header.name.toLowerCase())}>
              <code>{header.name.toLowerCase()}</code>
            </Mark>
          ))}
        </div>
      )}
      {endpoint.cookies.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <span className="text-muted-foreground">{t("compare.cookies")}</span>
          {endpoint.cookies.map((cookie) => (
            <Mark
              key={cookie.name}
              on={is("http.cookie", cookie.name) || is("http.cookieFlags", cookie.name)}
            >
              <code>{cookie.name}</code>
            </Mark>
          ))}
        </div>
      )}
      {endpoint.probes.length > 0 && (
        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
          <span className="text-muted-foreground">{t("compare.probes")}</span>
          {endpoint.probes.map((probe) => (
            <Mark key={probe.path} on={is("http.probe", probe.path)}>
              <span className="font-mono">
                {probe.path} {probe.statusCode ?? "—"}
              </span>
            </Mark>
          ))}
        </div>
      )}
    </div>
  );
}

/** One scan's view of a port, with what differs from the other scan marked. */
function ObservationColumn({
  observation,
  ip,
  port,
  changed,
  side,
}: {
  observation: ServiceObservation | null;
  ip: string;
  port: number;
  changed: ReadonlySet<string>;
  side: Side;
}) {
  const { t } = useTranslation("hosts");
  if (!observation) {
    return <p className="text-xs text-muted-foreground italic">{t("compare.notOpen")}</p>;
  }
  const is = (field: FieldChange["field"]) => changed.has(`${field}||`);
  const { observed } = observation;

  return (
    <div className="grid content-start gap-2">
      <div className="flex flex-wrap items-baseline gap-1.5 text-sm">
        <Mark on={is("service.name")}>
          <span className="font-medium">{observed.name ?? t("service.unidentified")}</span>
        </Mark>
        <Mark on={is("service.product")}>{observed.product}</Mark>
        <Mark on={is("service.version")}>{observed.version}</Mark>
      </div>
      {/* Wrapped in a div so the mark stays as wide as its text, not the column. */}
      {observation.extraInfo && (
        <div className="text-xs text-muted-foreground">
          <Mark on={is("service.extraInfo")}>{observation.extraInfo}</Mark>
        </div>
      )}
      {observation.identity.sshHostKeySha256 && (
        <div className="font-mono text-xs" title={observation.identity.sshHostKeySha256}>
          <Mark on={is("ssh.hostKey")}>SSH {observation.identity.sshHostKeySha256.slice(0, 16)}…</Mark>
        </div>
      )}
      {observation.http.map((endpoint) => (
        <EndpointSummary
          key={endpointKey(endpoint)}
          endpoint={endpoint}
          ip={ip}
          port={port}
          changed={changed}
          side={side}
        />
      ))}
    </div>
  );
}

function ServiceComparison({ host, service }: { host: ScanHostDetail; service: ScanServiceDetail }) {
  const changed = changedKeys(service.fieldChanges);
  const observedNow = host.status === "up" && service.change !== "gone";

  return (
    <section className="grid gap-3 rounded-xl border p-3" aria-label={`${service.port}/${service.protocol}`}>
      <header className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-medium">
          {service.port}/{service.protocol}
        </span>
        <ChangeBadge change={service.change} />
      </header>
      <FieldChangeList changes={service.fieldChanges} ip={host.ip} port={service.port} />
      <div className="grid gap-3 sm:grid-cols-2">
        <ObservationColumn observation={service.before} ip={host.ip} port={service.port} changed={changed} side="base" />
        <ObservationColumn
          observation={observedNow ? service : null}
          ip={host.ip}
          port={service.port}
          changed={changed}
          side="target"
        />
      </div>
    </section>
  );
}

function Comparison({
  host,
  baseId,
  targetId,
  onPickScan,
}: {
  host: ScanHostDetail;
  baseId: string;
  targetId: string;
  onPickScan: (entry: HostHistoryEntry) => void;
}) {
  const { t } = useTranslation("hosts");
  const { t: tc } = useTranslation();

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle className="font-mono text-lg">{host.ip}</SheetTitle>
        <SheetDescription>
          {host.hostnames.length > 0 ? host.hostnames.join(", ") : t("detail.noHostnames")}
        </SheetDescription>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <ChangeBadge change={host.change} />
          <LifecycleBadge lifecycle={host.lifecycle} showActive />
          <Button asChild size="sm" variant="outline" className="ml-auto">
            <Link to={`/app/scans/${targetId}?host=${host.id}`}>
              <ExternalLink />
              {t("compare.openInScan")}
            </Link>
          </Button>
        </div>
      </SheetHeader>

      <div className="grid gap-6 px-4 pt-4 pb-6">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="grid justify-items-start gap-1">
            <dt className="text-xs text-muted-foreground">{tc("scans.compare.base")}</dt>
            <dd>
              {host.baseStatus ? (
                <HostStatusBadge status={host.baseStatus} />
              ) : (
                <Badge variant="outline" className="border-dashed text-muted-foreground">
                  {t("compare.notScanned")}
                </Badge>
              )}
            </dd>
          </div>
          <div className="grid justify-items-start gap-1">
            <dt className="text-xs text-muted-foreground">{tc("scans.compare.target")}</dt>
            <dd>
              <HostStatusBadge status={host.status} />
            </dd>
          </div>
        </dl>

        {host.fieldChanges.length > 0 && (
          <section className="grid gap-2">
            <h4 className="text-sm font-medium">{t("fieldChange.hostTitle")}</h4>
            <FieldChangeList changes={host.fieldChanges} ip={host.ip} />
          </section>
        )}

        <HostTimeline history={host.history} baseScanId={baseId} targetScanId={targetId} onPick={onPickScan} />

        <section className="grid gap-3">
          <h4 className="text-sm font-medium">{t("compare.services")}</h4>
          {host.services.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("detail.noServices")}</p>
          ) : (
            host.services.map((service) => (
              <ServiceComparison key={service.id} host={host} service={service} />
            ))
          )}
        </section>
      </div>
    </>
  );
}

/** One host in two scans: statuses, presence over time, and each port side by side. */
export function CompareHostSheet({
  baseId,
  targetId,
  hostId,
  onClose,
  onPickScan,
}: {
  baseId: string;
  targetId: string;
  hostId: string;
  onClose: () => void;
  onPickScan: (entry: HostHistoryEntry) => void;
}) {
  const { t } = useTranslation("hosts");
  const errorMessage = useErrorMessage();
  const host = useScanHost(targetId, hostId, baseId);

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="gap-0 overflow-y-auto sm:max-w-4xl">
        {host.isSuccess ? (
          <Comparison host={host.data} baseId={baseId} targetId={targetId} onPickScan={onPickScan} />
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
