import type { PreviewKind } from './preview';
import type { FilePreviewOptions } from './preview-modal';
import { loadBinaryPreview } from './binary-preview';
import { loadDocxRenderer, loadXlsxRenderer, loadPptxRenderer } from './office-loaders';
import { buildErrorInto } from './preview-error';

export type OfficeKind = Extract<PreviewKind, 'docx' | 'xlsx' | 'pptx'>;

const OFFICE_KINDS = new Set<OfficeKind>(['docx', 'xlsx', 'pptx']);

/** Narrow a PreviewKind to an OfficeKind. */
export function isOfficeKind(kind: PreviewKind | null): kind is OfficeKind {
  return kind !== null && OFFICE_KINDS.has(kind as OfficeKind);
}

/** Build the xlsx grid as a DOM table — textContent only, never innerHTML. */
export async function renderXlsxInto(buf: ArrayBuffer, container: HTMLElement): Promise<void> {
  const Workbook = await loadXlsxRenderer();
  const workbook = new Workbook();
  await workbook.xlsx.load(buf);

  for (const ws of workbook.worksheets) {
    const table = document.createElement('table');
    table.className = 'blok-file-preview-xlsx-table';
    const cols = ws.columnCount;
    ws.eachRow({ includeEmpty: true }, (row) => {
      const tr = document.createElement('tr');
      Array.from({ length: cols }, (_, i) => i + 1).forEach((c) => {
        const td = document.createElement('td');
        td.textContent = row.getCell(c).text;
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    container.appendChild(table);
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
