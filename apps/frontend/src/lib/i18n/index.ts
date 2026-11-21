import i18next from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import commonEn from "@/lib/i18n/locales/en/common.json";
import commonPl from "@/lib/i18n/locales/pl/common.json";

export const SUPPORTED_LANGUAGES = ["pl", "en"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** localStorage key the detector caches the chosen language under. */
export const LANGUAGE_STORAGE_KEY = "asi.language";

export const resources = {
  pl: { common: commonPl },
  en: { common: commonEn },
} as const;

// Resources are bundled eagerly, so init() resolves before the first render and
// no <Suspense> is needed around useTranslation().
void i18next
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "pl",
    supportedLngs: SUPPORTED_LANGUAGES,
    defaultNS: "common",
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ["localStorage"],
    },
  });

export default i18next;
