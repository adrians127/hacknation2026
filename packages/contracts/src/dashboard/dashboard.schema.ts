import { z } from "zod";

export const ChangeKindSchema = z.enum(["new", "disappeared", "changed"]);

export const ChangeSchema = z.object({
  id: z.uuid(),
  kind: ChangeKindSchema,
  host: z.string(),
  service: z.string(),
  detail: z.string(),
  detectedAt: z.iso.datetime(),
});

export const DashboardResponseSchema = z.object({
  activeHosts: z.number().int().nonnegative(),
  newServices: z.number().int().nonnegative(),
  disappearedServices: z.number().int().nonnegative(),
  changedServices: z.number().int().nonnegative(),
  recentChanges: z.array(ChangeSchema),
});

export type ChangeKind = z.infer<typeof ChangeKindSchema>;
export type Change = z.infer<typeof ChangeSchema>;
export type DashboardResponse = z.infer<typeof DashboardResponseSchema>;
