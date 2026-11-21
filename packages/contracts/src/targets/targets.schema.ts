import { z } from "zod";

import { NonBlankStringSchema } from "../common/common.schema";

export const TargetKindSchema = z.enum(["ip", "cidr", "domain"]);

export const TargetSchema = z.object({
  id: z.uuid(),
  kind: TargetKindSchema,
  value: z.string(),
  note: z.string(),
  tags: z.array(z.string()),
  activeHosts: z.number().int().nonnegative(),
  lastScanAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export const TargetListResponseSchema = z.object({ items: z.array(TargetSchema) });

const NoteSchema = z.string().max(500);
const TagsSchema = z.array(NonBlankStringSchema.max(50)).max(20);

export const CreateTargetBodySchema = z.object({
  // A domain name is at most 253 characters, longer than any IP or CIDR.
  value: NonBlankStringSchema.max(253),
  note: NoteSchema.optional(),
  tags: TagsSchema.optional(),
});

export const UpdateTargetBodySchema = z
  .object({
    note: NoteSchema.optional(),
    tags: TagsSchema.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Provide at least one field to update",
  });

export type TargetKind = z.infer<typeof TargetKindSchema>;
export type Target = z.infer<typeof TargetSchema>;
export type TargetListResponse = z.infer<typeof TargetListResponseSchema>;
export type CreateTargetBody = z.infer<typeof CreateTargetBodySchema>;
export type UpdateTargetBody = z.infer<typeof UpdateTargetBodySchema>;
