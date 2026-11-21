import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// With the extension: Vite's native config loader does not resolve extensionless imports.
import { TEST_ENV } from "./src/test/test-env.ts";

export default defineConfig({
  resolve: {
    alias: { "~backend": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: TEST_ENV,
    // Integration tests against a real database (`hacknation_test`, see src/test/).
    globalSetup: ["src/test/global-setup.ts"],
    setupFiles: ["src/test/setup.ts"],
    // One shared database, truncated before every test: files must not overlap.
    fileParallelism: false,
  },
});
