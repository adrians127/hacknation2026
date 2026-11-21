import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node26",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: false,
  deps: {
    // Contracts ship raw TS (no build), so they must be bundled in, not left as imports.
    alwaysBundle: [/^@subsurf\//],
  },
});
