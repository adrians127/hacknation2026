import { Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { ScanHost, ScanService } from "@subsurf/contracts/scans/scan-results.schema";

import { IconAction } from "@/components/icon-action";
import { Checkbox } from "@/components/ui/checkbox";
import { ChangeBadge } from "@/features/hosts/components/change-badge";
import { HttpSummary } from "@/features/hosts/components/http-summary";
import { RemediationDates } from "@/features/hosts/components/remediation-dates";
import { ServiceIdentity } from "@/features/hosts/components/service-identity";
import { TagList } from "@/features/hosts/components/tag-list";
import { TriageControl } from "@/features/hosts/components/triage-control";
import { VulnerabilitySummaryBadge } from "@/features/vulnerabilities/components/vulnerability-summary";

/** Selected hosts and services; a selected host stands for all of its services. */
export interface RowSelection {
  hostIds: ReadonlySet<string>;
  serviceIds: ReadonlySet<string>;
  toggleHost: (id: string) => void;
  toggleService: (id: string) => void;
}

/** Service details in wrapping cards so expanding a host never introduces a second horizontal table. */
export function ServicesTable({
  host,
  compared,
  onEdit,
  selection,
}: {
  host: ScanHost;
  compared: boolean;
  onEdit: (host: ScanHost, service: ScanService) => void;
  selection?: RowSelection;
}) {
  const { t } = useTranslation("hosts");
  const { t: tv } = useTranslation("vulnerabilities");

  if (host.services.length === 0) {
    return <p className="px-2 py-3 text-sm text-muted-foreground">{t("detail.noServices")}</p>;
  }

  return (
    <ul className="grid min-w-0 gap-2 px-2 py-3 sm:grid-cols-2">
      {host.services.map((service) => (
        <li key={service.id} className={`min-w-0 rounded-lg border bg-muted/20 p-3 ${service.change === "gone" ? "opacity-60" : ""}`}>
          <div className="flex min-w-0 flex-wrap items-start gap-2">
            {selection && service.change !== "gone" && (
              <Checkbox
                checked={selection.hostIds.has(host.id) || selection.serviceIds.has(service.id)}
                disabled={selection.hostIds.has(host.id)}
                onCheckedChange={() => selection.toggleService(service.id)}
                aria-label={t("actions.select", { name: `${host.ip}:${service.port}` })}
              />
            )}
            <span className="font-mono text-sm font-medium">{service.port}/{service.protocol}</span>
            {compared && <ChangeBadge change={service.change} />}
            <span className="ml-auto">
              <IconAction label={t("actions.editService", { name: `${host.ip}:${service.port}` })} icon={<Pencil />} permissions={["hosts:update"]} onClick={() => onEdit(host, service)} />
            </span>
          </div>
          <div className="mt-2 min-w-0 wrap-anywhere text-sm"><ServiceIdentity service={service} /></div>
          <dl className="mt-3 grid min-w-0 gap-3 text-sm">
            <div className="min-w-0"><dt className="text-xs text-muted-foreground">{tv("columns.vulnerabilities")}</dt><dd className="mt-1"><VulnerabilitySummaryBadge summary={service.vulnerabilities} /></dd></div>
            <div className="min-w-0"><dt className="text-xs text-muted-foreground">{t("columns.http")}</dt><dd className="mt-1 wrap-anywhere"><HttpSummary endpoints={service.http} /></dd></div>
            <div className="min-w-0"><dt className="text-xs text-muted-foreground">{t("columns.triage")}</dt><dd className="mt-1"><TriageControl target={{ hostId: host.id, serviceId: service.id }} value={service.triage} label={t("actions.triageOf", { name: `${host.ip}:${service.port}` })} /></dd></div>
            {service.tags.length > 0 && <div className="min-w-0"><dt className="text-xs text-muted-foreground">{t("columns.tags")}</dt><dd className="mt-1 wrap-anywhere"><TagList tags={service.tags} /></dd></div>}
            {service.remediation && <div className="min-w-0"><dt className="text-xs text-muted-foreground">{t("columns.remediation")}</dt><dd className="mt-1"><RemediationDates remediation={service.remediation} /></dd></div>}
            {service.note && <div className="min-w-0"><dt className="text-xs text-muted-foreground">{t("columns.note")}</dt><dd className="mt-1 wrap-anywhere whitespace-pre-wrap">{service.note}</dd></div>}
          </dl>
        </li>
      ))}
    </ul>
  );
}
