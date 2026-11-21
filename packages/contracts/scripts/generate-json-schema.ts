import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { ScanResultDocumentSchema } from "../src/results/result.schema";

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = join(here, "../result.schema.json");

async function main(): Promise<void> {
  const schema = z.toJSONSchema(ScanResultDocumentSchema, { target: "draft-2020-12" });
  await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`);
  console.log(`result.json schema written to ${outputPath}`);
}

main().catch((error: unknown) => {
  console.error("Failed to generate the result.json schema:", error);
  process.exit(1);
});
