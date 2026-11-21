import { useTranslation } from "react-i18next";
import { useRouteError } from "react-router";

import { Button } from "@/components/ui/button";
import { useErrorMessage } from "@/hooks/use-error-message";

export function RouteError() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const error = useRouteError();

  return (
    <main className="flex min-h-[50svh] flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold">{t("routeError.title")}</h1>
      <p className="text-muted-foreground">{errorMessage(error)}</p>
      <Button variant="outline" onClick={() => window.location.reload()}>
        {t("routeError.retry")}
      </Button>
    </main>
  );
}
