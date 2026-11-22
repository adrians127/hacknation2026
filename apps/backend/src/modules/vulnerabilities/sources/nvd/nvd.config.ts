import { z } from "zod";

// Must match .env.example.
const envSchema = z.object({
  NVD_FEED_URL: z
    .string()
    .regex(/^(https?|file):\/\//, "An http(s):// or file:// URL")
    .default("https://nvd.nist.gov/feeds/json/cve/2.0"),
  NVD_FIRST_YEAR: z.coerce.number().int().min(1999).max(2100).default(2002),
});

const blankAsAbsent = (value: string | undefined) => (value === "" ? undefined : value);

/** Read when the source is built: config/env.ts has already loaded `.env`. */
export function nvdConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = envSchema.parse({
    NVD_FEED_URL: blankAsAbsent(env.NVD_FEED_URL),
    NVD_FIRST_YEAR: blankAsAbsent(env.NVD_FIRST_YEAR),
  });
  return { feedUrl: config.NVD_FEED_URL.replace(/\/+$/, ""), firstYear: config.NVD_FIRST_YEAR };
}

export type NvdConfig = ReturnType<typeof nvdConfig>;
