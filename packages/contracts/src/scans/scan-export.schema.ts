import { z } from "zod";

import { TagsSchema } from "../common/common.schema";
import { HostSelectorSchema } from "../hosts/host-selectors";
import { AssetNoteSchema, ServiceOverrideSchema, TriageStatusSchema } from "../hosts/hosts.schema";
import { ObservedHostSchema } from "../workers/worker-result.schema";
import { PortSpecSchema, ScanHostCountsSchema, ScanStatusSchema } from "./scans.schema";

// The file `GET /scans/{id}/export` writes and `POST /scans/import` reads back
// (docs/scan-export-format.md).

export const SCAN_EXPORT_FORMAT = "subsurf-scan";
export const SCAN_EXPORT_VERSION = 1;

const CountSchema = z.number().int().nonnegative();

/** What a user set on a host. Keyed by address: ids do not survive an export. */
export const HostEditSchema = z.object({
  ip: z.ipv4(),
  triage: TriageStatusSchema,
  tags: TagsSchema,
  note: AssetNoteSchema,
});

export const ServiceEditSchema = HostEditSchema.extend({
  protocol: z.literal("tcp"),
  port: z.number().int().min(1).max(65535),
  nameOverride: ServiceOverrideSchema,
  productOverride: ServiceOverrideSchema,
  versionOverride: ServiceOverrideSchema,
});

/** Only hosts and services somebody edited are listed. */
export const ScanEditsSchema = z.object({
  hosts: z.array(HostEditSchema),
  services: z.array(ServiceEditSchema),
});

export const ScanExportDocumentSchema = z.object({
  format: z.literal(SCAN_EXPORT_FORMAT),
  version: z.literal(SCAN_EXPORT_VERSION),
  exportedAt: z.iso.datetime(),
  scan: z.object({
    id: z.uuid(),
    name: z.string(),
    status: ScanStatusSchema,
    /** Where the scan sits among the others: an import takes the same place. */
    createdAt: z.iso.datetime(),
    startedAt: z.iso.datetime().nullable(),
    finishedAt: z.iso.datetime().nullable(),
    ports: PortSpecSchema,
    /** `0`: not recorded. */
    maxRate: CountSchema,
    counts: ScanHostCountsSchema.extend({ addresses: CountSchema, openPorts: CountSchema }),
  }),
  /**
   * The addresses the scan got an answer or an error for. One inside these blocks without an
   * entry in `hosts` was scanned and is `down`.
   */
  coverage: z.array(HostSelectorSchema),
  /** Every address that is not `down`, in the worker result's host shape. */
  hosts: z.array(ObservedHostSchema),
  edits: ScanEditsSchema,
});

export const ScanExportQuerySchema = z.object({
  format: z.enum(["json", "csv"]).default("json"),
});

export type HostEdit = z.infer<typeof HostEditSchema>;
export type ServiceEdit = z.infer<typeof ServiceEditSchema>;
export type ScanEdits = z.infer<typeof ScanEditsSchema>;
export type ScanExportDocument = z.infer<typeof ScanExportDocumentSchema>;
export type ScanExportQuery = z.infer<typeof ScanExportQuerySchema>;
