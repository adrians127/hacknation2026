import { useTranslation } from "react-i18next";

import type { HttpSummary as HttpSummaryEntry } from "@subsurf/contracts/hosts/hosts.schema";

import { Badge } from "@/components/ui/badge";
import { statusCodeClass } from "@/features/hosts/lib/badges";

const MAX_SHOWN = 3;

/** Status and title of each HTTP endpoint on a port, named by vhost (or bare IP). */
export function HttpSummary({ endpoints }: { endpoints: readonly HttpSummaryEntry[] }) {
  const { t } = useTranslation("hosts");
  if (endpoints.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <ul className="grid gap-1">
      {endpoints.slice(0, MAX_SHOWN).map((endpoint) => (
        <li key={endpoint.url} className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={statusCodeClass(endpoint.statusCode)}>
            {endpoint.statusCode ?? "—"}
          </Badge>
          <span className="min-w-0 wrap-anywhere" title={endpoint.finalUrl}>
            {endpoint.title ?? <span className="text-muted-foreground italic">{t("http.noTitle")}</span>}
          </span>
          <span className="wrap-anywhere text-xs text-muted-foreground">
            {endpoint.vhost ?? t("http.bareIp")}
          </span>
        </li>
      ))}
      {endpoints.length > MAX_SHOWN && (
        <li className="text-xs text-muted-foreground">
          {t("http.more", { n: endpoints.length - MAX_SHOWN })}
        </li>
      )}
    </ul>
  );
}
