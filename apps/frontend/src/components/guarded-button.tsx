import type { ComponentProps, MouseEvent } from "react";

import type { Permission } from "@subsurf/contracts/auth/permissions";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBlockedReason } from "@/lib/auth/use-blocked-reason";
import { cn } from "@/lib/utils";

export interface GuardedButtonProps extends ComponentProps<typeof Button> {
  /** All required. A missing one blocks the button and is named in its tooltip. */
  permissions?: Permission[];
  /** Any other reason the action is unavailable (e.g. a read-only system role). */
  disabledReason?: string;
  /** Tooltip shown while the button is available (icon-only buttons). */
  tooltip?: string;
}

/**
 * A button that stays visible when the role cannot use it: blocked with
 * `aria-disabled` (still focusable, so the tooltip explains why) instead of
 * `disabled`, which would swallow the hover and focus. UI hint only; the
 * backend checks every permission again.
 */
export function GuardedButton({
  permissions = [],
  disabledReason,
  tooltip,
  onClick,
  className,
  ...props
}: GuardedButtonProps) {
  const reason = useBlockedReason(permissions, disabledReason);
  const blocked = reason !== undefined;

  const button = (
    <Button
      {...props}
      aria-disabled={blocked || undefined}
      className={cn(blocked && "cursor-not-allowed opacity-50", className)}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        if (blocked) event.preventDefault();
        else onClick?.(event);
      }}
    />
  );

  const content = reason ?? tooltip;
  if (!content) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{content}</TooltipContent>
    </Tooltip>
  );
}
