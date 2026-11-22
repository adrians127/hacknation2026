import { useTranslation } from "react-i18next";

import type { Detection } from "@subsurf/contracts/signatures/detection.schema";

import { Badge } from "@/components/ui/badge";
import { SIGNATURE_SEVERITY_CLASS } from "@/features/signatures/lib/badges";
import { cn } from "@/lib/utils";

/** What the signatures recognised on one service in this scan, with the evidence they matched. */
export function ServiceDetections({ detections }: { detections: readonly Detection[] }) {
  const { t } = useTranslation("signatures");
  if (detections.length === 0) return null;
  return (
    <div className="grid gap-1.5 rounded-lg border p-2">
      <h5 className="text-xs font-medium">{t("detections.title", { count: detections.length })}</h5>
      <ul className="grid gap-1.5 text-sm">
        {detections.map((detection) => (
          <li key={detection.signatureId} className="grid gap-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                variant="outline"
                className={detection.severity ? SIGNATURE_SEVERITY_CLASS[detection.severity] : "text-muted-foreground"}
              >
                {t(`severities.${detection.severity ?? "none"}`)}
              </Badge>
              <span className="font-medium">{detection.name}</span>
              {detection.version && <span className="tabular-nums">{detection.version}</span>}
              <span className="text-xs text-muted-foreground">
                {t(`categories.${detection.category}`)} · {t(`confidence.${detection.confidence}`)}
                {detection.builtIn && ` · ${t("builtIn")}`}
              </span>
            </div>
            {detection.evidence.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">
                  {t("detections.evidence", { count: detection.evidence.length })}
                </summary>
                <ul className="mt-1 grid gap-0.5">
                  {detection.evidence.map((evidence) => (
                    <li
                      key={`${evidence.target}|${evidence.url}|${evidence.key}|${evidence.value}`}
                      className={cn("font-mono break-all text-muted-foreground")}
                    >
                      {t(`targets.${evidence.target}`)}
                      {evidence.key && ` ${evidence.key}`}: {evidence.value}
                      {evidence.url && <span className="opacity-70"> · {evidence.url}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
