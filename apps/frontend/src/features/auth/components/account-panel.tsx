import { KeyRound, LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import { LanguageToggle } from "@/components/language-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLogout } from "@/features/auth/api/logout";
import { useRoleLabels } from "@/lib/auth/labels";
import { useMe } from "@/lib/auth/me-query";

/** The signed-in user and account actions, at the bottom of the sidebar. */
export function AccountPanel() {
  const { t } = useTranslation("auth");
  const me = useMe();
  const roleLabels = useRoleLabels();
  const navigate = useNavigate();
  const logout = useLogout();

  return (
    <section aria-label={t("account.label")} className="grid gap-3">
      <div className="grid gap-1 text-sm">
        <span className="font-medium">{me.displayName}</span>
        <span className="truncate text-xs text-muted-foreground">{me.email}</span>
        <Badge variant="outline" className="w-fit">
          {roleLabels.name(me.role)}
        </Badge>
      </div>
      <Button asChild variant="ghost" size="sm" className="-ml-1.5 justify-start">
        <Link to="/app/change-password">
          <KeyRound />
          {t("account.changePassword")}
        </Link>
      </Button>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={logout.isPending}
          onClick={() =>
            logout.mutate({}, { onSettled: () => void navigate("/login", { replace: true }) })
          }
        >
          <LogOut />
          {t("account.signOut")}
        </Button>
        <LanguageToggle />
      </div>
    </section>
  );
}
