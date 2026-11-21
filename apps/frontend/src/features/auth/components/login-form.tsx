import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { LoginBodySchema } from "@hacknation/contracts/auth/auth.schema";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLogin } from "@/features/auth/api/login";
import { useErrorMessage } from "@/hooks/use-error-message";

type Field = "email" | "password";

export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useTranslation("auth");
  const errorMessage = useErrorMessage();
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = LoginBodySchema.safeParse({ email: email.trim(), password });
    if (!parsed.success) {
      const invalid = new Set(parsed.error.issues.map((issue) => issue.path[0]));
      setFieldErrors({
        email: invalid.has("email") ? t("login.invalidEmail") : undefined,
        password: invalid.has("password") ? t("login.passwordRequired") : undefined,
      });
      return;
    }
    setFieldErrors({});
    login.mutate({ body: parsed.data }, { onSuccess });
  }

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <div className="grid gap-2">
        <Label htmlFor="login-email">{t("login.email")}</Label>
        <Input
          id="login-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setFieldErrors((prev) => ({ ...prev, email: undefined }));
          }}
          aria-invalid={fieldErrors.email ? true : undefined}
          aria-describedby={fieldErrors.email ? "login-email-error" : undefined}
        />
        {fieldErrors.email && (
          <p id="login-email-error" className="text-sm text-destructive">
            {fieldErrors.email}
          </p>
        )}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="login-password">{t("login.password")}</Label>
        <Input
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setFieldErrors((prev) => ({ ...prev, password: undefined }));
          }}
          aria-invalid={fieldErrors.password ? true : undefined}
          aria-describedby={fieldErrors.password ? "login-password-error" : undefined}
        />
        {fieldErrors.password && (
          <p id="login-password-error" className="text-sm text-destructive">
            {fieldErrors.password}
          </p>
        )}
      </div>
      {login.isError && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(login.error)}
        </p>
      )}
      <Button type="submit" disabled={login.isPending}>
        {login.isPending ? t("login.submitting") : t("login.submit")}
      </Button>
    </form>
  );
}
