import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readZip } from '../../../../src/tools/file/zip/read-zip';
import { createZip } from '../../../../scripts/lib/zip-writer.mjs';

vi.mock('../../../../src/tools/file/binary-preview', () => ({
  loadBinaryPreview: vi.fn(),
}));
vi.mock('../../../../src/tools/file/office-loaders', () => ({
  loadDocxRenderer: vi.fn(),
  loadZipReader: vi.fn(),
  loadPptxRenderer: vi.fn(),
}));

import { fillOfficeBody, renderXlsxInto } from '../../../../src/tools/file/office-preview';
import { loadBinaryPreview } from '../../../../src/tools/file/binary-preview';
import { loadDocxRenderer, loadPptxRenderer, loadZipReader } from '../../../../src/tools/file/office-loaders';

const OPTS = { url: 'blob:x', fileName: 'a.docx', labels: { close: 'Close', error: 'Error', download: 'Download' } };

describe('fillOfficeBody', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('renders a download fallback when the fetch fails', async () => {
    vi.mocked(loadBinaryPreview).mockResolvedValue({ ok: false, reason: 'fetch-error' });
    const body = document.createElement('div');
    await fillOfficeBody(body, { ...OPTS, url: 'https://x.com/a.docx' }, 'docx', () => false, () => undefined);
    expect(body.querySelector('[data-role="file-preview-error"]')).not.toBeNull();
    expect(body.querySelector('[data-action="preview-download"]')).not.toBeNull();
  });

  it('does nothing when the modal is already closed', async () => {
    vi.mocked(loadBinaryPreview).mockResolvedValue({ ok: true, buf: new ArrayBuffer(4) });
    const body = document.createElement('div');
    await fillOfficeBody(body, OPTS, 'docx', () => true, () => undefined);
    expect(loadDocxRenderer).not.toHaveBeenCalled();
    expect(body.childElementCount).toBe(0);
  });

  it('invokes the docx renderer with the fetched buffer', async () => {
    const buf = new ArrayBuffer(4);
    vi.mocked(loadBinaryPreview).mockResolvedValue({ ok: true, buf });
    const render = vi.fn().mockResolvedValue(undefined);
    vi.mocked(loadDocxRenderer).mockResolvedValue(render);
    const body = document.createElement('div');
    await fillOfficeBody(body, OPTS, 'docx', () => false, () => undefined);
    expect(render).toHaveBeenCalledWith(buf, expect.any(HTMLElement));
    expect(body.querySelector('[data-role="file-preview-docx"]')).not.toBeNull();
  });

  it('renders a download fallback when the renderer throws', async () => {
    vi.mocked(loadBinaryPreview).mockResolvedValue({ ok: true, buf: new ArrayBuffer(4) });
    vi.mocked(loadPptxRenderer).mockResolvedValue({ open: vi.fn().mockRejectedValue(new Error('bad')) });
    const body = document.createElement('div');
    await fillOfficeBody(body, { ...OPTS, fileName: 'a.pptx', url: 'https://x.com/a.pptx' }, 'pptx', () => false, () => undefined);
    expect(body.querySelector('[data-role="file-preview-error"]')).not.toBeNull();
  });
});

