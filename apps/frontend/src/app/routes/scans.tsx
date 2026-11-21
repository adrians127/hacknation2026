import { Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { GuardedButton } from "@/components/guarded-button";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useScans } from "@/features/scans/api/get-scans";
import { ScansTable } from "@/features/scans/components/scans-table";
import { useErrorMessage } from "@/hooks/use-error-message";

export function ScansRoute() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const scans = useScans();

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t("scans.title")}
        description={t("scans.subtitle")}
        actions={
          // Scans are queued by importing targets with "Start a scan right away".
          <GuardedButton
            permissions={["targets:create", "scans:run"]}
            onClick={() => void navigate("/app/targets/new")}
          >
            <Play />
            {t("scans.start")}
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
