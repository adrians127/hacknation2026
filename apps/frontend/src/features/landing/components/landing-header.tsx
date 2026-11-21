import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { Logo } from "@/components/logo";

const NAV_ITEMS = [
  { key: "features", href: "#features" },
  { key: "about", href: "#about" },
] as const;

export function LandingHeader({ signInHref, ctaHref }: { signInHref: string; ctaHref: string }) {
  const { t, i18n } = useTranslation();
  const nextLanguage = i18n.resolvedLanguage === "pl" ? "en" : "pl";

  return (
    <header className="relative z-10 mx-auto grid w-full max-w-[1500px] grid-cols-[1fr_auto_1fr] items-center px-6 py-5 sm:px-10">
      <Link to="/" className="flex items-center gap-3 justify-self-start">
        <Logo variant="icon" label={t("landing.logoAlt")} className="w-16" />
        <span className="text-3xl font-bold tracking-tight text-white">
          Sub<span className="text-brand">Surf</span>
        </span>
      </Link>

      <nav aria-label={t("landing.nav.label")} className="hidden items-center gap-14 justify-self-center md:flex">
        {NAV_ITEMS.map(({ key, href }) => (
          <a key={key} href={href} className="text-white/90 transition-colors hover:text-brand">
            {t(`landing.nav.${key}`)}
          </a>
        ))}
      </nav>

      <div className="col-start-3 flex items-center gap-5 justify-self-end">
        <button
          type="button"
          onClick={() => void i18n.changeLanguage(nextLanguage)}
          className="text-sm text-white/60 transition-colors hover:text-white"
        >
          {t("language.switchTo")}
        </button>
        <Link to={signInHref} className="hidden text-white/90 transition-colors hover:text-white sm:block">
          {t("landing.signIn")}
        </Link>
        <Link
          to={ctaHref}
          className="flex items-center gap-2 rounded-full border border-brand px-5 py-2.5 text-sm font-medium text-brand transition-colors hover:bg-brand/10"
        >
          {t("landing.getStarted")}
          <ArrowRight className="size-4" />
        </Link>
      </div>
    </header>
  );
}
