import { z } from "zod";

import { ScanImportFormatSchema, ScanImportIssueSchema, SCAN_IMPORT_LIMITS } from "./scan-import";
import { ScanHostCountsSchema } from "./scans.schema";

const CountSchema = z.number().int().nonnegative();

export const ImportScanQuerySchema = z.object({
  /**
   * `fill` also applies the notes, tags, triage and service corrections the file carries, where
   * the host or service has none yet (requires `hosts:update`).
   */
  edits: z.enum(["skip", "fill"]).default("skip"),
  /** Shown in the scan list, usually the file's name. */
  name: z.string().max(200).optional(),
});

/** How the file's edits met the ones already in the system. */
export const ImportedEditsSchema = z.object({
  /** Hosts and services that got at least one value from the file. */
  applied: CountSchema,
  /** Already had everything the file offered. */
  kept: CountSchema,
  /** Named by the file but not part of the scan. */
  missing: CountSchema,
});

export const ImportScanResponseSchema = z.object({
  scanId: z.uuid(),
  /** Where the scan was placed among the others: when the file says it ran. */
  placedAt: z.iso.datetime(),
  inputFormat: ScanImportFormatSchema,
  jobs: CountSchema,
  hosts: ScanHostCountsSchema,
  openPorts: CountSchema,
  /** `null` unless `edits=fill`. */
  edits: ImportedEditsSchema.nullable(),
  warnings: z.array(ScanImportIssueSchema).max(SCAN_IMPORT_LIMITS.maxReportedIssues),
  /** All of them, including the ones `warnings` leaves out. */
  warningCount: CountSchema,
});

/** `error.details` of `SCAN_ALREADY_IMPORTED`: the scan the same file became before. */
export const ScanAlreadyImportedDetailsSchema = z.object({ scanId: z.uuid() });

export type ImportScanQuery = z.infer<typeof ImportScanQuerySchema>;
export type ScanAlreadyImportedDetails = z.infer<typeof ScanAlreadyImportedDetailsSchema>;
export type ImportedEdits = z.infer<typeof ImportedEditsSchema>;
export type ImportScanResponse = z.infer<typeof ImportScanResponseSchema>;
