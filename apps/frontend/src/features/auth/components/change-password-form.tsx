import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@hacknation/contracts/auth/auth.schema";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useChangePassword } from "@/features/auth/api/change-password";
import { useErrorMessage } from "@/hooks/use-error-message";
import { toApiError } from "@/lib/api-error";

type Field = "currentPassword" | "newPassword" | "confirmation";

export function ChangePasswordForm({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useTranslation("auth");
  const errorMessage = useErrorMessage();
  const changePassword = useChangePassword();
  const [values, setValues] = useState<Record<Field, string>>({
    currentPassword: "",
    newPassword: "",
    confirmation: "",
  });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});

  function validate(): Partial<Record<Field, string>> {
    const { currentPassword, newPassword, confirmation } = values;
    const next: Partial<Record<Field, string>> = {};
    if (!currentPassword) next.currentPassword = t("login.passwordRequired");
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      next.newPassword = t("changePassword.tooShort", { min: PASSWORD_MIN_LENGTH });
    } else if (newPassword.length > PASSWORD_MAX_LENGTH) {
      next.newPassword = t("changePassword.tooLong", { max: PASSWORD_MAX_LENGTH });
    } else if (newPassword === currentPassword) {
      next.newPassword = t("changePassword.sameAsCurrent");
    }
    if (confirmation !== newPassword) next.confirmation = t("changePassword.mismatch");
    return next;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    changePassword.mutate(
      { body: { currentPassword: values.currentPassword, newPassword: values.newPassword } },
      {
        onSuccess,
        onError: (error) => {
          if (toApiError(error)?.code === "INVALID_CREDENTIALS") {
            setErrors({ currentPassword: t("changePassword.wrongCurrent") });
          }
        },
      },
    );
  }

  const serverError =
    changePassword.isError && toApiError(changePassword.error)?.code !== "INVALID_CREDENTIALS"
      ? errorMessage(changePassword.error)
      : null;

  const field = (name: Field, label: string, autoComplete: string, hint?: string) => (
    <div className="grid gap-2">
      <Label htmlFor={`password-${name}`}>{label}</Label>
      <Input
        id={`password-${name}`}
        type="password"
        autoComplete={autoComplete}
        value={values[name]}
        onChange={(event) => {
          setValues((prev) => ({ ...prev, [name]: event.target.value }));
          setErrors((prev) => ({ ...prev, [name]: undefined }));
        }}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={`password-${name}-note`}
      />
      <p
        id={`password-${name}-note`}
        className={errors[name] ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
      >
        {errors[name] ?? hint}
      </p>
    </div>
  );

  return (
    <form className="grid gap-3" onSubmit={submit} noValidate>
      {field("currentPassword", t("changePassword.current"), "current-password")}
      {field(
        "newPassword",
        t("changePassword.new"),
        "new-password",
        t("changePassword.hint", { min: PASSWORD_MIN_LENGTH }),
      )}
      {field("confirmation", t("changePassword.confirm"), "new-password")}
      {serverError && (
        <p role="alert" className="text-sm text-destructive">
          {serverError}
        </p>
      )}
      <Button type="submit" disabled={changePassword.isPending}>
        {changePassword.isPending ? t("changePassword.submitting") : t("changePassword.submit")}
      </Button>
    </form>
  );
}
