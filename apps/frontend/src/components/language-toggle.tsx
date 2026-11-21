import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

export function LanguageToggle() {
  const { t, i18n } = useTranslation();
  const nextLanguage = i18n.resolvedLanguage === "pl" ? "en" : "pl";

  return (
    <Button variant="ghost" size="sm" onClick={() => void i18n.changeLanguage(nextLanguage)}>
      {t("language.switchTo")}
    </Button>
  );
}
