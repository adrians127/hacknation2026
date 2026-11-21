import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { glob } from "glob";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "../src");

/**
 * Imports every `*.openapi.ts` for its registration side effects, so adding a
 * feature needs no central list.
 *
 * Sorted and awaited one at a time on purpose: registration order determines the
 * order of `components.schemas` and `paths` in the generated spec, and
 * `openapi.json` is a committed artifact. Importing concurrently (or in glob
 * order, which is filesystem-dependent) made every regeneration produce a
 * different-but-equivalent file, so real changes were buried in reordering noise.
 */
export async function importRegistries(): Promise<void> {
  const files = await glob("**/*.openapi.ts", { cwd: srcDir, absolute: true });
  for (const file of files.toSorted()) {
    await import(pathToFileURL(file).href);
  }
}
