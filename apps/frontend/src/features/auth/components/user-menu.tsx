import { KeyRound, LogOut, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLogout } from "@/features/auth/api/logout";
import { useRoleLabels } from "@/lib/auth/labels";
import { useMe } from "@/lib/auth/me-query";

export function UserMenu() {
  const { t } = useTranslation("auth");
  const me = useMe();
  const roleLabels = useRoleLabels();
  const navigate = useNavigate();
  const logout = useLogout();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t("userMenu.label")}>
          <UserRound />
          <span className="hidden sm:inline">{me.displayName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="grid gap-0.5">
          <span className="font-medium text-foreground">{me.displayName}</span>
          <span className="text-xs font-normal text-muted-foreground">{me.email}</span>
          <span className="text-xs font-normal text-muted-foreground">{roleLabels.name(me.role)}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void navigate("/app/change-password")}>
          <KeyRound />
          {t("userMenu.changePassword")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            logout.mutate({}, { onSettled: () => void navigate("/login", { replace: true }) })
          }
        >
          <LogOut />
          {t("userMenu.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
