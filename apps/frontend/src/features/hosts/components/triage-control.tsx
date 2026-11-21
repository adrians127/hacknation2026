import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { TriageStatusSchema, type TriageStatus } from "@subsurf/contracts/hosts/hosts.schema";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUpdateHost } from "@/features/hosts/api/update-host";
import { useUpdateService } from "@/features/hosts/api/update-service";
import { TriageBadge } from "@/features/hosts/components/triage-badge";
import { useErrorMessage } from "@/hooks/use-error-message";
import { useCan } from "@/lib/auth/use-can";

type TriageTarget = { hostId: string; serviceId?: string };

/** Changes the triage status in place; roles without `hosts:update` see a badge. */
export function TriageControl({
  target,
  value,
  label,
}: {
  target: TriageTarget;
  value: TriageStatus;
  /** Accessible name, e.g. "Triage of 10.40.1.10". */
  label: string;
}) {
  const { t } = useTranslation("hosts");
  const errorMessage = useErrorMessage();
  const canEdit = useCan("hosts:update");
  const updateHost = useUpdateHost();
  const updateService = useUpdateService();
  const pending = updateHost.isPending || updateService.isPending;

  if (!canEdit) return <TriageBadge status={value} />;

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
  );
}
