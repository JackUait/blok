import type { PreviewKind } from './preview';
import type { FilePreviewOptions } from './preview-modal';
import { loadBinaryPreview } from './binary-preview';
import { ZipParts } from './zip-parts';
import { loadDocxRenderer, loadPptxRenderer } from './office-loaders';
import { buildErrorInto } from './preview-error';
import { openDeckStage } from './deck-stage';
import { mountPager } from './page-pager';
import { detachedChrome, type PreviewChrome } from './preview-chrome';
import { mountSheetGrid, type GridCell, type GridSheet } from './sheet-grid';
import { formatNumber, readStyles, type CellStyle } from './xlsx-format';

export type OfficeKind = Extract<PreviewKind, 'docx' | 'xlsx' | 'pptx'>;

const OFFICE_KINDS = new Set<OfficeKind>(['docx', 'xlsx', 'pptx']);

/** Narrow a PreviewKind to an OfficeKind. */
export function isOfficeKind(kind: PreviewKind | null): kind is OfficeKind {
  return kind !== null && OFFICE_KINDS.has(kind as OfficeKind);
}

const COLUMN_LETTERS = /^([A-Z]+)/;
/** Excel's last column, XFD. */
const MAX_COLUMNS = 16_384;
/** Most cells one workbook preview draws; later rows are left out. */
const MAX_CELLS = 50_000;

/** 1-based numbers 1..n. */
function range(n: number): number[] {
  return Array.from({ length: Math.max(0, n) }, (_, i) => i + 1);
}

/** The numeric suffix of an `xl/worksheets/sheetN.xml` path, for ordering. */
function sheetNumber(path: string): number {
  return Number(/sheet(\d+)\.xml$/.exec(path)?.[1] ?? '0');
}

/** Convert an A1-style cell ref's column letters to a 1-based column index. */
function columnIndex(ref: string): number {
  const letters = COLUMN_LETTERS.exec(ref)?.[1] ?? '';

  return Math.min(MAX_COLUMNS, Array.from(letters).reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0));
}

/** Resolve a `<c>` cell's display text: shared-string, inline string, or value. */
function cellText(cell: Element, shared: string[]): string {
  const type = cell.getAttribute('t');
  if (type === 's') {
    const index = Number(cell.getElementsByTagName('v')[0]?.textContent ?? '');

    return shared[index] ?? '';
  }
  if (type === 'inlineStr') {
    return Array.from(cell.getElementsByTagName('t')).map((t) => t.textContent ?? '').join('');
  }

  return cell.getElementsByTagName('v')[0]?.textContent ?? '';
}

/** Direct children with a tag name. Descendant lookups would let nested markup repeat content. */
function childrenNamed(el: Element, name: string): Element[] {
  return Array.from(el.children).filter((child) => child.tagName === name);
}

/** A shared string: its own `<t>`, or the `<t>` of each run. Phonetic hints (`rPh`) are not shown. */
function sharedString(si: Element): string {
  const runs = [si, ...childrenNamed(si, 'r')].flatMap((el) => childrenNamed(el, 't'));

  return runs.map((t) => t.textContent ?? '').join('');
}

/** Whether a cell holds a real number (so it can be right-aligned like a sheet). */
function isNumericCell(cell: Element, text: string): boolean {
  const type = cell.getAttribute('t');
  if (type === 's' || type === 'inlineStr' || type === 'str') {
    return false;
  }

  return text.trim() !== '' && Number.isFinite(Number(text));
}

const EMPTY_CELL: GridCell = { text: '', value: null };

/** One `<c>` as a grid cell: a number is shown the way its style's format asks. */
function readCell(cell: Element, shared: string[], styles: CellStyle[]): GridCell {
  const text = cellText(cell, shared);
  const style = styles[Number(cell.getAttribute('s') ?? '-1')];
  const bold = style?.bold ? { bold: true } : {};
  if (!isNumericCell(cell, text)) {
    return { text, value: null, ...bold };
  }
  const value = Number(text);

  return { text: style === undefined ? text : formatNumber(value, style.code), value, ...bold };
}

/** The cells of a `<row>`, each at its A1 column, gaps filled with empty cells. */
function readRow(rowEl: Element, shared: string[], styles: CellStyle[]): GridCell[] {
  const cells = childrenNamed(rowEl, 'c');
  const byColumn = new Map<number, GridCell>();
  cells.forEach((cell, i) => {
    const ref = cell.getAttribute('r');
    byColumn.set(ref === null ? i + 1 : columnIndex(ref), readCell(cell, shared, styles));
  });
  const lastColumn = cells.reduce((max, cell) => {
    const ref = cell.getAttribute('r');

    return ref === null ? max : Math.max(max, columnIndex(ref));
  }, cells.length);

  return range(lastColumn).map((col) => byColumn.get(col) ?? EMPTY_CELL);
}

/** The rows of one worksheet document, with at most `cellsLeft` cells; later rows are left out. */
function readRows(doc: Document, shared: string[], styles: CellStyle[], cellsLeft: number): GridCell[][] {
  const sheetData = childrenNamed(doc.documentElement, 'sheetData')[0];
  const rows: GridCell[][] = [];
  const used = { cells: 0 };
  for (const rowEl of sheetData === undefined ? [] : childrenNamed(sheetData, 'row')) {
    const row = readRow(rowEl, shared, styles);
    if (used.cells + row.length > cellsLeft) {
      break;
    }
    used.cells += row.length;
    rows.push(row);
  }

  return rows;
}

