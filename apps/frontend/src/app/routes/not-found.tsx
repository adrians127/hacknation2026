import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";

export function NotFoundRoute() {
  const { t } = useTranslation();

  return (
    <section className="flex flex-col items-center justify-center gap-4 py-16">
      <h1 className="text-2xl font-semibold">{t("notFound.title")}</h1>
      <Button asChild variant="outline">
        <Link to="/">{t("notFound.back")}</Link>
      </Button>
    </section>
  );
}
