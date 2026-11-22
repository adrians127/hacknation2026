import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { TriageStatusSchema, type TriageStatus } from "@subsurf/contracts/hosts/hosts.schema";
import type { RuleRef } from "@subsurf/contracts/rules/rule-ref.schema";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUpdateHost } from "@/features/hosts/api/update-host";
import { useUpdateService } from "@/features/hosts/api/update-service";
import { TriageBadge } from "@/features/hosts/components/triage-badge";
import { RuleBadge } from "@/features/rules/components/rule-badge";
import { useErrorMessage } from "@/hooks/use-error-message";
import { useCan } from "@/lib/auth/use-can";

type TriageTarget = { hostId: string; serviceId?: string };

/** Changes the triage status in place; roles without `hosts:update` see a badge. */
export function TriageControl({
  target,
  value,
  rule = null,
  label,
}: {
  target: TriageTarget;
  value: TriageStatus;
  /** The rule that set the value; a user's change takes it over. */
  rule?: RuleRef | null;
  /** Accessible name, e.g. "Triage of 10.40.1.10". */
  label: string;
}) {
  const { t } = useTranslation("hosts");
  const errorMessage = useErrorMessage();
  const canEdit = useCan("hosts:update");
  const updateHost = useUpdateHost();
  const updateService = useUpdateService();
  const pending = updateHost.isPending || updateService.isPending;

  if (!canEdit) {
    return (
      <span className="flex items-center gap-1">
        <TriageBadge status={value} />
        <RuleBadge rule={rule} compact />
      </span>
    );
  }

  function change(raw: string) {
    const triage = TriageStatusSchema.parse(raw);
    const handlers = {
      onSuccess: () => toast.success(t("toast.triageSaved")),
      onError: (error: unknown) => toast.error(errorMessage(error)),
    };
    if (target.serviceId) {
      updateService.mutate(
        { params: { path: { id: target.hostId, serviceId: target.serviceId } }, body: { triage } },
        handlers,
      );
    } else {
      updateHost.mutate({ params: { path: { id: target.hostId } }, body: { triage } }, handlers);
    }
  }

  return (
    <span className="flex items-center gap-1">
    <Select value={value} onValueChange={change} disabled={pending}>
      <SelectTrigger size="sm" aria-label={label} className="min-w-32">
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
    <RuleBadge rule={rule} compact />
    </span>
  );
}
