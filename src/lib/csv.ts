/**
 * Minimal, dependency-free CSV utilities for the employee import/export flow.
 *
 * - `toCSV` serialises rows to an RFC-4180-ish CSV string (quotes fields that
 *   contain commas, quotes, or newlines; escapes embedded quotes).
 * - `parseCSV` parses a CSV string into an array of objects keyed by the
 *   header row. Handles quoted fields, escaped quotes, and CRLF/LF newlines.
 */

export function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCSV(headers: string[], rows: Record<string, unknown>[]): string {
  const headerLine = headers.map(csvEscape).join(',');
  const dataLines = rows.map((row) => headers.map((h) => csvEscape(row[h])).join(','));
  return [headerLine, ...dataLines].join('\r\n');
}

/** Parse CSV text into a list of raw string records keyed by header. */
export function parseCSV(text: string): Record<string, string>[] {
  // Strip a UTF-8 BOM if present (Excel adds one).
  const clean = text.replace(/^\uFEFF/, '');
  const rows = tokenize(clean);
  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => h.trim());
  const records: Record<string, string>[] = [];

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    // Skip fully empty trailing lines.
    if (cells.length === 1 && cells[0].trim() === '') continue;
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      record[h] = (cells[idx] ?? '').trim();
    });
    records.push(record);
  }
  return records;
}

/** Tokenise CSV text into rows of cells, honouring quotes and newlines. */
function tokenize(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++; // skip the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c === '\r') {
      // handle CRLF: the \n will close the row; ignore the lone \r
      if (text[i + 1] === '\n') continue;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }

  // Flush the last field/row if the file doesn't end with a newline.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/** Trigger a browser download of `content` as a file named `filename`. */
export function downloadFile(filename: string, content: string, mime = 'text/csv;charset=utf-8;') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
