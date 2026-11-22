import { Upload, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { DefectDojoPush } from "@subsurf/contracts/defectdojo/defectdojo.schema";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { GuardedButton } from "@/components/guarded-button";
import { Button } from "@/components/ui/button";
import { useDefectDojoStatus } from "@/features/defectdojo/api/get-defectdojo-status";
import { usePushDefectDojo } from "@/features/defectdojo/api/push-defectdojo";
import { useErrorMessage } from "@/hooks/use-error-message";
import { useCan } from "@/lib/auth/use-can";
import { formatNumber } from "@/lib/format";

interface Selection {
  hostIds: ReadonlySet<string>;
  serviceIds: ReadonlySet<string>;
}

/** Push the whole scan, or the selected hosts and services, to DefectDojo. */
export function DefectDojoPushActions({
  scanId,
  selection,
  onClearSelection,
}: {
  scanId: string;
  selection: Selection;
  onClearSelection: () => void;
}) {
  const { t, i18n } = useTranslation();
  const errorMessage = useErrorMessage();
  const canRead = useCan("defectdojo:read");
  const status = useDefectDojoStatus(canRead);
  const push = usePushDefectDojo();
  const [confirm, setConfirm] = useState<"scan" | "selection" | null>(null);

  const selected = selection.hostIds.size + selection.serviceIds.size;
  const notConfigured = status.isSuccess && !status.data.configured ? t("defectdojo.notConfigured") : undefined;
  const n = (value: number) => formatNumber(value, i18n.resolvedLanguage);

  const run = (scope: "scan" | "selection") =>
    push.mutate(
      {
        body:
          scope === "scan"
            ? { scanId }
            : { scanId, hostIds: [...selection.hostIds], serviceIds: [...selection.serviceIds] },
      },
      {
        onSuccess: (result: DefectDojoPush) => {
          setConfirm(null);
          if (scope === "selection") onClearSelection();
          toast.success(
            t("defectdojo.push.toast", {
              findings: n(result.findings),
              created: n(result.stats?.created ?? 0),
              closed: n(result.stats?.closed ?? 0),
              untouched: n(result.stats?.untouched ?? 0),
            }),
          );
        },
      },
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {selected > 0 && (
        <>
          <GuardedButton
            permissions={["defectdojo:export"]}
            disabledReason={notConfigured}
            onClick={() => setConfirm("selection")}
          >
            <Upload />
            {t("defectdojo.push.selected", { count: selected })}
          </GuardedButton>
          <Button variant="ghost" size="sm" onClick={onClearSelection}>
            <X />
            {t("defectdojo.push.clear")}
          </Button>
        </>
      )}
      <GuardedButton
        variant="outline"
        permissions={["defectdojo:export"]}
        disabledReason={notConfigured}
        tooltip={t("defectdojo.push.hint")}
        onClick={() => setConfirm("scan")}
      >
        <Upload />
        {t("defectdojo.push.scan")}
      </GuardedButton>

      {confirm && (
        <ConfirmDialog
          title={confirm === "scan" ? t("defectdojo.push.confirmScanTitle") : t("defectdojo.push.confirmSelectionTitle", { count: selected })}
          description={
            confirm === "scan" ? t("defectdojo.push.confirmScan") : t("defectdojo.push.confirmSelection")
          }
          confirmLabel={t("defectdojo.push.confirm")}
          pending={push.isPending}
          error={push.isError ? errorMessage(push.error) : null}
          onConfirm={() => run(confirm)}
          onCancel={() => {
            setConfirm(null);
            push.reset();
          }}
        />
      )}
    </div>
  );
}
