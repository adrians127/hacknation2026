import { useTranslation } from "react-i18next";

import {
  INACTIVE_AFTER_MISSES,
  type HostLifecycle,
  type HostLifecycleState,
} from "@subsurf/contracts/scans/scan-results.schema";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const LIFECYCLE_CLASS: Record<HostLifecycleState, string> = {
  active: "text-muted-foreground",
  unstable: "border-dashed border-sky-500/50 bg-sky-500/10 text-sky-500",
  missing: "border-orange-500/40 bg-orange-500/10 text-orange-500",
  inactive: "border-red-500/40 bg-red-500/10 text-red-500",
};

/** How reliably the host answers across scans; nothing for an active host unless `showActive`. */
export function LifecycleBadge({
  lifecycle,
  showActive = false,
}: {
  lifecycle: HostLifecycle;
  showActive?: boolean;
}) {
  const { t } = useTranslation("hosts");
  if (lifecycle.state === "active" && !showActive) return null;
  const values = { misses: lifecycle.misses, flips: lifecycle.flips, max: INACTIVE_AFTER_MISSES };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" tabIndex={0} className={`cursor-help ${LIFECYCLE_CLASS[lifecycle.state]}`}>
          {t(`lifecycle.${lifecycle.state}`, values)}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{t(`lifecycle.hint.${lifecycle.state}`, values)}</TooltipContent>
    </Tooltip>
  );
}
