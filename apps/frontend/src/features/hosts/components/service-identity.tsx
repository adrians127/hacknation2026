import { useTranslation } from "react-i18next";

import {
  effectiveServiceIdentity,
  hasServiceOverrides,
  type ServiceSummary,
} from "@subsurf/contracts/hosts/hosts.schema";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const joined = (...parts: (string | null)[]) => parts.filter(Boolean).join(" ");

/** The service as displayed: corrections win, with a badge that shows what the scanner saw. */
export function ServiceIdentity({ service }: { service: Pick<ServiceSummary, "observed" | "overrides"> }) {
  const { t } = useTranslation("hosts");
  const { name, product, version } = effectiveServiceIdentity(service);
  const observed =
    joined(service.observed.name, service.observed.product, service.observed.version) ||
    t("service.unidentified");

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="font-medium">{name ?? t("service.unidentified")}</span>
      {(product ?? version) && <span className="text-muted-foreground">{joined(product, version)}</span>}
      {hasServiceOverrides(service) && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" tabIndex={0} className="cursor-help border-brand/40 text-brand">
              {t("service.edited")}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>{t("service.observed", { value: observed })}</TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}
