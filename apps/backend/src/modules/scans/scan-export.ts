import type { DetectionSummary } from "@subsurf/contracts/signatures/detection.schema";
import {
  SCAN_CSV_COLUMNS,
  SCAN_CSV_DERIVED_COLUMNS,
  scanCsvDownRow,
  scanCsvRows,
  type ScanCsvRow,
} from "@subsurf/contracts/scans/scan-csv";
import {
  SCAN_EXPORT_FORMAT,
  SCAN_EXPORT_VERSION,
  type ScanEdits,
  type ScanExportDocument,
} from "@subsurf/contracts/scans/scan-export.schema";

import { csvRow } from "~backend/lib/csv";
import { toObservedHost, toScanEdits } from "~backend/modules/scans/scan-results.mapper";
import type { ScanExport } from "~backend/modules/scans/scan-results.service";
import { signatureMatchesService } from "~backend/modules/signatures/signature-matches.service";

type DocumentHead = Omit<ScanExportDocument, "hosts" | "edits">;

function documentHead({ scan, counts, coverage }: ScanExport, exportedAt: Date): DocumentHead {
  const addresses = Object.values(counts.hosts).reduce((sum, count) => sum + count, 0);
  return {
    format: SCAN_EXPORT_FORMAT,
    version: SCAN_EXPORT_VERSION,
    exportedAt: exportedAt.toISOString(),
    scan: {
      id: scan.id,
      name: scan.name,
      status: scan.status,
      createdAt: scan.createdAt.toISOString(),
      startedAt: scan.startedAt?.toISOString() ?? null,
      finishedAt: scan.finishedAt?.toISOString() ?? null,
      ports: scan.ports,
      maxRate: scan.maxRate,
      counts: { ...counts.hosts, addresses, openPorts: counts.openPorts },
    },
    coverage,
  };
}

/**
 * The export document (`ScanExportDocumentSchema`) in pieces, one host per line, so a scan with
 * many page bodies is never held in memory whole. Written by hand for that reason.
 */
export async function* scanExportJson(source: ScanExport, exportedAt: Date): AsyncGenerator<string> {
  yield `${JSON.stringify(documentHead(source, exportedAt)).slice(0, -1)},"hosts":[`;
  const edits: ScanEdits = { hosts: [], services: [] };
  let separator = "\n";
  for await (const batch of source.batches()) {
    for (const { observation, host } of batch) {
      yield `${separator}${JSON.stringify(toObservedHost(observation))}`;
      separator = ",\n";
      const own = toScanEdits(observation, host);
      edits.hosts.push(...own.hosts);
      edits.services.push(...own.services);
    }
  }
  yield `\n],"edits":${JSON.stringify(edits)}}\n`;
}

const csvLine = (row: ScanCsvRow, detections: string | null = null) =>
  csvRow([...SCAN_CSV_COLUMNS.map((column) => row[column]), detections]);

const detectionText = (detections: readonly DetectionSummary[]) =>
  detections
    .map((detection) =>
      [detection.name, detection.version, detection.severity && `[${detection.severity}]`].filter(Boolean).join(" "),
    )
    .join("; ") || null;

/** The same hosts as CSV rows (`scan-csv.ts`); the covered blocks follow as `down` rows. */
export async function* scanExportCsv(source: ScanExport): AsyncGenerator<string> {
  yield csvRow([...SCAN_CSV_COLUMNS, ...SCAN_CSV_DERIVED_COLUMNS]);
  for await (const batch of source.batches()) {
    const detections = await signatureMatchesService.summaries(
      source.scan.id,
      batch.flatMap(({ observation }) => observation.ports.map((port) => port.serviceId)),
    );
    for (const { observation, host } of batch) {
      const byPort = new Map(
        observation.ports.map((port) => [port.port, detectionText(detections.get(port.serviceId) ?? [])]),
      );
      yield scanCsvRows(toObservedHost(observation), toScanEdits(observation, host))
        .map((row) => csvLine(row, typeof row.port === "number" ? (byPort.get(row.port) ?? null) : null))
        .join("");
    }
  }
  yield source.coverage.map((block) => csvLine(scanCsvDownRow(block))).join("");
}

/** `scan-2026-11-20-01-00.json`, by when the scan started (or was queued). */
export function scanExportFileName({ scan }: ScanExport, format: "json" | "csv"): string {
  const stamp = (scan.startedAt ?? scan.createdAt).toISOString().slice(0, 16).replaceAll(/[:T]/g, "-");
  return `scan-${stamp}.${format}`;
}
