import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { KEV_CLASS } from "@/features/vulnerabilities/lib/badges";

/** In CISA's Known Exploited Vulnerabilities catalog: attacked in the wild. */
export function KevBadge({ hint }: { hint?: string }) {
  const { t } = useTranslation("vulnerabilities");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={KEV_CLASS} tabIndex={0}>
          {t("summary.kev")}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{hint ?? t("summary.kevHint")}</TooltipContent>
    </Tooltip>
  );
}
