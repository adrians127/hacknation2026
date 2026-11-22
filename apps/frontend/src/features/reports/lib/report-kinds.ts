export const SCAN_REPORT_KINDS = ["summary", "findings", "technologies", "exposure", "triage", "tags"] as const;

export type ScanReportKind = (typeof SCAN_REPORT_KINDS)[number];

export const isScanReportKind = (value: string | undefined): value is ScanReportKind =>
  (SCAN_REPORT_KINDS as readonly (string | undefined)[]).includes(value);
