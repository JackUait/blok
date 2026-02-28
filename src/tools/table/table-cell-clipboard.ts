import type { SanitizerConfig } from '../../../types/configs/sanitizer-config';
import type { ClipboardBlockData, TableCellsClipboard } from './types';
import { mapToNearestPresetColor } from '../../components/utils/color-mapping';
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
  color?: string;
  textColor?: string;
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
  const cells: TableCellsClipboard['cells'] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ blocks: [] as ClipboardBlockData[] }))
  );

  for (const entry of entries) {
    const r = entry.row - minRow;
    const c = entry.col - minCol;

    cells[r][c] = { blocks: entry.blocks };

    if (entry.color !== undefined) {
      cells[r][c].color = entry.color;
    }

    if (entry.textColor !== undefined) {
      cells[r][c].textColor = entry.textColor;
    }
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

          const styles = [
            cell.color ? `background-color: ${cell.color}` : '',
            cell.textColor ? `color: ${cell.textColor}` : '',
          ].filter(Boolean).join('; ');

          const styleAttr = styles ? ` style="${styles}"` : '';

          return `<td${styleAttr}>${text}</td>`;
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
 * CSS properties allowed on <mark> elements inside table cells.
 * Matches MarkerInlineTool.ALLOWED_STYLE_PROPS.
 */
const ALLOWED_MARK_STYLE_PROPS = new Set(['color', 'background-color']);

/**
 * Sanitizer config for cell content: allows bold, italic, line breaks, links,
 * and color markers (<mark> with color/background-color styles only).
 */
const CELL_SANITIZE_CONFIG: SanitizerConfig = {
  b: true,
  strong: true,
  i: true,
  em: true,
  br: true,
  a: { href: true },
  mark: (node: Element): { [attr: string]: boolean | string } => {
    const el = node as HTMLElement;
    const style = el.style;

    const props = Array.from({ length: style.length }, (_, i) => style.item(i));

    for (const prop of props) {
      if (!ALLOWED_MARK_STYLE_PROPS.has(prop)) {
        style.removeProperty(prop);
      }
    }

    return style.length > 0 ? { style: true } : {};
  },
};

/**
 * Check whether a CSS color value is the default black text color.
 * Google Docs uses different formats: `rgb(0, 0, 0)`, `rgb(0,0,0)`, or `#000000`.
 * Spans with only this color should not be converted to `<mark>`.
 */
export function isDefaultBlack(color: string): boolean {
  const normalized = color.replace(/\s/g, '');

  return normalized === 'rgb(0,0,0)' || normalized === '#000000';
}

/**
 * Extract HTML content from a `<td>`/`<th>` element, converting Google Docs
 * style-based spans to semantic tags and sanitizing to allowed formatting only.
 *
 * - `<span style="font-weight:700">` or `font-weight:bold` → `<b>`
 * - `<span style="font-style:italic">` → `<i>`
 * - `<span style="color:...">` → `<mark style="color: ...">`
 * - `<span style="background-color:...">` → `<mark style="background-color: ...">`
 * - `<p>` boundaries → `<br>` line breaks
 * - Everything else stripped except `<b>`, `<strong>`, `<i>`, `<em>`, `<br>`, `<a href>`, `<mark style>`
 */
function sanitizeCellHtml(td: Element): string {
  const clone = td.cloneNode(true) as HTMLElement;

  // Convert style-based spans to semantic tags
  for (const span of Array.from(clone.querySelectorAll('span'))) {
    const style = span.getAttribute('style') ?? '';
    const isBold = /font-weight\s*:\s*(700|bold)/i.test(style);
    const isItalic = /font-style\s*:\s*italic/i.test(style);

    const colorMatch = /(?<![a-z-])color\s*:\s*([^;]+)/i.exec(style);
    const bgMatch = /background-color\s*:\s*([^;]+)/i.exec(style);

    const color = colorMatch?.[1]?.trim();
    const bgColor = bgMatch?.[1]?.trim();

    const hasColor = color !== undefined && !isDefaultBlack(color);
    const hasBgColor = bgColor !== undefined && bgColor !== 'transparent';

    if (!isBold && !isItalic && !hasColor && !hasBgColor) {
      continue;
    }

    const mappedColor = hasColor ? mapToNearestPresetColor(color, 'text') : '';
    const mappedBg = hasBgColor ? mapToNearestPresetColor(bgColor, 'bg') : '';

    const colorStyles = [
      hasColor ? `color: ${mappedColor}` : '',
      hasBgColor ? `background-color: ${mappedBg}` : (hasColor ? 'background-color: transparent' : ''),
    ].filter(Boolean).join('; ');

    const inner = span.innerHTML;
    const marked = colorStyles
      ? `<mark style="${colorStyles};">${inner}</mark>`
      : inner;

    const italic = isItalic ? `<i>${marked}</i>` : marked;
    const wrapped = isBold ? `<b>${italic}</b>` : italic;

    span.replaceWith(document.createRange().createContextualFragment(wrapped));
  }

  // Move color/background-color from <a> tags into <mark> wrappers.
  // The sanitizer only allows href on <a>, so inline color styles would be lost.
  for (const anchor of Array.from(clone.querySelectorAll('a[style]'))) {
    const style = anchor.getAttribute('style') ?? '';

    const colorMatch = /(?<![a-z-])color\s*:\s*([^;]+)/i.exec(style);
    const bgMatch = /background-color\s*:\s*([^;]+)/i.exec(style);

    const color = colorMatch?.[1]?.trim();
    const bgColor = bgMatch?.[1]?.trim();

    const hasColor = color !== undefined && !isDefaultBlack(color) && color !== 'inherit';
    const hasBgColor = bgColor !== undefined && bgColor !== 'transparent' && bgColor !== 'inherit';

    if (!hasColor && !hasBgColor) {
      continue;
    }

    const mappedColor = hasColor ? mapToNearestPresetColor(color, 'text') : '';
    const mappedBg = hasBgColor ? mapToNearestPresetColor(bgColor, 'bg') : '';

    const colorStyles = [
      hasColor ? `color: ${mappedColor}` : '',
      hasBgColor ? `background-color: ${mappedBg}` : (hasColor ? 'background-color: transparent' : ''),
    ].filter(Boolean).join('; ');

    const el = anchor as HTMLElement;

    el.innerHTML = `<mark style="${colorStyles};">${el.innerHTML}</mark>`;
    el.style.removeProperty('color');
    el.style.removeProperty('background-color');
  }

  // Convert <p> boundaries to <br> line breaks
  for (const p of Array.from(clone.querySelectorAll('p'))) {
    const fragment = document.createRange().createContextualFragment(p.innerHTML + '<br>');

    p.replaceWith(fragment);
  }

  const html = clean(clone.innerHTML, CELL_SANITIZE_CONFIG)
    .replace(/(<br\s*\/?>|\s)+$/i, '')
    .trim();

  return html;
}

/**
 * Parse a generic HTML table (e.g. from Google Docs, Word, Excel) into a
 * {@link TableCellsClipboard} payload.
 *
 * Each `<td>`/`<th>` becomes one or more paragraph blocks (split by line breaks).
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

  type CellPayload = TableCellsClipboard['cells'][number][number];

  const cellGrid: CellPayload[][] = [];

  rows.forEach((row) => {
    const tds = row.querySelectorAll('td, th');
    const rowCells: CellPayload[] = [];

    tds.forEach((td) => {
      const text = sanitizeCellHtml(td);
      const segments = text.split(/<br\s*\/?>/i).map(s => s.trim()).filter(Boolean);
      const blocks = segments.length > 0
        ? segments.map(s => ({ tool: 'paragraph' as const, data: { text: s } }))
        : [{ tool: 'paragraph' as const, data: { text: '' } }];

      const cell: CellPayload = { blocks };

      // Extract cell-level colors from td/th style attribute
      const tdStyle = td.getAttribute('style') ?? '';
      const cellBgMatch = /background-color\s*:\s*([^;]+)/i.exec(tdStyle);

      if (cellBgMatch?.[1]) {
        cell.color = mapToNearestPresetColor(cellBgMatch[1].trim(), 'bg');
      }

      const cellTextColorMatch = /(?<![a-z-])color\s*:\s*([^;]+)/i.exec(tdStyle);

      if (cellTextColorMatch?.[1] && !isDefaultBlack(cellTextColorMatch[1].trim())) {
        cell.textColor = mapToNearestPresetColor(cellTextColorMatch[1].trim(), 'text');
      }

      rowCells.push(cell);
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
