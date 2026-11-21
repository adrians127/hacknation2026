import "i18next";

import type { resources } from "@/lib/i18n";

// Typed t(): unknown keys are compile errors. Polish is the reference language.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: (typeof resources)["pl"];
  }
}
