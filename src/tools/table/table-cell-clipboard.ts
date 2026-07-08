import type { SanitizerConfig } from '../../../types/configs/sanitizer-config';
import type { CellPlacement, ClipboardBlockData, TableCellsClipboard, TableClipboardCell } from './types';
import { mapPastedTableCells } from './table-operations';
import { mapToNearestPresetColor } from '../../components/utils/color-mapping';
import { isDefaultDarkBackground, isDefaultWhiteBackground } from '../../components/modules/paste/google-docs-preprocessor';
import { clean } from '../../components/utils/sanitizer';

/** Attribute name used to embed clipboard data on the HTML table element. */
const DATA_ATTR = 'data-blok-table-cells';

/**
 * Resolve the background-color style value for clipboard markup.
 * When the cell has an explicit background, use it; when it only has a text
 * color, force a transparent background so the mark element doesn't inherit
 * an unwanted default; otherwise return an empty string (no style needed).
 */
function resolveBackgroundStyle(hasBgColor: boolean, hasColor: boolean, mappedBg: string): string {
  if (hasBgColor) {
    return `background-color: ${mappedBg}`;
  }

  if (hasColor) {
    return 'background-color: transparent';
  }

  return '';
}

/**
 * Entry describing one cell to be serialized for the clipboard.
 */
interface CellEntry {
  row: number;
  col: number;
  blocks: ClipboardBlockData[];
  color?: string;
  textColor?: string;
  placement?: CellPlacement;
  /** Columns spanned when the cell is a merge origin (default 1). */
  colspan?: number;
  /** Rows spanned when the cell is a merge origin (default 1). */
  rowspan?: number;
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

  // Merge origins extend the payload by their span: a fully merged region
  // contributes a single physical entry but covers span-many positions.
  const maxRow = Math.max(...entries.map((e) => e.row + (e.rowspan ?? 1) - 1));
  const maxCol = Math.max(...entries.map((e) => e.col + (e.colspan ?? 1) - 1));

  const rows = maxRow - minRow + 1;
  const cols = maxCol - minCol + 1;

  // Pre-fill positions as "covered": any position without a physical cell
  // entry is a merge-covered coordinate, NOT an empty cell. Flagging it lets
  // paste skip it instead of wiping the destination cell. Real entries below
  // overwrite this with an un-flagged cell.
  const cells: TableCellsClipboard['cells'] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ blocks: [] as ClipboardBlockData[], covered: true }))
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

    if (entry.placement !== undefined) {
      cells[r][c].placement = entry.placement;
    }

    if ((entry.colspan ?? 1) > 1) {
      cells[r][c].colspan = entry.colspan;
    }

    if ((entry.rowspan ?? 1) > 1) {
      cells[r][c].rowspan = entry.rowspan;
    }
  }

  return { rows, cols, cells };
}

/**
 * Extract the raw HTML content from a single block's data.
 *
 * Looks for `data.text` (string), then `data.items` (array of strings),
 * and falls back to an empty string.
 */
function extractBlockHtml(block: ClipboardBlockData): string {
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
 * Strip HTML tags from a string, returning only the visible text content.
 */
function stripHtmlTags(html: string): string {
  const div = document.createElement('div');

  div.innerHTML = html;

  return div.textContent ?? '';
}

/**
 * Extract a plain-text representation from a single block's data.
 * HTML tags are stripped so only visible text remains.
 */
function extractBlockPlainText(block: ClipboardBlockData): string {
  return stripHtmlTags(extractBlockHtml(block));
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
          const text = cell.blocks.map(extractBlockHtml).join(' ');

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
      row.map((cell) => cell.blocks.map(extractBlockPlainText).join(' ')).join('\t')
    )
    .join('\n');
}

/**
 * CSS properties allowed on <mark> elements inside table cells.
 * Matches MarkerInlineTool.ALLOWED_STYLE_PROPS.
 */
export const ALLOWED_MARK_STYLE_PROPS = new Set(['color', 'background-color']);

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
  a: { href: true, target: '_blank', rel: 'nofollow' },
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
 * Whether an element's text is entirely a link's text. Pasted links always use
 * Blok's default link color, so any color on link text is dropped. True when the
 * node is inside an `<a>` or wraps an `<a>` covering all of its text; a span that
 * only partially overlaps a link keeps its color (intentional text formatting).
 */
