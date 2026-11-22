import { useTranslation } from "react-i18next";

import type { VulnerabilitySeverity } from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";

import { Badge } from "@/components/ui/badge";
import { SEVERITY_CLASS } from "@/features/vulnerabilities/lib/badges";

export function SeverityBadge({
  severity,
  score,
}: {
  severity: VulnerabilitySeverity;
  /** CVSS base score, shown next to the rating. */
  score?: number | null;
}) {
  const { t } = useTranslation("vulnerabilities");
  return (
    <Badge variant="outline" className={SEVERITY_CLASS[severity]}>
      {t(`severity.${severity}`)}
      {score !== undefined && score !== null && <span className="tabular-nums">{score.toFixed(1)}</span>}
    </Badge>
  );
}
