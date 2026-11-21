function required(name: keyof ImportMetaEnv): string {
  const value = import.meta.env[name];
  if (typeof value !== "string" || value === "") {
    throw new Error(`Missing ${name} — copy apps/frontend/.env.example to .env (pnpm project:setup)`);
  }
  return value;
}

export const env = Object.freeze({
  apiBaseUrl: required("VITE_API_BASE_URL").replace(/\/$/, ""),
});
