export type CsvValue = string | number | boolean | null | undefined;

export interface CsvTable {
  columns: readonly string[];
  rows: readonly (readonly CsvValue[])[];
}

// Spreadsheets run a cell starting with these as a formula (CSV injection).
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\n\r;]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(table: CsvTable): string {
  return [table.columns, ...table.rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function downloadFile(name: string, content: string, type: string): void {
  // A BOM so Excel reads UTF-8 (Polish characters in hostnames and notes).
  const blob = new Blob([type.startsWith("text/csv") ? `﻿${content}` : content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** `subsurf-findings-2026-11-21` */
export function reportFileName(kind: string, date: string | null | undefined): string {
  return ["subsurf", kind, date?.slice(0, 10)].filter(Boolean).join("-");
}

export const joinList = (values: readonly (string | number)[]): string => values.join(" ");
