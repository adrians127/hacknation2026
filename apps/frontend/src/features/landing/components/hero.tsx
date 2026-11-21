import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { Logo } from "@/components/logo";

export function Hero({ ctaHref }: { ctaHref: string }) {
  const { t } = useTranslation();

  return (
    <section className="mx-auto flex max-w-4xl flex-col items-center px-6 text-center">
      <Logo variant="full" label={t("landing.logoAlt")} className="w-64 sm:w-80" />

      <h1 className="mt-6 text-3xl leading-tight font-bold tracking-tight text-white sm:text-4xl">
        {t("landing.headline.line1")}
        <br />
        <span className="text-brand">{t("landing.headline.line2")}</span>
      </h1>

      <Link
        to={ctaHref}
        className="mt-8 flex items-center gap-3 rounded-full bg-brand px-8 py-4 text-lg font-medium text-white shadow-[0_0_40px_-8px] shadow-brand transition-colors hover:bg-brand/90"
      >
        {t("landing.getStarted")}
        <ArrowRight className="size-5" />
      </Link>
    </section>
  );
}
