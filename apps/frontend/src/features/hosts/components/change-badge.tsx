import { useTranslation } from "react-i18next";

import type { ScanChange } from "@subsurf/contracts/scans/scan-results.schema";

import { Badge } from "@/components/ui/badge";
import { CHANGE_CLASS } from "@/features/hosts/lib/badges";

/** Nothing for an unchanged item, or when the scan has no base scan to compare with. */
export function ChangeBadge({ change }: { change: ScanChange | null }) {
  const { t } = useTranslation("hosts");
  if (change === null || change === "unchanged") return null;
  return (
    <Badge variant="outline" className={CHANGE_CLASS[change]}>
      {t(`change.${change}`)}
    </Badge>
  );
}