const REL_ID_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Worksheet part path → the tab name the workbook gives it. */
async function readSheetNames(parts: ZipParts): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const workbook = await parts.optionalXml('xl/workbook.xml');
  const rels = await parts.optionalXml('xl/_rels/workbook.xml.rels');
  if (workbook === null || rels === null) {
    return names;
  }
  const targets = new Map(childrenNamed(rels.documentElement, 'Relationship').map((rel) => {
    const target = rel.getAttribute('Target') ?? '';

    return [rel.getAttribute('Id') ?? '', target.startsWith('/') ? target.slice(1) : `xl/${target}`] as const;
  }));
  for (const sheet of childrenNamed(childrenNamed(workbook.documentElement, 'sheets')[0], 'sheet')) {
    const target = targets.get(sheet.getAttributeNS(REL_ID_NS, 'id') ?? sheet.getAttribute('r:id') ?? '');
    const name = sheet.getAttribute('name');
    if (target !== undefined && name !== null) {
      names.set(target, name);
    }
  }

  return names;
}

/**
 * Read an .xlsx into sheets of cells by parsing the OOXML zip directly
 * (in-house zip reader + DOMParser). Cells are placed at their A1 column so
 * sparse rows stay aligned. Parts are read through the same guards as the docx
 * renderer: inflate limits, no DOCTYPE.
 */
export async function readWorkbook(buf: ArrayBuffer): Promise<GridSheet[]> {
  const parts = await ZipParts.open(buf);
  const sharedDoc = await parts.optionalXml('xl/sharedStrings.xml');
  const shared = sharedDoc === null ? [] : childrenNamed(sharedDoc.documentElement, 'si').map(sharedString);
  const styles = readStyles(await parts.optionalXml('xl/styles.xml'));
  const names = await readSheetNames(parts);

  const sheetPaths = parts.paths()
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path))
    .sort((a, b) => sheetNumber(a) - sheetNumber(b));

  const sheets: GridSheet[] = [];
  const spent = { cells: 0 };
  for (const path of sheetPaths) {
    // A sheet that fails to parse is left out; the others still show.
    const doc = await parts.optionalXml(path);
    if (doc !== null) {
      const rows = readRows(doc, shared, styles, MAX_CELLS - spent.cells);
      spent.cells += rows.reduce((total, row) => total + row.length, 0);
      sheets.push({ name: names.get(path) ?? `Sheet ${sheetNumber(path)}`, rows });
    }
  }

  return sheets;
}

/** Render an .xlsx into `container` as a spreadsheet grid. Cell text is set as text, never as markup. */
export async function renderXlsxInto(
  buf: ArrayBuffer,
  container: HTMLElement,
  chrome: PreviewChrome = detachedChrome(container),
): Promise<void> {
  mountSheetGrid(container, await readWorkbook(buf), chrome);
}

/** Render into `container`; resolves with a function that frees what the render holds. */
async function renderInto(
  buf: ArrayBuffer,
  container: HTMLElement,
  kind: OfficeKind,
  chrome: PreviewChrome,
): Promise<(() => void) | null> {
  if (kind === 'docx') {
    const render = await loadDocxRenderer();

    return render(buf, container);
  }
  if (kind === 'xlsx') {
    await renderXlsxInto(buf, container, chrome);

    return null;
  }
  const pptx = await loadPptxRenderer();
  const deck = await openDeckStage(buf, container, chrome, pptx.open);

  return () => deck.destroy();
}

/** The controls a rendered office body gets: page and zoom for a document. */
function mountKindChrome(container: HTMLElement, kind: OfficeKind, chrome: PreviewChrome): void {
  if (kind === 'docx') {
    mountPager(container, chrome);
  }
}

/**
 * Fetch and render a docx/xlsx/pptx body, unless the modal was torn down.
 * `onRelease` receives the function that frees the render's resources; when the
 * modal closed mid-render they are freed at once instead.
 */
export async function fillOfficeBody(
  body: HTMLElement,
  opts: FilePreviewOptions,
  kind: OfficeKind,
  isClosed: () => boolean,
  onRelease: (release: () => void) => void = () => undefined,
  chrome: PreviewChrome = detachedChrome(body, isClosed, onRelease),
): Promise<void> {
  const result = await loadBinaryPreview(opts.url);
  if (isClosed()) {
    return;
  }
  if (!result.ok) {
    buildErrorInto(body, opts);

    return;
  }

  const container = document.createElement('div');
  container.className = `blok-file-preview-office blok-file-preview-${kind}`;
  container.setAttribute('data-role', `file-preview-${kind}`);
  body.replaceChildren(container);

  try {
    const release = await renderInto(result.buf, container, kind, chrome);
    if (release !== null && isClosed()) {
      release();
    } else if (release !== null) {
      onRelease(release);
    }
    if (!isClosed()) {
      mountKindChrome(container, kind, chrome);
    }
  } catch (e) {
    console.warn(`[blok] Failed to render ${kind} preview:`, e);
    if (!isClosed()) {
      buildErrorInto(body, opts);
    }
  }
}
