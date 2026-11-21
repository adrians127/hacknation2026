import { useTranslation } from "react-i18next";

import type { HostLastStatus } from "@subsurf/contracts/hosts/hosts.schema";

import { Badge } from "@/components/ui/badge";

export function HostStatusBadge({ status }: { status: HostLastStatus | null }) {
  const { t } = useTranslation("hosts");
  if (status === "up") {
    return (
      <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-500">
        {t("status.up")}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      {t(status === "down" ? "status.down" : "status.unknown")}
    </Badge>
  );
}
