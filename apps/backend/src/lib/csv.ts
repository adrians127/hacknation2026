// Spreadsheets run a cell that starts with one of these as a formula (CSV injection).
const FORMULA_START = /^[=+\-@\t\r]/;

/** One RFC 4180 cell; formula-like text gets a leading `'`. `null` is an empty cell. */
export function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = FORMULA_START.test(String(value)) ? `'${value}` : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** One line, with its line ending. */
export function csvRow(cells: readonly (string | number | null)[]): string {
  return `${cells.map(csvCell).join(",")}\r\n`;
}

export function toCsv(
  header: readonly string[],
  rows: readonly (readonly (string | number | null)[])[],
): string {
  return [header, ...rows].map(csvRow).join("");
}
