import type { ClipboardBlockData, TableCellsClipboard } from './types';
import { clean } from '../../components/utils/sanitizer';

/** Attribute name used to embed clipboard data on the HTML table element. */
const DATA_ATTR = 'data-blok-table-cells';

/**
 * Entry describing one cell to be serialized for the clipboard.
 */
interface CellEntry {
  row: number;
  col: number;
  blocks: ClipboardBlockData[];
}

/**
 * Build a {@link TableCellsClipboard} payload from a flat list of cell entries.
 *
 * Row/col indices are normalized so the minimum becomes 0.
 * Empty input produces `{ rows: 0, cols: 0, cells: [] }`.
 */
export function serializeCellsToClipboard(entries: CellEntry[]): TableCellsClipboard {
  if (entries.length === 0) {
    return { rows: 0, cols: 0, cells: [] };
  }

  const minRow = Math.min(...entries.map((e) => e.row));
  const minCol = Math.min(...entries.map((e) => e.col));

  const maxRow = Math.max(...entries.map((e) => e.row));
  const maxCol = Math.max(...entries.map((e) => e.col));

  const rows = maxRow - minRow + 1;
  const cols = maxCol - minCol + 1;

  // Pre-fill with empty cells
  const cells: Array<Array<{ blocks: ClipboardBlockData[] }>> = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ blocks: [] }))
  );

  for (const entry of entries) {
    const r = entry.row - minRow;
    const c = entry.col - minCol;

    cells[r][c] = { blocks: entry.blocks };
  }

  return { rows, cols, cells };
}

/**
 * Extract a plain-text representation from a single block's data.
 *
 * Looks for `data.text` (string), then `data.items` (array of strings),
 * and falls back to an empty string.
 */
function extractBlockText(block: ClipboardBlockData): string {
  const { data } = block;

  if (typeof data.text === 'string') {
    return data.text;
  }

  if (Array.isArray(data.items)) {
    return (data.items as unknown[])
      .filter((item): item is string => typeof item === 'string')
      .join(' ');
  }

  return '';
}

/**
 * Build an HTML `<table>` string that carries the clipboard payload in a
 * `data-blok-table-cells` attribute.
 *
 * External apps receive a clean HTML table, while Blok's paste handler can
 * detect and extract the structured JSON.
 */
