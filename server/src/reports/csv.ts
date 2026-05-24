/**
 * Tiny RFC-4180 CSV serialiser — string-escaping only, no streaming.
 */

export interface CsvColumn<T> {
  key: keyof T & string;
  label: string;
  format?: (value: T[keyof T], row: T) => string;
}

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  const str = String(value);
  if (/[,"\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCell(c.label)).join(",");
  const body = rows.map((row) =>
    columns
      .map((c) => {
        const raw = row[c.key];
        const formatted = c.format ? c.format(raw, row) : raw;
        return escapeCell(formatted);
      })
      .join(","),
  );
  return [header, ...body].join("\n") + "\n";
}
