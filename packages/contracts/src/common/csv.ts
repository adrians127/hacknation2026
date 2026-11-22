const DELIMITERS = [",", ";", "\t"] as const;

/** The delimiter the first line uses most outside quotes; a comma when it has none. */
function detectDelimiter(text: string): string {
  const counts = new Map<string, number>(DELIMITERS.map((delimiter) => [delimiter, 0]));
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === "\n" || char === "\r")) break;
    else if (!quoted && counts.has(char)) counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  return DELIMITERS.toSorted((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))[0];
}

/**
 * RFC 4180 rows of cells: quoted cells may hold delimiters, line breaks and doubled quotes.
 * Accepts `,`, `;` or a tab as the delimiter (whichever the first line uses), CRLF or LF, and a
 * BOM. Lines without any content are skipped.
 */
export function parseCsv(text: string): string[][] {
  const input = text.startsWith("﻿") ? text.slice(1) : text;
  const delimiter = detectDelimiter(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const endRow = () => {
    row.push(cell);
    if (row.some((value) => value !== "")) rows.push(row);
    row = [];
    cell = "";
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char !== '"') cell += char;
      else if (input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = false;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") endRow();
    else if (char !== "\r") cell += char;
  }
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}
