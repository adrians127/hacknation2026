import { z } from "zod";

// Own file without imports: scan and vulnerability schemas use it, and rules.schema.ts imports those.

/** The rule that set a value or rated a change (`/rules`). */
export const RuleRefSchema = z.object({ id: z.uuid(), name: z.string() });

export type RuleRef = z.infer<typeof RuleRefSchema>;
