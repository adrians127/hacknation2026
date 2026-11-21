import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "~backend": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      // Unreachable on purpose: tests must not depend on a running database.
      DB_HOST: "127.0.0.1",
      DB_PORT: "1",
      DB_NAME: "test",
      DB_USER: "test",
      DB_PASSWORD: "test",
      DB_SSLMODE: "disable",
    },
  },
});
