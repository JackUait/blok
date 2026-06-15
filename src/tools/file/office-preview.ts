import type { PreviewKind } from './preview';
import type { FilePreviewOptions } from './preview-modal';
import { loadBinaryPreview } from './binary-preview';
import { loadDocxRenderer, loadZip, loadPptxRenderer } from './office-loaders';
import { buildErrorInto } from './preview-error';

export type OfficeKind = Extract<PreviewKind, 'docx' | 'xlsx' | 'pptx'>;

const OFFICE_KINDS = new Set<OfficeKind>(['docx', 'xlsx', 'pptx']);

/** Narrow a PreviewKind to an OfficeKind. */
export function isOfficeKind(kind: PreviewKind | null): kind is OfficeKind {
  return kind !== null && OFFICE_KINDS.has(kind as OfficeKind);
}

const COLUMN_LETTERS = /^([A-Z]+)/;

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

  return Array.from(letters).reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0);
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

/** Concatenate the `<t>` runs of a shared-string `<si>` element. */
function sharedString(si: Element): string {
  return Array.from(si.getElementsByTagName('t')).map((t) => t.textContent ?? '').join('');
}

/** Whether a cell holds a real number (so it can be right-aligned like a sheet). */
function isNumericCell(cell: Element, text: string): boolean {
  const type = cell.getAttribute('t');
  if (type === 's' || type === 'inlineStr' || type === 'str') {
    return false;
  }

  return text.trim() !== '' && Number.isFinite(Number(text));
}

/** Build one `<tr>` from a `<row>` element, placing cells at their A1 column. */
function buildRow(rowEl: Element, shared: string[]): HTMLTableRowElement {
  const cells = Array.from(rowEl.getElementsByTagName('c'));
  const byColumn = new Map<number, { text: string; numeric: boolean }>();
  cells.forEach((cell, i) => {
    const ref = cell.getAttribute('r');
    const text = cellText(cell, shared);
    byColumn.set(ref === null ? i + 1 : columnIndex(ref), { text, numeric: isNumericCell(cell, text) });
  });
  const lastColumn = cells.reduce((max, cell) => {
    const ref = cell.getAttribute('r');

    return ref === null ? max : Math.max(max, columnIndex(ref));
  }, cells.length);

  const tr = document.createElement('tr');
  for (const col of range(lastColumn)) {
    const td = document.createElement('td');
    const value = byColumn.get(col);
    td.textContent = value?.text ?? '';
    if (value?.numeric === true) {
      td.className = 'blok-file-preview-xlsx-num';
    }
    tr.appendChild(td);
  }

  return tr;
}

/** Build one worksheet `<table>` from a parsed sheet document. */
function buildSheetTable(doc: Document, shared: string[]): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'blok-file-preview-xlsx-table';
  for (const rowEl of Array.from(doc.getElementsByTagName('row'))) {
    table.appendChild(buildRow(rowEl, shared));
  }

  return table;
}

/**
 * Render an .xlsx as DOM tables by parsing the OOXML zip directly (JSZip +
 * DOMParser) — textContent only, never innerHTML. One table per worksheet; cells
 * are placed at their A1 column so sparse rows stay aligned.
 */
export async function renderXlsxInto(buf: ArrayBuffer, container: HTMLElement): Promise<void> {
  const JSZipCtor = await loadZip();
  const zip = await JSZipCtor.loadAsync(buf);
  const parser = new DOMParser();

  const sharedFile = zip.file('xl/sharedStrings.xml');
  const shared = sharedFile === null
    ? []
    : Array.from(
      parser.parseFromString(await sharedFile.async('text'), 'application/xml').getElementsByTagName('si'),
    ).map(sharedString);

  const sheetPaths = Object.keys(zip.files)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path))
    .sort((a, b) => sheetNumber(a) - sheetNumber(b));

  for (const path of sheetPaths) {
    const sheetFile = zip.file(path);
    if (sheetFile === null) {
      continue;
    }
    const doc = parser.parseFromString(await sheetFile.async('text'), 'application/xml');
    container.appendChild(buildSheetTable(doc, shared));
  }
}

async function renderInto(buf: ArrayBuffer, container: HTMLElement, kind: OfficeKind): Promise<void> {
  if (kind === 'docx') {
    const render = await loadDocxRenderer();
    await render(buf, container);

    return;
  }
  if (kind === 'xlsx') {
    await renderXlsxInto(buf, container);

    return;
  }
  const pptx = await loadPptxRenderer();
  await pptx.open(buf, container);
}

/** Fetch and render a docx/xlsx/pptx body, unless the modal was torn down. */
export async function fillOfficeBody(
  body: HTMLElement,
  opts: FilePreviewOptions,
  kind: OfficeKind,
  isClosed: () => boolean,
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
    await renderInto(result.buf, container, kind);
  } catch (e) {
    console.warn(`[blok] Failed to render ${kind} preview:`, e);
    if (!isClosed()) {
      buildErrorInto(body, opts);
    }
  }
}
