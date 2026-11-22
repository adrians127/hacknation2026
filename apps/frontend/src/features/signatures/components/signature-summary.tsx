import { useTranslation } from "react-i18next";

import type {
  SignatureCondition,
  SignatureDefinition,
  SignatureMatcher,
} from "@subsurf/contracts/signatures/signatures.schema";

/** The definition in one line per condition: what has to be seen for it to match. */
export function SignatureSummary({ definition }: { definition: SignatureDefinition }) {
  const { t } = useTranslation("signatures");
  const op = (matcher: SignatureMatcher) => t(`ops.${matcher.op}`);

  function line(condition: SignatureCondition): string {
    switch (condition.target) {
      case "header":
        return condition.value
          ? t("summary.headerValue", {
              name: condition.name.value,
              op: op(condition.value),
              value: condition.value.value,
            })
          : t("summary.header", { name: condition.name.value });
      case "cookie":
        return t("summary.cookie", { op: op(condition.name), value: condition.name.value });
      case "service":
        return t("summary.service", {
          field: t(`fields.${condition.field}`),
          op: op(condition.value),
          value: condition.value.value,
        });
      case "favicon":
        return t("summary.favicon", { hashes: condition.mmh3.join(", ") });
      case "probe":
        return t("summary.probe", { path: condition.path, status: condition.status.join(", ") });
      case "port":
        return t("summary.port", { ports: condition.ports.join(", ") });
      default:
        return t("summary.text", {
          target: t(`targets.${condition.target}`),
          op: op(condition.value),
          value: condition.value.value,
        });
    }
  }

  return (
    <ul className="grid max-w-md min-w-56 gap-0.5 text-xs whitespace-normal">
      {definition.conditions.map((condition, index) => (
        <li key={index} className="[overflow-wrap:anywhere]">
          {index > 0 && (
            <span className="text-muted-foreground">{t(`summary.${definition.match}`)} </span>
          )}
          <span className="font-mono">{line(condition)}</span>
        </li>
      ))}
    </ul>
  );
}
