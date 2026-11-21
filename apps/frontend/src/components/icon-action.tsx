import type { ReactNode } from "react";
import { Link } from "react-router";

import type { Permission } from "@hacknation/contracts/auth/permissions";

import { GuardedButton } from "@/components/guarded-button";
import { useBlockedReason } from "@/lib/auth/use-blocked-reason";

interface IconActionProps {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  /** Renders a link instead of a button. */
  to?: string;
  permissions?: Permission[];
  disabledReason?: string;
  destructive?: boolean;
}

/** Icon-only row action whose tooltip says what it does, or why the role cannot use it. */
export function IconAction({
  label,
  icon,
  onClick,
  to,
  permissions = [],
  disabledReason,
  destructive,
}: IconActionProps) {
  const blocked = useBlockedReason(permissions, disabledReason) !== undefined;
  const asLink = Boolean(to) && !blocked;

  return (
    <GuardedButton
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      tooltip={label}
      permissions={permissions}
      disabledReason={disabledReason}
      className={destructive ? "text-destructive hover:text-destructive" : undefined}
      onClick={to ? undefined : onClick}
      asChild={asLink}
    >
      {asLink && to ? <Link to={to}>{icon}</Link> : icon}
    </GuardedButton>
  );
}
