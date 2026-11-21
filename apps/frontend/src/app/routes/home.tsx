import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function StatusDot({ up }: { up: boolean }) {
  return <span className={`inline-block size-2 rounded-full ${up ? "bg-emerald-500" : "bg-destructive"}`} />;
}

export function HomeRoute() {
  const { t, i18n } = useTranslation();
  const health = api.useQuery("get", "/health");

  const nextLanguage = i18n.resolvedLanguage === "pl" ? "en" : "pl";

  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("appName")}</h1>
          <p className="text-muted-foreground">{t("tagline")}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void i18n.changeLanguage(nextLanguage)}>
          {t("language.switchTo")}
        </Button>
      </header>

      <Card>
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
    </main>
  );
}
