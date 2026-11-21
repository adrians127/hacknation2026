import { useTranslation } from "react-i18next";

import type { HostStatus } from "@subsurf/contracts/workers/worker-result.schema";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** What the scan got from the address. */
export function HostStatusBadge({ status }: { status: HostStatus }) {
  const { t } = useTranslation("hosts");
  return (
    <Badge
      variant="outline"
      className={cn(
        status === "up"
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
          : "text-muted-foreground",
      )}
    >
      {t(`observation.${status}`)}
    </Badge>
  );
}
