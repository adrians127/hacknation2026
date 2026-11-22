import { useTranslation } from "react-i18next";

import type { DetectionSummary } from "@subsurf/contracts/signatures/detection.schema";

import { Badge } from "@/components/ui/badge";
import { SIGNATURE_SEVERITY_CLASS } from "@/features/signatures/lib/badges";
import { cn } from "@/lib/utils";

const MAX_SHOWN = 3;

/** What signatures recognised, most severe first; findings tinted by severity. */
export function DetectionBadges({
  detections,
  max = MAX_SHOWN,
  className,
}: {
  detections: readonly DetectionSummary[];
  max?: number;
  className?: string;
}) {
  const { t } = useTranslation("signatures");
  if (detections.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  const shown = detections.slice(0, max);
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {shown.map((detection) => (
        <Badge
          key={detection.signatureId}
          variant="outline"
          className={cn(
            "max-w-full truncate",
            detection.severity ? SIGNATURE_SEVERITY_CLASS[detection.severity] : "text-muted-foreground",
          )}
          title={[
            t(`categories.${detection.category}`),
            t(`severities.${detection.severity ?? "none"}`),
            t(`confidence.${detection.confidence}`),
          ].join(" · ")}
        >
          {detection.name}
          {detection.version && <span className="tabular-nums">{detection.version}</span>}
        </Badge>
      ))}
      {detections.length > max && (
        <Badge variant="outline" className="text-muted-foreground">
          {t("more", { count: detections.length - max })}
        </Badge>
      )}
    </div>
  );
}
