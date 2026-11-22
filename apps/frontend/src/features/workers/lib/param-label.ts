import { useTranslation } from "react-i18next";

import type { WorkerParamField } from "@subsurf/contracts/workers/worker-catalog";

const KNOWN_LABELS = new Set(["wait_seconds", "retries", "host_timeout_ms", "probe_paths"]);
type KnownLabel = "wait_seconds" | "retries" | "host_timeout_ms" | "probe_paths";
const isKnownLabel = (key: string): key is KnownLabel => KNOWN_LABELS.has(key);

/** Built-in fields are translated by key; a custom worker's fields show the label it was given. */
export function useParamLabel() {
  const { t } = useTranslation("pipelines");
  return (field: WorkerParamField) => (isKnownLabel(field.key) ? t(`params.${field.key}`) : field.label);
}
