import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";

import { LanguageToggle } from "@/components/language-toggle";
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
      <div className="flex items-center gap-2 text-lg font-semibold">
        <ShieldCheck className="size-6 text-primary" />
        {t("appName")}
      </div>
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
