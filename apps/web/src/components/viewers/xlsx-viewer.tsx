'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiBlob } from '@/lib/api';

interface Sheet {
  name: string;
  rows: string[][];
  columns: number;
  truncated: boolean;
}

const MAX_ROWS = 2000;
const MAX_COLS = 60;

function columnName(i: number) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toLocaleDateString();
  if (typeof value === 'object') {
    const v = value as { text?: string; result?: unknown; richText?: { text: string }[]; hyperlink?: string; error?: string };
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if (v.result !== undefined) return cellText(v.result);
    if (v.text) return v.text;
    if (v.error) return v.error;
    return '';
  }
  return String(value);
}

/** Read-only spreadsheet viewer (exceljs): sheet tabs, sticky row/column headers, computed values. */
export function XlsxViewer({ fileUrl }: { fileUrl: string }) {
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ default: ExcelJS }, blob] = await Promise.all([import('exceljs'), apiBlob(fileUrl)]);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await blob.arrayBuffer());
      const out: Sheet[] = wb.worksheets.map((ws) => {
        const rows: string[][] = [];
        const columns = Math.min(ws.actualColumnCount || ws.columnCount, MAX_COLS);
        ws.eachRow({ includeEmpty: true }, (row, n) => {
          if (n > MAX_ROWS) return;
          const cells: string[] = [];
          for (let c = 1; c <= columns; c++) cells.push(cellText(row.getCell(c).value));
          rows[n - 1] = cells;
        });
        for (let i = 0; i < rows.length; i++) rows[i] ??= Array(columns).fill('');
        return { name: ws.name, rows, columns, truncated: ws.rowCount > MAX_ROWS || ws.columnCount > MAX_COLS };
      });
      if (!cancelled) setSheets(out);
    })().catch((err) => !cancelled && setError(err.message ?? 'Could not open spreadsheet'));
    return () => {
      cancelled = true;
    };
  }, [fileUrl]);

  const sheet = sheets?.[active];
  const headers = useMemo(() => Array.from({ length: sheet?.columns ?? 0 }, (_, i) => columnName(i)), [sheet]);

  if (error) {
    return <p className="p-6 text-center text-danger">{error}. Older .xls files aren&apos;t supported in the viewer — download to open them.</p>;
  }
  if (!sheets) return <div className="m-4 h-64 animate-pulse rounded-xl bg-surface-2" />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto bg-surface">
        <table className="border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 min-w-10 border-b border-r border-line bg-surface-2" />
              {headers.map((h) => (
                <th key={h} className="sticky top-0 z-10 min-w-24 border-b border-r border-line bg-surface-2 px-2 py-1 text-center text-meta font-semibold text-ink-3">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet!.rows.map((row, r) => (
              <tr key={r}>
                <th className="sticky left-0 z-10 border-b border-r border-line bg-surface-2 px-2 py-1 text-right text-meta font-semibold text-ink-3">{r + 1}</th>
                {row.map((cell, c) => (
                  <td key={c} className={`max-w-80 truncate border-b border-r border-line px-2 py-1 ${/^-?[\d.,]+%?$/.test(cell) ? 'text-right tabular-nums' : ''}`} title={cell}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {sheet!.truncated && <p className="p-3 text-meta text-ink-3">Showing the first {MAX_ROWS} rows and {MAX_COLS} columns. Download for the full file.</p>}
      </div>
      {sheets.length > 1 && (
        <div className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto border-t border-line bg-surface-2 p-1.5">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              onClick={() => setActive(i)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium ${i === active ? 'bg-surface text-[#217346] shadow-card' : 'text-ink-2 hover:bg-surface/60'}`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
