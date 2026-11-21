import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function PageHeader({
  title,
  description,
  actions,
  mocked = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Page-level buttons, aligned right. */
  actions?: ReactNode;
  /** The page still shows mock data (`features/<name>/api/mocks.ts`); drop it with the mock. */
  mocked?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="grid gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {mocked && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  tabIndex={0}
                  className="cursor-help border-amber-500/40 bg-amber-500/10 text-amber-400"
                >
                  {t("mock.badge")}
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{t("mock.tooltip")}</TooltipContent>
            </Tooltip>
          )}
        </div>
        {description && <p className="max-w-2xl text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
