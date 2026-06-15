import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../src/tools/file/binary-preview', () => ({
  loadBinaryPreview: vi.fn(),
}));
vi.mock('../../../../src/tools/file/office-loaders', () => ({
  loadDocxRenderer: vi.fn(),
  loadXlsxRenderer: vi.fn(),
  loadPptxRenderer: vi.fn(),
}));

import type { Workbook as ExcelWorkbook } from 'exceljs';
import { fillOfficeBody } from '../../../../src/tools/file/office-preview';
import { loadBinaryPreview } from '../../../../src/tools/file/binary-preview';
import { loadDocxRenderer, loadPptxRenderer, loadXlsxRenderer } from '../../../../src/tools/file/office-loaders';

const OPTS = { url: 'blob:x', fileName: 'a.docx', labels: { close: 'Close', error: 'Error', download: 'Download' } };

describe('fillOfficeBody', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('renders a download fallback when the fetch fails', async () => {
    vi.mocked(loadBinaryPreview).mockResolvedValue({ ok: false, reason: 'fetch-error' });
    const body = document.createElement('div');
    await fillOfficeBody(body, { ...OPTS, url: 'https://x.com/a.docx' }, 'docx', () => false);
    expect(body.querySelector('[data-role="file-preview-error"]')).not.toBeNull();
    expect(body.querySelector('[data-action="preview-download"]')).not.toBeNull();
  });

  it('does nothing when the modal is already closed', async () => {
    vi.mocked(loadBinaryPreview).mockResolvedValue({ ok: true, buf: new ArrayBuffer(4) });
    const body = document.createElement('div');
    await fillOfficeBody(body, OPTS, 'docx', () => true);
    expect(loadDocxRenderer).not.toHaveBeenCalled();
    expect(body.childElementCount).toBe(0);
  });

  it('invokes the docx renderer with the fetched buffer', async () => {
    const buf = new ArrayBuffer(4);
    vi.mocked(loadBinaryPreview).mockResolvedValue({ ok: true, buf });
    const render = vi.fn().mockResolvedValue(undefined);
    vi.mocked(loadDocxRenderer).mockResolvedValue(render);
    const body = document.createElement('div');
    await fillOfficeBody(body, OPTS, 'docx', () => false);
    expect(render).toHaveBeenCalledWith(buf, expect.any(HTMLElement));
    expect(body.querySelector('[data-role="file-preview-docx"]')).not.toBeNull();
  });

  it('renders a download fallback when the renderer throws', async () => {
    vi.mocked(loadBinaryPreview).mockResolvedValue({ ok: true, buf: new ArrayBuffer(4) });
    vi.mocked(loadPptxRenderer).mockResolvedValue({ open: vi.fn().mockRejectedValue(new Error('bad')) });
    const body = document.createElement('div');
    await fillOfficeBody(body, { ...OPTS, fileName: 'a.pptx', url: 'https://x.com/a.pptx' }, 'pptx', () => false);
    expect(body.querySelector('[data-role="file-preview-error"]')).not.toBeNull();
  });
});

describe('renderXlsxInto', () => {
  it('builds a table from cell text using textContent only', async () => {
    const { renderXlsxInto } = await import('../../../../src/tools/file/office-preview');
    const ws = {
      name: 'Sheet1', rowCount: 1, columnCount: 2,
      eachRow: (_opts: unknown, cb: (row: { getCell: (c: number) => { text: string } }, n: number) => void) => {
        cb({ getCell: (c: number) => ({ text: c === 1 ? '<b>x</b>' : 'y' }) }, 1);
      },
    };
    const workbookInstance = { worksheets: [ws], xlsx: { load: vi.fn().mockResolvedValue(undefined) } };
    class FakeWorkbook {
      worksheets = workbookInstance.worksheets;
      xlsx = workbookInstance.xlsx;
    }
    vi.mocked(loadXlsxRenderer).mockResolvedValue(
      FakeWorkbook as unknown as new () => ExcelWorkbook,
    );
    const container = document.createElement('div');
    await renderXlsxInto(new ArrayBuffer(4), container);
    const cell = container.querySelector('td');
    expect(cell?.textContent).toBe('<b>x</b>');        // literal text, not parsed HTML
    expect(cell?.querySelector('b')).toBeNull();        // no injection
  });
});
