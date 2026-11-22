import { useTranslation } from "react-i18next";

import type { ServiceRemediation } from "@subsurf/contracts/defectdojo/defectdojo.schema";

import { formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";

const today = () => new Date().toISOString().slice(0, 10);

/** Dates imported from DefectDojo: planned fix, SLA deadline and risk acceptance expiry. */
export function RemediationDates({ remediation }: { remediation: ServiceRemediation | null }) {
  const { t, i18n } = useTranslation("hosts");
  if (!remediation) return <span className="text-muted-foreground">—</span>;
  const locale = i18n.resolvedLanguage;
  const overdue = remediation.slaDueOn !== null && remediation.slaDueOn < today();

  const rows = [
    remediation.slaDueOn && {
      key: "sla",
      label: overdue ? t("remediation.slaOverdue") : t("remediation.slaDue"),
      day: remediation.slaDueOn,
      className: overdue ? "text-destructive" : undefined,
    },
    remediation.plannedOn && { key: "planned", label: t("remediation.planned"), day: remediation.plannedOn },
    remediation.riskAcceptedUntil && {
      key: "risk",
      label: t("remediation.riskAcceptedUntil"),
      day: remediation.riskAcceptedUntil,
    },
  ].filter((row) => !!row);

  return (
    <ul className="grid gap-0.5 text-xs" title={t("remediation.source")}>
      {rows.map((row) => (
        <li key={row.key} className={cn("whitespace-nowrap", row.className)}>
          <span className="text-muted-foreground">{row.label}:</span> {formatDay(row.day, locale)}
        </li>
      ))}
    </ul>
  );
}
