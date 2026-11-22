import { useTranslation } from "react-i18next";

import type { SignatureSeverity } from "@subsurf/contracts/signatures/detection.schema";

import { Badge } from "@/components/ui/badge";
import { SIGNATURE_SEVERITY_CLASS } from "@/features/signatures/lib/badges";

/** The finding's severity, or "detection only" for a signature without one. */
export function SignatureSeverityBadge({ severity }: { severity: SignatureSeverity | null }) {
  const { t } = useTranslation("signatures");
  return (
    <Badge variant="outline" className={severity ? SIGNATURE_SEVERITY_CLASS[severity] : "text-muted-foreground"}>
      {t(`severities.${severity ?? "none"}`)}
    </Badge>
  );
}
