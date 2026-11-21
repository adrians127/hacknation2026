import { useTranslation } from "react-i18next";

import { toApiError } from "@/lib/api-error";

/** A translated, user-facing message for anything a query or mutation threw. */
export function useErrorMessage() {
  const { t } = useTranslation();
  return (error: unknown): string => {
    const apiError = toApiError(error);
    if (!apiError) return t("errors.network");
    if (apiError.code) return t(`errors.${apiError.code}`);
    if (apiError.status === 400) return t("errors.validation");
    if (apiError.status === 404) return t("errors.notFound");
    return t("errors.generic");
  };
}
