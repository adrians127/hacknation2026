import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangePasswordForm } from "@/features/auth/components/change-password-form";
import { useMe } from "@/lib/auth/me-query";

export function ChangePasswordRoute() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const me = useMe();

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>{t("changePassword.title")}</CardTitle>
        <CardDescription>
          {me.mustChangePassword ? t("changePassword.forcedDescription") : t("changePassword.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChangePasswordForm
          onSuccess={() => {
            toast.success(t("changePassword.success"));
            void navigate("/", { replace: true });
          }}
        />
      </CardContent>
    </Card>
  );
}
