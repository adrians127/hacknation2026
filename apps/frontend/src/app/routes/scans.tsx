import { Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { GuardedButton } from "@/components/guarded-button";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useScans } from "@/features/scans/api/get-scans";
import { useStartScan } from "@/features/scans/api/start-scan";
import { ScansTable } from "@/features/scans/components/scans-table";
import { useErrorMessage } from "@/hooks/use-error-message";

export function ScansRoute() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const scans = useScans();
  const startScan = useStartScan();

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t("scans.title")}
        description={t("scans.subtitle")}
        actions={
          <GuardedButton
            permissions={["scans:run"]}
            disabled={startScan.isPending}
            onClick={() =>
              startScan.mutate(undefined, {
                onSuccess: () => toast.success(t("scans.toast.started")),
                onError: (error) => toast.error(errorMessage(error)),
              })
            }
          >
            <Play />
            {startScan.isPending ? t("scans.starting") : t("scans.start")}
          </GuardedButton>
        }
      />

      {scans.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : scans.isError ? (
        <p role="alert" className="text-destructive">
          {errorMessage(scans.error)}
        </p>
      ) : (
        <Card>
          <CardContent>
            <ScansTable scans={scans.data.items} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
