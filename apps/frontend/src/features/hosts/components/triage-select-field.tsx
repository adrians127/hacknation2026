import { useTranslation } from "react-i18next";

import { TriageStatusSchema, type TriageStatus } from "@subsurf/contracts/hosts/hosts.schema";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function TriageSelectField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: TriageStatus;
  onChange: (value: TriageStatus) => void;
}) {
  const { t } = useTranslation("hosts");
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{t("form.triage")}</Label>
      <Select value={value} onValueChange={(next) => onChange(TriageStatusSchema.parse(next))}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TriageStatusSchema.options.map((status) => (
            <SelectItem key={status} value={status}>
              {t(`triage.${status}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