describe('fillOfficeBody pptx lifecycle', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  const PPTX = { ...OPTS, fileName: 'a.pptx', url: 'https://x.com/a.pptx' };

  it('destroys the deck when the modal closes', async () => {
    vi.mocked(loadBinaryPreview).mockResolvedValue({ ok: true, buf: new ArrayBuffer(4) });
    const destroy = vi.fn();
    vi.mocked(loadPptxRenderer).mockResolvedValue({ open: vi.fn().mockResolvedValue({ destroy }) });
    const teardowns: Array<() => void> = [];

    await fillOfficeBody(document.createElement('div'), PPTX, 'pptx', () => false, (fn) => teardowns.push(fn));
    expect(destroy).not.toHaveBeenCalled();
    teardowns.forEach((fn) => fn());

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('lets the viewer stop before drawing when the modal closes while the deck parses', async () => {
    vi.mocked(loadBinaryPreview).mockResolvedValue({ ok: true, buf: new ArrayBuffer(4) });
    const open = vi.fn().mockResolvedValue({ destroy: vi.fn() });
    const isClosed = vi.fn(() => false);
    vi.mocked(loadPptxRenderer).mockResolvedValue({ open });

    await fillOfficeBody(document.createElement('div'), PPTX, 'pptx', isClosed, () => undefined);

    expect(open).toHaveBeenCalledWith(expect.any(ArrayBuffer), expect.any(HTMLElement), isClosed);
  });

  it('destroys a deck that finished opening after the modal closed', async () => {
    vi.mocked(loadBinaryPreview).mockResolvedValue({ ok: true, buf: new ArrayBuffer(4) });
    const destroy = vi.fn();
    const state = { closed: false };
    vi.mocked(loadPptxRenderer).mockResolvedValue({
      open: vi.fn().mockImplementation(() => {
        state.closed = true;

        return Promise.resolve({ destroy });
      }),
    });

    await fillOfficeBody(document.createElement('div'), PPTX, 'pptx', () => state.closed, () => undefined);

    expect(destroy).toHaveBeenCalledTimes(1);
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

  const workbook = (): Promise<ArrayBuffer> => Promise.resolve(Uint8Array.from(createZip([
    { name: 'xl/sharedStrings.xml', data: sharedXml },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml },
  ])).buffer);

  beforeEach(() => {
    vi.mocked(loadZipReader).mockResolvedValue(readZip);
  });

  it('renders shared-string cells as literal text, never parsed HTML', async () => {
    const container = document.createElement('div');
    await renderXlsxInto(await workbook(), container);
    const cell = container.querySelector('td');
    expect(cell?.textContent).toBe('<b>x</b>');   // literal text
    expect(cell?.querySelector('b')).toBeNull();  // not injected as an element
  });

  it('resolves shared strings and inline values across the row', async () => {
    const container = document.createElement('div');
    await renderXlsxInto(await workbook(), container);
    const cells = Array.from(container.querySelectorAll('td')).map((td) => td.textContent);
    expect(cells).toEqual(['<b>x</b>', 'y', '42']);
  });

  it('flags numeric cells (not text) so they can be right-aligned', async () => {
    const container = document.createElement('div');
    await renderXlsxInto(await workbook(), container);
    const cells = Array.from(container.querySelectorAll('td'));
    const NUM = 'blok-file-preview-xlsx-num';
    expect(cells[0].classList.contains(NUM)).toBe(false); // shared-string text
    expect(cells[1].classList.contains(NUM)).toBe(false); // shared-string text
    expect(cells[2].classList.contains(NUM)).toBe(true); //  inline number 42
  });

  const sheet = async (rows: string, strings = '<sst/>'): Promise<HTMLElement> => {
    const container = document.createElement('div');
    const buf = Uint8Array.from(createZip([
      { name: 'xl/sharedStrings.xml', data: strings },
      { name: 'xl/worksheets/sheet1.xml', data: `<worksheet><sheetData>${rows}</sheetData></worksheet>` },
    ])).buffer;
    await renderXlsxInto(buf, container);

    return container;
  };

  it('stops at Excel\'s last column, XFD, however far a cell ref points', async () => {
    const c = await sheet('<row><c r="AAAAA1"><v>1</v></c></row>');

    expect(c.querySelectorAll('td')).toHaveLength(16_384);
  }, 30_000);

  it('reads cells and rows only where Excel puts them, so nesting cannot multiply them', async () => {
    const d = 50;
    const c = await sheet('<row><c><v>1</v></c>'.repeat(d) + '</row>'.repeat(d));

    expect(c.querySelectorAll('td')).toHaveLength(1);
  });

  it('builds a shared string from its own runs, without phonetic hints or nested strings', async () => {
    const strings = '<sst><si><r><t>Tok</t></r><r><t>yo</t></r><rPh><t>toukyou</t></rPh><si><t>inner</t></si></si><si><t>next</t></si></sst>';
    const c = await sheet('<row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>', strings);

    expect(Array.from(c.querySelectorAll('td'), (td) => td.textContent)).toEqual(['Tokyo', 'next']);
  });

  it('stops adding rows once the preview holds its cell budget', async () => {
    const row = '<row>' + '<c><v>1</v></c>'.repeat(1000) + '</row>';
    const c = await sheet(row.repeat(60));

    expect(c.querySelectorAll('td')).toHaveLength(50_000);
  }, 60_000);
});
