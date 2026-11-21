// Shared by vitest.config.ts (worker env) and global-setup.ts (database bootstrap).
// Connection defaults match docker/docker-compose.yml; CI overrides them through the environment.
export const TEST_DATABASE_NAME = "hacknation_test";

export const TEST_ENV = {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  DB_HOST: process.env.DB_HOST ?? "localhost",
  DB_PORT: process.env.DB_PORT ?? "5432",
  DB_USER: process.env.DB_USER ?? "hacknation",
  DB_PASSWORD: process.env.DB_PASSWORD ?? "hacknation",
  DB_SSLMODE: process.env.DB_SSLMODE ?? "disable",
  // Always a separate database: the setup truncates every table before each test.
  DB_NAME: TEST_DATABASE_NAME,
  JWT_SECRET: "test-only-jwt-secret-at-least-32-characters-long",
  DATA_ENCRYPTION_KEY: "dGVzdC1vbmx5LWRhdGEta2V5LTAxMjM0NTY3ODlhYmM=",
} as const;