export function buildClipboardHtml(payload: TableCellsClipboard): string {
  // Use single-quoted attribute so JSON double quotes don't break the HTML.
  // Escape any literal single quotes inside the JSON with &#39;.
  const json = JSON.stringify(payload).replace(/'/g, '&#39;');

  const rowsHtml = payload.cells
    .map((row) => {
      const cellsHtml = row
        .map((cell) => {
          const text = cell.blocks.map(extractBlockText).join(' ');

          return `<td>${text}</td>`;
        })
        .join('');

      return `<tr>${cellsHtml}</tr>`;
    })
    .join('');

  return `<table ${DATA_ATTR}='${json}'>${rowsHtml}</table>`;
}

/**
 * Build a plain-text representation of the clipboard payload.
 *
 * Cells are separated by tabs (`\t`), rows by newlines (`\n`).
 * Multiple blocks within a cell are joined with spaces.
 */
export function buildClipboardPlainText(payload: TableCellsClipboard): string {
  return payload.cells
    .map((row) =>
      row.map((cell) => cell.blocks.map(extractBlockText).join(' ')).join('\t')
    )
    .join('\n');
}

/**
 * Sanitizer config for cell content: allows bold, italic, line breaks, and links.
 */
const CELL_SANITIZE_CONFIG = {
  b: true,
  i: true,
  br: true,
  a: { href: true },
} as const;

/**
 * Extract HTML content from a `<td>`/`<th>` element, converting Google Docs
 * style-based spans to semantic tags and sanitizing to allowed formatting only.
 *
 * - `<span style="font-weight:700">` or `font-weight:bold` → `<b>`
 * - `<span style="font-style:italic">` → `<i>`
 * - `<p>` boundaries → `<br>` line breaks
 * - Everything else stripped except `<b>`, `<i>`, `<br>`, `<a href>`
 */
function sanitizeCellHtml(td: Element): string {
  const clone = td.cloneNode(true) as HTMLElement;

  // Convert style-based spans to semantic tags
  clone.querySelectorAll('span').forEach((span) => {
    const style = span.getAttribute('style') ?? '';
    const isBold = /font-weight\s*:\s*(700|bold)/i.test(style);
    const isItalic = /font-style\s*:\s*italic/i.test(style);

    if (isBold || isItalic) {
      let wrapped = span.innerHTML;

      if (isItalic) {
        wrapped = `<i>${wrapped}</i>`;
      }
      if (isBold) {
        wrapped = `<b>${wrapped}</b>`;
      }
      span.outerHTML = wrapped;
    }
  });

  // Convert <p> boundaries to <br> line breaks
  clone.querySelectorAll('p').forEach((p) => {
    p.outerHTML = p.innerHTML + '<br>';
  });

  let html = clean(clone.innerHTML, CELL_SANITIZE_CONFIG);

  // Trim trailing <br> tags and whitespace
  html = html.replace(/(<br\s*\/?>|\s)+$/i, '');

  return html.trim();
}

/**
 * Parse a generic HTML table (e.g. from Google Docs, Word, Excel) into a
 * {@link TableCellsClipboard} payload.
 *
 * Each `<td>`/`<th>` becomes a single paragraph block with the cell's text
 * content.  Returns `null` when the HTML does not contain a `<table>`, when
 * the table has no rows, or when the table already carries our custom
 * `data-blok-table-cells` attribute (those should be handled by
 * {@link parseClipboardHtml} instead).
 */
export function parseGenericHtmlTable(html: string): TableCellsClipboard | null {
  if (!html) {
    return null;
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');

  if (!table) {
    return null;
  }

  // Defer to parseClipboardHtml for our own format
  if (table.hasAttribute(DATA_ATTR)) {
    return null;
  }

  const rows = table.querySelectorAll('tr');

  if (rows.length === 0) {
    return null;
  }

  const cellGrid: Array<Array<{ blocks: ClipboardBlockData[] }>> = [];

  rows.forEach((row) => {
    const tds = row.querySelectorAll('td, th');
    const rowCells: Array<{ blocks: ClipboardBlockData[] }> = [];

    tds.forEach((td) => {
      const text = sanitizeCellHtml(td);

      rowCells.push({
        blocks: [{ tool: 'paragraph', data: { text } }],
      });
    });

    cellGrid.push(rowCells);
  });

  const maxCols = Math.max(0, ...cellGrid.map((row) => row.length));

  if (cellGrid.length === 0 || maxCols === 0) {
    return null;
  }

  // Normalize: ensure all rows have the same number of columns
  for (const row of cellGrid) {
    while (row.length < maxCols) {
      row.push({ blocks: [{ tool: 'paragraph', data: { text: '' } }] });
    }
  }

  return {
    rows: cellGrid.length,
    cols: maxCols,
    cells: cellGrid,
  };
}

/**
 * Attempt to parse a {@link TableCellsClipboard} from an HTML string.
 *
 * Returns `null` if the HTML does not contain a `<table>` with the expected
 * data attribute, or if the JSON within is invalid.
 */
export function parseClipboardHtml(html: string): TableCellsClipboard | null {
  // Match both single-quoted and double-quoted attribute values
  const pattern = new RegExp(`${DATA_ATTR}='([^']*)'|${DATA_ATTR}="([^"]*)"`, 's');
  const match = pattern.exec(html);

  if (!match) {
    return null;
  }

  try {
    // Group 1 = single-quoted value, group 2 = double-quoted value
    const raw = match[1] ?? match[2];

    if (raw === undefined) {
      return null;
    }

    const jsonStr = raw.replace(/&#39;/g, "'").replace(/&quot;/g, '"');

    return JSON.parse(jsonStr) as TableCellsClipboard;
  } catch {
    return null;
  }
}
