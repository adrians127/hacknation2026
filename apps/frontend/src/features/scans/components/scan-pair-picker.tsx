import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { Scan } from "@subsurf/contracts/scans/scans.schema";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { hasResults, orderPair, scanDate } from "@/features/scans/lib/pair";
import { formatDateTime } from "@/lib/format";

function ScanSelect({
  id,
  label,
  scans,
  value,
  exclude,
  onChange,
}: {
  id: string;
  label: string;
  scans: readonly Scan[];
  value: string | undefined;
  exclude: string | undefined;
  onChange: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;

  return (
    <div className="grid min-w-64 flex-1 gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value ?? ""} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={t("scans.compare.pickScan")} />
        </SelectTrigger>
        <SelectContent>
          {scans.map((scan) => (
            <SelectItem key={scan.id} value={scan.id} disabled={scan.id === exclude}>
              {formatDateTime(scanDate(scan), locale)} · {t(`scans.statuses.${scan.status}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Picks scan A (before) and scan B (after); a pair picked the wrong way round is swapped. */
export function ScanPairPicker({
  scans,
  baseId,
  targetId,
  onChange,
}: {
  scans: readonly Scan[];
  baseId: string | undefined;
  targetId: string | undefined;
  onChange: (pair: { base: string | undefined; target: string }) => void;
}) {
  const { t } = useTranslation();
  const candidates = scans.filter(hasResults);

  const pick = (side: "base" | "target", id: string) => {
    const other = side === "base" ? targetId : baseId;
    // Without the other side, the picked scan becomes B and the backend picks its base.
    if (!other) {
      onChange({ base: undefined, target: id });
      return;
    }
    const [base, target] = orderPair(scans, id, other);
    onChange({ base, target });
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <ScanSelect
        id="compare-base"
        label={t("scans.compare.base")}
        scans={candidates}
        value={baseId}
        exclude={targetId}
        onChange={(id) => pick("base", id)}
      />
      <ArrowRight aria-hidden className="mb-2 size-4 text-muted-foreground" />
      <ScanSelect
        id="compare-target"
        label={t("scans.compare.target")}
        scans={candidates}
        value={targetId}
        exclude={baseId}
        onChange={(id) => pick("target", id)}
      />
    </div>
  );
}
