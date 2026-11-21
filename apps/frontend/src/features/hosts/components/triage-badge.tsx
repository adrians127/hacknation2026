import { useTranslation } from "react-i18next";

import type { TriageStatus } from "@subsurf/contracts/hosts/hosts.schema";

import { Badge } from "@/components/ui/badge";
import { TRIAGE_CLASS } from "@/features/hosts/lib/badges";

export function TriageBadge({ status }: { status: TriageStatus }) {
  const { t } = useTranslation("hosts");
  return (
    <Badge variant="outline" className={TRIAGE_CLASS[status]}>
      {t(`triage.${status}`)}
    </Badge>
  );
}
