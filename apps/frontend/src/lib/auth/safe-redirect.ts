/** Only same-app paths: `?redirectTo=https://evil.example` or `//evil.example` must not leave the app. */
export function safeRedirectPath(value: string | null | undefined, fallback = "/"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return fallback;
  }
  return value;
}