function isLinkContent(node: Element): boolean {
  if (node.closest('a') !== null) {
    return true;
  }

  const anchor = node.querySelector('a');

  return anchor !== null && anchor.textContent?.trim() === node.textContent?.trim();
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

    const isLinkColor = color !== undefined && isLinkContent(span);
    const hasColor = !isLinkColor && color !== undefined && !isDefaultBlack(color);
    // Filter resolved page bg (white/dark) so plain spans don't collapse onto gray preset.
    const hasBgColor = bgColor !== undefined
      && bgColor !== 'transparent'
      && !isDefaultWhiteBackground(bgColor)
      && !isDefaultDarkBackground(bgColor);

    if (!isBold && !isItalic && !hasColor && !hasBgColor) {
      continue;
    }

    const mappedColor = hasColor ? mapToNearestPresetColor(color, 'text') : '';
    const mappedBg = hasBgColor ? mapToNearestPresetColor(bgColor, 'bg') : '';

    const colorStyles = [
      hasColor ? `color: ${mappedColor}` : '',
      resolveBackgroundStyle(hasBgColor, hasColor, mappedBg),
    ].filter(Boolean).join('; ');

    const inner = span.innerHTML;
    const marked = colorStyles
      ? `<mark style="${colorStyles};">${inner}</mark>`
      : inner;

    const italic = isItalic ? `<i>${marked}</i>` : marked;
    const wrapped = isBold ? `<b>${italic}</b>` : italic;

    span.replaceWith(document.createRange().createContextualFragment(wrapped));
  }

  // Move background-color from <a> tags into <mark> wrappers.
  // The sanitizer only allows href on <a>, so an inline background would be lost.
  // A color on the <a> is the link's own color and is dropped: pasted links
  // always use Blok's default link color.
  for (const anchor of Array.from(clone.querySelectorAll('a[style]'))) {
    const style = anchor.getAttribute('style') ?? '';

    const bgMatch = /background-color\s*:\s*([^;]+)/i.exec(style);
    const bgColor = bgMatch?.[1]?.trim();

    const hasBgColor = bgColor !== undefined
      && bgColor !== 'transparent'
      && bgColor !== 'inherit'
      && !isDefaultWhiteBackground(bgColor)
      && !isDefaultDarkBackground(bgColor);

    const el = anchor as HTMLElement;

    el.style.removeProperty('color');

    if (!hasBgColor) {
      continue;
    }

    const mappedBg = mapToNearestPresetColor(bgColor, 'bg');

    el.innerHTML = `<mark style="background-color: ${mappedBg};">${el.innerHTML}</mark>`;
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

  // Walk the rows with the shared occupancy model so colspan/rowspan place
  // every cell at its correct LOGICAL column and merges survive as
  // spans + covered flags (same fix as the top-level table paste).
  const cellGrid = mapPastedTableCells<TableClipboardCell>(rows, {
    cell: (td, { colspan, rowspan }) => ({
      ...buildCellPayloadFromTd(td),
      ...(colspan > 1 ? { colspan } : {}),
      ...(rowspan > 1 ? { rowspan } : {}),
    }),
    covered: () => ({ blocks: [], covered: true }),
    filler: () => ({ blocks: [{ tool: 'paragraph', data: { text: '' } }] }),
  });

  const maxCols = cellGrid[0]?.length ?? 0;

  if (cellGrid.length === 0 || maxCols === 0) {
    return null;
  }

  return {
    rows: cellGrid.length,
    cols: maxCols,
    cells: cellGrid,
  };
}

/**
 * Build a clipboard cell payload from a single `<td>`/`<th>`: sanitized
 * paragraph blocks (split on line breaks) plus cell-level colors.
 */
function buildCellPayloadFromTd(td: Element): TableClipboardCell {
  const text = sanitizeCellHtml(td);
  const segments = text.split(/<br\s*\/?>/i).map(s => s.trim()).filter(Boolean);
  const blocks = segments.length > 0
    ? segments.map(s => ({ tool: 'paragraph' as const, data: { text: s } }))
    : [{ tool: 'paragraph' as const, data: { text: '' } }];

  const cell: TableClipboardCell = { blocks };

  // Extract cell-level colors from td/th style attribute
  const tdStyle = td.getAttribute('style') ?? '';
  const cellBgMatch = /background-color\s*:\s*([^;]+)/i.exec(tdStyle);

  if (cellBgMatch?.[1]) {
    const cellBg = cellBgMatch[1].trim();

    // Skip resolved page bg (white/dark) so plain cells don't collapse onto gray preset.
    if (!isDefaultWhiteBackground(cellBg) && !isDefaultDarkBackground(cellBg)) {
      cell.color = mapToNearestPresetColor(cellBg, 'bg');
    }
  }

  const cellTextColorMatch = /(?<![a-z-])color\s*:\s*([^;]+)/i.exec(tdStyle);

  if (cellTextColorMatch?.[1] && !isDefaultBlack(cellTextColorMatch[1].trim())) {
    cell.textColor = mapToNearestPresetColor(cellTextColorMatch[1].trim(), 'text');
  }

  return cell;
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

    // Browsers re-serialize clipboard HTML, encoding special characters inside
    // attribute values as HTML entities. Decode them back before JSON.parse.
    // Order matters: &amp; must be last to avoid double-decoding (e.g. &amp;lt; → &lt; → <).
    const jsonStr = raw
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');

    const payload = JSON.parse(jsonStr) as TableCellsClipboard;

    return sanitizeClipboardPayload(payload);
  } catch {
    return null;
  }
}

/**
 * Sanitize every cell block's `data.text` in a parsed clipboard payload.
 *
 * The `data-blok-table-cells` fast path bypasses the generic-table sanitizer,
 * so untrusted clipboard markup could otherwise reach the DOM verbatim. Run
 * each string `data.text` through {@link clean} with {@link CELL_SANITIZE_CONFIG}
 * to neutralize XSS while preserving allowed inline formatting.
 */
function sanitizeClipboardPayload(payload: TableCellsClipboard): TableCellsClipboard {
  const blocks = payload.cells.flatMap(row => row.flatMap(cell => cell.blocks));

  for (const block of blocks) {
    if (typeof block.data.text === 'string') {
      block.data.text = clean(block.data.text, CELL_SANITIZE_CONFIG);
    }
  }

  return payload;
}
