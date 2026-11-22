import i18next from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import adminEn from "@/lib/i18n/locales/en/admin.json";
import authEn from "@/lib/i18n/locales/en/auth.json";
import commonEn from "@/lib/i18n/locales/en/common.json";
import hostsEn from "@/lib/i18n/locales/en/hosts.json";
import pipelinesEn from "@/lib/i18n/locales/en/pipelines.json";
import reportsEn from "@/lib/i18n/locales/en/reports.json";
import vulnerabilitiesEn from "@/lib/i18n/locales/en/vulnerabilities.json";
import adminPl from "@/lib/i18n/locales/pl/admin.json";
import authPl from "@/lib/i18n/locales/pl/auth.json";
import commonPl from "@/lib/i18n/locales/pl/common.json";
import hostsPl from "@/lib/i18n/locales/pl/hosts.json";
import pipelinesPl from "@/lib/i18n/locales/pl/pipelines.json";
import reportsPl from "@/lib/i18n/locales/pl/reports.json";
import vulnerabilitiesPl from "@/lib/i18n/locales/pl/vulnerabilities.json";

export const SUPPORTED_LANGUAGES = ["en", "pl"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** localStorage key the detector caches the chosen language under. */
export const LANGUAGE_STORAGE_KEY = "subsurf.language";

export const resources = {
  en: {
    common: commonEn,
    auth: authEn,
    admin: adminEn,
    hosts: hostsEn,
    pipelines: pipelinesEn,
    reports: reportsEn,
    vulnerabilities: vulnerabilitiesEn,
  },
  pl: {
    common: commonPl,
    auth: authPl,
    admin: adminPl,
    hosts: hostsPl,
    pipelines: pipelinesPl,
    reports: reportsPl,
    vulnerabilities: vulnerabilitiesPl,
  },
} as const;

// Resources are bundled eagerly, so init() resolves before the first render and
// no <Suspense> is needed around useTranslation().
void i18next
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
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
