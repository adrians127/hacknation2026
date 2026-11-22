import { useTranslation } from "react-i18next";

import type { TargetInputKind } from "@subsurf/contracts/targets/target-input";

import { Badge } from "@/components/ui/badge";

export function TargetKindBadge({ kind }: { kind: TargetInputKind }) {
  const { t } = useTranslation();
  return <Badge variant="outline">{t(`targets.kinds.${kind}`)}</Badge>;
}
