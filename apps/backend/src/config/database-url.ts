export const DB_SSL_MODES = [
  "disable",
  "allow",
  "prefer",
  "require",
  "verify-ca",
  "verify-full",
] as const;

export type DbSslMode = (typeof DB_SSL_MODES)[number];

export const DEFAULT_DB_PORT = 5432;
export const DEFAULT_DB_SSLMODE: DbSslMode = "require";

export type DatabaseParts = {
  DB_HOST: string;
  DB_PORT: number;
  DB_NAME: string;
  DB_USER: string;
  DB_PASSWORD: string;
  DB_SSLMODE: DbSslMode;
};

export function buildDatabaseUrl(parts: DatabaseParts): string {
  // Credentials may contain URL-significant characters.
  const user = encodeURIComponent(parts.DB_USER);
  const password = encodeURIComponent(parts.DB_PASSWORD);
  const query = new URLSearchParams({
    schema: "public",
    sslmode: parts.DB_SSLMODE,
    // Makes node-postgres honor sslmode with libpq semantics.
    uselibpqcompat: "true",
  });

  return `postgresql://${user}:${password}@${parts.DB_HOST}:${parts.DB_PORT}/${parts.DB_NAME}?${query.toString()}`;
}

/**
 * For `prisma.config.ts`, which cannot import the zod-parsed `env` (it would
 * `process.exit` during `prisma generate` on a fresh clone). Returns `undefined`
 * when the parts are incomplete so the caller can fall back to a placeholder.
 */
export function databaseUrlFromEnv(source: NodeJS.ProcessEnv = process.env): string | undefined {
  const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DB_SSLMODE } = source;

  if (!DB_HOST || !DB_NAME || !DB_USER || !DB_PASSWORD) return undefined;

  return buildDatabaseUrl({
    DB_HOST,
    DB_NAME,
    DB_USER,
    DB_PASSWORD,
    DB_PORT: DB_PORT ? Number(DB_PORT) : DEFAULT_DB_PORT,
    DB_SSLMODE: DB_SSL_MODES.find((mode) => mode === DB_SSLMODE) ?? DEFAULT_DB_SSLMODE,
  });
}
