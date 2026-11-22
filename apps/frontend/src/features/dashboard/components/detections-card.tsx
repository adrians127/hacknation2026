import { Fingerprint } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { DashboardResponse } from "@subsurf/contracts/dashboard/dashboard.schema";
import { SignatureSeveritySchema } from "@subsurf/contracts/signatures/detection.schema";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SIGNATURE_SEVERITY_CLASS } from "@/features/signatures/lib/badges";
import { formatNumber } from "@/lib/format";

const SEVERITIES = SignatureSeveritySchema.options.toReversed();

/** What the detection signatures flagged in the newest scan: hosts by severity and the top signatures. */
export function DetectionsCard({ dashboard, scanId }: { dashboard: DashboardResponse; scanId: string }) {
  const { t, i18n } = useTranslation("signatures");
  const locale = i18n.resolvedLanguage;
  const { hosts, top } = dashboard.detections;
  const scanLink = (signature: string) => `/app/scans/${scanId}?signature=${signature}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Fingerprint className="size-4" />
          {t("dashboard.title")}
        </CardTitle>
        <CardDescription>{t("dashboard.description")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          {SEVERITIES.map((severity) => (
            <Badge key={severity} variant="outline" className={SIGNATURE_SEVERITY_CLASS[severity]}>
              {t(`severities.${severity}`)}: {formatNumber(hosts[severity], locale)} {t("dashboard.hosts")}
            </Badge>
          ))}
          <Link to={scanLink("any")} className="text-sm underline-offset-4 hover:underline">
            {t("dashboard.showHosts")}
          </Link>
        </div>
        {top.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("dashboard.none")}</p>
        ) : (
          <ul className="grid gap-1.5 text-sm">
            {top.map((item) => (
              <li key={item.signatureId} className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={item.severity ? SIGNATURE_SEVERITY_CLASS[item.severity] : "text-muted-foreground"}
                >
                  {t(`severities.${item.severity ?? "none"}`)}
                </Badge>
                <Link to={scanLink(item.signatureId)} className="font-medium underline-offset-4 hover:underline">
                  {item.name}
                </Link>
                <span className="text-muted-foreground">
                  {t("dashboard.hostCount", { hosts: item.hosts, services: item.services })}
                  {item.newHosts > 0 && ` · ${t("dashboard.newHosts", { count: item.newHosts })}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
