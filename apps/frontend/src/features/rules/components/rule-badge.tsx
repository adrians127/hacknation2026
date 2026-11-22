import { WandSparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { RuleRef } from "@subsurf/contracts/rules/rule-ref.schema";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Marks a value a rule set (or a change a rule re-rated); links to the rules. */
export function RuleBadge({ rule, compact = false }: { rule: RuleRef | null; compact?: boolean }) {
  const { t } = useTranslation("rules");
  if (!rule) return null;
  const label = t("badge.setBy", { name: rule.name });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link to="/app/rules" aria-label={label} className="inline-flex w-fit">
          <Badge variant="outline" className="gap-1 border-violet-500/40 text-violet-400">
            <WandSparkles aria-hidden />
            {!compact && <span className="max-w-40 truncate">{rule.name}</span>}
          </Badge>
        </Link>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
