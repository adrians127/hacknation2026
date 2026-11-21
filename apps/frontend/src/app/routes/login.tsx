import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";

import { LanguageToggle } from "@/components/language-toggle";
import { Logo } from "@/components/logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/features/auth/components/login-form";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";

export function LoginRoute() {
  const { t } = useTranslation();
  const { t: tAuth } = useTranslation("auth");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-4">
      <Logo variant="full" label={t("appName")} className="w-48" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{tAuth("login.title")}</CardTitle>
          <CardDescription>{tAuth("login.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm
            onSuccess={() =>
              void navigate(safeRedirectPath(searchParams.get("redirectTo")), { replace: true })
            }
          />
        </CardContent>
      </Card>
      <LanguageToggle />
    </main>
  );
}
