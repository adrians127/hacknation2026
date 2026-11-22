import type { DetectionSummary, SignatureSeverity } from "@subsurf/contracts/signatures/detection.schema";
import type { FieldChange } from "@subsurf/contracts/scans/scan-results.schema";

export interface DetectionChange extends FieldChange {
  /** The signature's severity, which rates the change. */
  severity: SignatureSeverity | null;
}

const shown = (detection: DetectionSummary) => detection.version ?? "detected";

/**
 * Signatures that started or stopped matching a service between two scans, or read another
 * version. `findingsOnly` keeps signatures with a severity (a new service's technologies are noise).
 */
export function detectionChanges(
  before: readonly DetectionSummary[],
  after: readonly DetectionSummary[],
  findingsOnly = false,
): DetectionChange[] {
  const was = new Map(before.map((detection) => [detection.signatureId, detection]));
  const now = new Map(after.map((detection) => [detection.signatureId, detection]));
  const row = (detection: DetectionSummary, from: string | null, to: string | null): DetectionChange => ({
    field: "detection",
    endpoint: null,
    key: detection.name,
    before: from,
    after: to,
    severity: detection.severity,
  });
  const changes = [
    ...after.flatMap((detection) => {
      const old = was.get(detection.signatureId);
      if (!old) return [row(detection, null, shown(detection))];
      return old.version !== null && detection.version !== null && old.version !== detection.version
        ? [row(detection, old.version, detection.version)]
        : [];
    }),
    ...before.filter((detection) => !now.has(detection.signatureId)).map((detection) => row(detection, shown(detection), null)),
  ];
  return findingsOnly ? changes.filter((change) => change.severity !== null) : changes;
}
