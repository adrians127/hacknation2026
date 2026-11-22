import { useTranslation } from "react-i18next";

import type { RuleDefinition } from "@subsurf/contracts/rules/rules.schema";

/** The rule in words: what it matches, where, and what it does. */
export function RuleSummary({ definition }: { definition: RuleDefinition }) {
  const { t } = useTranslation("rules");
  const { t: th } = useTranslation("hosts");
  const { t: tv } = useTranslation("vulnerabilities");
  const { t: tc } = useTranslation();

  const { scope } = definition;
  const where = [
    scope.ranges.length > 0 && scope.ranges.join(", "),
    scope.hostTags.length > 0 && t("summary.tags", { tags: scope.hostTags.join(", ") }),
    scope.ports.length > 0 && t("summary.ports", { ports: scope.ports.join(", ") }),
    scope.products.length > 0 && t("summary.products", { products: scope.products.join(", ") }),
  ].filter((part) => part !== false);

  const what: string[] = [];
  let action: string;
  switch (definition.kind) {
    case "vulnerability": {
      const { condition } = definition;
      if (condition.vulnerabilityIds.length > 0) what.push(condition.vulnerabilityIds.join(", "));
      if (condition.severities.length > 0) {
        what.push(condition.severities.map((severity) => tv(`severity.${severity}`)).join(", "));
      }
      if (condition.cvssAtLeast !== null) what.push(t("summary.cvssAtLeast", { score: condition.cvssAtLeast }));
      if (condition.cvssBelow !== null) what.push(t("summary.cvssBelow", { score: condition.cvssBelow }));
      if (condition.kev !== null) what.push(t(condition.kev ? "summary.kev" : "summary.notKev"));
      if (condition.confidence !== null) what.push(tv(`confidence.${condition.confidence}`));
      if (condition.reasons.length > 0) {
        what.push(condition.reasons.map((reason) => t(`reasons.${reason}`)).join(", "));
      }
      if (what.length === 0) what.push(t("summary.anyVulnerability"));
      action = tv(`triage.${definition.action.triage}`);
      break;
    }
    case "service": {
      const { condition, action: set } = definition;
      what.push(t(`targets.${condition.target}`));
      if (condition.titles.length > 0) what.push(t("summary.titles", { titles: condition.titles.join(", ") }));
      action = [set.triage && th(`triage.${set.triage}`), set.tag && t("summary.tag", { tag: set.tag })]
        .filter(Boolean)
        .join(" + ");
      break;
    }
    case "unchanged":
      what.push(
        t("summary.unchanged", {
          target: t(`targets.${definition.condition.target}`),
          count: definition.condition.scans,
        }),
      );
      action = th(`triage.${definition.action.triage}`);
      break;
    case "change_priority": {
      const { condition } = definition;
      if (condition.rows.length > 0) what.push(condition.rows.map((row) => t(`rows.${row}`)).join(", "));
      if (condition.changes.length > 0) {
        what.push(condition.changes.map((change) => th(`change.${change}`)).join(", "));
      }
      if (condition.fields.length > 0) {
        what.push(condition.fields.map((field) => th(`fieldChange.fields.${field}`)).join(", "));
      }
      if (condition.keys.length > 0) what.push(t("summary.keys", { keys: condition.keys.join(", ") }));
      if (condition.lifecycles.length > 0) {
        what.push(condition.lifecycles.map((state) => t(`lifecycles.${state}`)).join(", "));
      }
      if (condition.priorities.length > 0) {
        what.push(
          t("summary.priorities", {
            priorities: condition.priorities.map((priority) => tc(`dashboard.priority.${priority}`)).join(", "),
          }),
        );
      }
      if (what.length === 0) what.push(t("summary.anyChange"));
      action =
        definition.action.type === "mute"
          ? t("actions.mute")
          : t("summary.priority", { priority: tc(`dashboard.priority.${definition.action.priority}`) });
      break;
    }
  }

  return (
    <div className="grid gap-0.5 text-sm">
      <span>
        {what.join(" · ")} <span aria-hidden>→</span> <span className="font-medium">{action}</span>
      </span>
      <span className="text-xs text-muted-foreground">
        {where.length > 0 ? where.join(" · ") : t("summary.anywhere")}
      </span>
    </div>
  );
}
