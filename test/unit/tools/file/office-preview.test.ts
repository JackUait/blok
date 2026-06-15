import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type JSZip from 'jszip';

vi.mock('../../../../src/tools/file/binary-preview', () => ({
  loadBinaryPreview: vi.fn(),
}));
vi.mock('../../../../src/tools/file/office-loaders', () => ({
  loadDocxRenderer: vi.fn(),
  loadZip: vi.fn(),
  loadPptxRenderer: vi.fn(),
}));

import { fillOfficeBody, renderXlsxInto } from '../../../../src/tools/file/office-preview';
import { loadBinaryPreview } from '../../../../src/tools/file/binary-preview';
import { loadDocxRenderer, loadPptxRenderer, loadZip } from '../../../../src/tools/file/office-loaders';

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
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  /** A shared string deliberately carrying markup, XML-escaped so its text is the literal "<b>x</b>". */
  const sharedXml = '<?xml version="1.0"?><sst><si><t>&lt;b&gt;x&lt;/b&gt;</t></si><si><t>y</t></si></sst>';
  // A1 + B1 reference shared strings 0 and 1; C1 carries an inline number.
  const sheetXml = '<?xml version="1.0"?><worksheet><sheetData>'
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1"><v>42</v></c></row>'
    + '</sheetData></worksheet>';

  const fakeZip = {
    files: { 'xl/worksheets/sheet1.xml': {}, 'xl/sharedStrings.xml': {} },
    file: (name: string): { async: () => Promise<string> } | null => {
      if (name === 'xl/sharedStrings.xml') {
        return { async: () => Promise.resolve(sharedXml) };
      }
      if (name === 'xl/worksheets/sheet1.xml') {
        return { async: () => Promise.resolve(sheetXml) };
      }

      return null;
    },
  };

  beforeEach(() => {
    vi.mocked(loadZip).mockResolvedValue(
      { loadAsync: vi.fn().mockResolvedValue(fakeZip) } as unknown as typeof JSZip,
    );
  });

  it('renders shared-string cells as literal text, never parsed HTML', async () => {
    const container = document.createElement('div');
    await renderXlsxInto(new ArrayBuffer(4), container);
    const cell = container.querySelector('td');
    expect(cell?.textContent).toBe('<b>x</b>');   // literal text
    expect(cell?.querySelector('b')).toBeNull();  // not injected as an element
  });

  it('resolves shared strings and inline values across the row', async () => {
    const container = document.createElement('div');
    await renderXlsxInto(new ArrayBuffer(4), container);
    const cells = Array.from(container.querySelectorAll('td')).map((td) => td.textContent);
    expect(cells).toEqual(['<b>x</b>', 'y', '42']);
  });

  it('flags numeric cells (not text) so they can be right-aligned', async () => {
    const container = document.createElement('div');
    await renderXlsxInto(new ArrayBuffer(4), container);
    const cells = Array.from(container.querySelectorAll('td'));
    const NUM = 'blok-file-preview-xlsx-num';
    expect(cells[0].classList.contains(NUM)).toBe(false); // shared-string text
    expect(cells[1].classList.contains(NUM)).toBe(false); // shared-string text
    expect(cells[2].classList.contains(NUM)).toBe(true); //  inline number 42
  });
});
