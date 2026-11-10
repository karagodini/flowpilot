import type { Item, JsonObject } from '@flowpilot/shared';

export function parseCsv(text: string): Item[] {
  const rows = parseRows(text.replace(/^\uFEFF/, '').trim());
  if (rows.length === 0) return [];
  const headers = rows[0] ?? [];
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => cell.trim() !== ''))
    .map((row) => {
      const json: JsonObject = {};
      headers.forEach((header, index) => {
        const key = header.trim() || `column_${index + 1}`;
        json[key] = row[index] ?? '';
      });
      return { json };
    });
}

function parseRows(text: string): string[][] {
  if (!text) return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char ?? '';
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((entry) => !(entry.length === 1 && entry[0] === ''));
}

export function rowsToItems(rows: string[][]): Item[] {
  if (rows.length === 0) return [];
  const headers = (rows[0] ?? []).map((header) => header.trim());
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => cell.trim() !== ''))
    .map((row) => {
      const json: JsonObject = {};
      headers.forEach((header, index) => {
        json[header || `column_${index + 1}`] = row[index] ?? '';
      });
      return { json };
    });
}
