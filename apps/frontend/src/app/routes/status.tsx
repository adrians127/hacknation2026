import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { api } from "@/api/client";
import { LanguageToggle } from "@/components/language-toggle";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function StatusDot({ up }: { up: boolean }) {
  return <span className={`inline-block size-2 rounded-full ${up ? "bg-emerald-500" : "bg-destructive"}`} />;
}

/** Public API and database health (`GET /health` needs no session). */
export function StatusRoute() {
  const { t } = useTranslation();
  const health = api.useQuery("get", "/health");

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-6">
      <Link to="/">
        <Logo variant="full" label={t("appName")} className="w-48" />
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t("health.title")}</CardTitle>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t("health.refresh")}
            onClick={() => void health.refetch()}
          >
            <RefreshCw className={health.isFetching ? "animate-spin" : undefined} />
          </Button>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {health.isPending ? (
            <p className="text-muted-foreground">{t("health.loading")}</p>
          ) : health.isError ? (
            <p className="flex items-center gap-2">
              <StatusDot up={false} /> {t("health.unreachable")}
            </p>
          ) : (
            <>
              <p className="flex items-center gap-2">
                <StatusDot up /> {t("health.api")}: {health.data.status} (v{health.data.version})
              </p>
              <p className="flex items-center gap-2">
                <StatusDot up={health.data.database === "up"} /> {t("health.database")}:{" "}
                {t(health.data.database === "up" ? "health.up" : "health.down")}
              </p>
            </>
          )}
        </CardContent>
      </Card>
      <LanguageToggle />
    </main>
  );
}
