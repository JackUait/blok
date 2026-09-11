import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import JSZip from 'jszip';

const loaders = vi.hoisted(() => ({
  loadBinaryPreview: vi.fn(),
  loadDocxRenderer: vi.fn(),
  loadZip: vi.fn(),
  loadPptxRenderer: vi.fn(),
}));

vi.mock('../../../../src/tools/file/binary-preview', () => ({
  loadBinaryPreview: loaders.loadBinaryPreview,
}));

vi.mock('../../../../src/tools/file/office-loaders', () => ({
  loadDocxRenderer: loaders.loadDocxRenderer,
  loadZip: loaders.loadZip,
  loadPptxRenderer: loaders.loadPptxRenderer,
}));

import { fillOfficeBody, isOfficeKind, renderXlsxInto } from '../../../../src/tools/file/office-preview';
import type { FilePreviewOptions } from '../../../../src/tools/file/preview-modal';

const SHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

const sheetXml = (rows: string): string =>
  `<?xml version="1.0"?><worksheet xmlns="${SHEET_NS}"><sheetData>${rows}</sheetData></worksheet>`;

const sharedXml = (strings: string[]): string =>
  `<?xml version="1.0"?><sst xmlns="${SHEET_NS}">${strings.map((s) => `<si>${s}</si>`).join('')}</sst>`;

const workbook = async (files: Record<string, string>): Promise<ArrayBuffer> => {
  const zip = new JSZip();

  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }

  return zip.generateAsync({ type: 'arraybuffer' });
};

const renderSheet = async (files: Record<string, string>): Promise<HTMLElement> => {
  const container = document.createElement('div');

  document.body.appendChild(container);
  await renderXlsxInto(await workbook(files), container);

  return container;
};

const rowTexts = (container: HTMLElement): string[][] =>
  Array.from(container.querySelectorAll('tr')).map((tr) =>
    Array.from(tr.querySelectorAll('td')).map((td) => td.textContent ?? ''));

describe('office preview mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // restoreAllMocks in afterEach drops the implementations, so re-prime here.
    loaders.loadZip.mockResolvedValue(JSZip);
    loaders.loadBinaryPreview.mockResolvedValue({ ok: false, reason: 'fetch-error' });
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('isOfficeKind', () => {
    it.each(['docx', 'xlsx', 'pptx'] as const)('accepts %s', (kind) => {
      expect(isOfficeKind(kind)).toBe(true);
    });

    it('rejects a non-office preview kind', () => {
      expect(isOfficeKind('pdf')).toBe(false);
      expect(isOfficeKind('markdown')).toBe(false);
      expect(isOfficeKind('code')).toBe(false);
      expect(isOfficeKind('text')).toBe(false);
    });

    it('rejects a missing kind', () => {
      expect(isOfficeKind(null)).toBe(false);
    });
  });

  describe('rendering a workbook', () => {
    it('builds one table per worksheet', async () => {
      const container = await renderSheet({
        'xl/worksheets/sheet1.xml': sheetXml('<row><c r="A1" t="inlineStr"><is><t>one</t></is></c></row>'),
        'xl/worksheets/sheet2.xml': sheetXml('<row><c r="A1" t="inlineStr"><is><t>two</t></is></c></row>'),
      });

      expect(container.querySelectorAll('table')).toHaveLength(2);
      expect(container.querySelectorAll('table')[0].textContent).toBe('one');
      expect(container.querySelectorAll('table')[1].textContent).toBe('two');
    });

    it('orders sheets numerically, not as strings', async () => {
      const container = await renderSheet({
        'xl/worksheets/sheet10.xml': sheetXml('<row><c r="A1" t="inlineStr"><is><t>ten</t></is></c></row>'),
        'xl/worksheets/sheet2.xml': sheetXml('<row><c r="A1" t="inlineStr"><is><t>two</t></is></c></row>'),
      });

      const tables = container.querySelectorAll('table');

      expect(tables[0].textContent).toBe('two');
      expect(tables[1].textContent).toBe('ten');
    });

    it('ignores files that are not worksheets', async () => {
      const container = await renderSheet({
        'xl/worksheets/sheet1.xml': sheetXml('<row><c r="A1" t="inlineStr"><is><t>one</t></is></c></row>'),
        'xl/workbook.xml': '<workbook/>',
        'docProps/core.xml': '<props/>',
      });

      expect(container.querySelectorAll('table')).toHaveLength(1);
    });

    it('ignores an archive entry whose name only starts like a worksheet', async () => {
      const container = await renderSheet({
        'xl/worksheets/sheet1.xml': sheetXml('<row><c r="A1" t="inlineStr"><is><t>one</t></is></c></row>'),
        'xl/worksheets/sheet1.xml.bak': sheetXml('<row><c r="A1" t="inlineStr"><is><t>bak</t></is></c></row>'),
      });

      expect(container.querySelectorAll('table')).toHaveLength(1);
      expect(container.querySelector('table')?.textContent).toBe('one');
    });

    it('ignores a worksheet path nested below the archive root', async () => {
      const container = await renderSheet({
        'xl/worksheets/sheet1.xml': sheetXml('<row><c r="A1" t="inlineStr"><is><t>one</t></is></c></row>'),
        'backup/xl/worksheets/sheet2.xml': sheetXml('<row><c r="A1" t="inlineStr"><is><t>nested</t></is></c></row>'),
      });

      expect(container.querySelectorAll('table')).toHaveLength(1);
      expect(container.querySelector('table')?.textContent).toBe('one');
    });

    it('class-names every worksheet table', async () => {
      const container = await renderSheet({
        'xl/worksheets/sheet1.xml': sheetXml('<row><c r="A1" t="inlineStr"><is><t>one</t></is></c></row>'),
      });

      expect(container.querySelector('table')?.className).toBe('blok-file-preview-xlsx-table');
    });
  });

  describe('cell text', () => {
    it('resolves a shared string by index', async () => {
      const container = await renderSheet({
        'xl/sharedStrings.xml': sharedXml(['<t>zero</t>', '<t>one</t>']),
        'xl/worksheets/sheet1.xml': sheetXml('<row><c r="A1" t="s"><v>1</v></c></row>'),
      });

      expect(container.textContent).toBe('one');
    });

    it('joins the runs of a shared string', async () => {
      const container = await renderSheet({
        'xl/sharedStrings.xml': sharedXml(['<r><t>a</t></r><r><t>b</t></r>']),
        'xl/worksheets/sheet1.xml': sheetXml('<row><c r="A1" t="s"><v>0</v></c></row>'),
      });

      expect(container.textContent).toBe('ab');
    });

    it('renders an empty cell for a shared index that is not there', async () => {
      const container = await renderSheet({
        'xl/sharedStrings.xml': sharedXml(['<t>only</t>']),
        'xl/worksheets/sheet1.xml': sheetXml('<row><c r="A1" t="s"><v>9</v></c></row>'),
      });

      expect(container.querySelector('td')?.textContent).toBe('');
    });

    it('joins the runs of an inline string', async () => {
      const container = await renderSheet({
        'xl/worksheets/sheet1.xml': sheetXml('<row><c r="A1" t="inlineStr"><is><t>a</t><t>b</t></is></c></row>'),
      });

      expect(container.textContent).toBe('ab');
    });

    it('reads a plain value cell', async () => {
      const container = await renderSheet({
        'xl/worksheets/sheet1.xml': sheetXml('<row><c r="A1"><v>42</v></c></row>'),
      });

      expect(container.textContent).toBe('42');
    });

    it('renders an empty cell when there is no value at all', async () => {
      const container = await renderSheet({
        'xl/worksheets/sheet1.xml': sheetXml('<row><c r="A1"/></row>'),
      });

      expect(container.querySelector('td')?.textContent).toBe('');
    });

    it('resolves a shared cell with no value element to the first shared string', async () => {
      const container = await renderSheet({
        'xl/sharedStrings.xml': sharedXml(['<t>zero</t>', '<t>one</t>']),
        'xl/worksheets/sheet1.xml': sheetXml('<row><c r="A1" t="s"/></row>'),
      });

      expect(container.querySelector('td')?.textContent).toBe('zero');
    });

    it('renders an empty cell when the workbook has no sharedStrings part', async () => {
      const container = await renderSheet({
        'xl/worksheets/sheet1.xml': sheetXml('<row><c r="A1" t="s"><v>0</v></c></row>'),
      });

      expect(container.querySelector('td')?.textContent).toBe('');
    });
  });

  describe('numeric alignment', () => {
    it('marks a plain number as numeric', async () => {
      const container = await renderSheet({
        'xl/worksheets/sheet1.xml': sheetXml('<row><c r="A1"><v>42</v></c></row>'),
      });

      expect(container.querySelector('td')?.className).toBe('blok-file-preview-xlsx-num');
    });

    it('leaves a shared string unmarked even when it looks like a number', async () => {
      const container = await renderSheet({
        'xl/sharedStrings.xml': sharedXml(['<t>42</t>']),
        'xl/worksheets/sheet1.xml': sheetXml('<row><c r="A1" t="s"><v>0</v></c></row>'),
      });

      expect(container.querySelector('td')?.className).toBe('');
    });

    it('leaves a formula string result unmarked', async () => {
      const container = await renderSheet({
        'xl/worksheets/sheet1.xml': sheetXml('<row><c r="A1" t="str"><v>42</v></c></row>'),
      });

      expect(container.querySelector('td')?.className).toBe('');
    });

    it('leaves an inline string that looks like a number unmarked', async () => {
      const container = await renderSheet({
        'xl/worksheets/sheet1.xml': sheetXml('<row><c r="A1" t="inlineStr"><is><t>42</t></is></c></row>'),
      });

      expect(container.querySelector('td')?.textContent).toBe('42');
      expect(container.querySelector('td')?.className).toBe('');
    });

    it('leaves non-numeric text unmarked', async () => {
      const container = await renderSheet({
        'xl/worksheets/sheet1.xml': sheetXml('<row><c r="A1"><v>abc</v></c></row>'),
      });

      expect(container.querySelector('td')?.className).toBe('');
    });

    it('leaves a blank cell unmarked', async () => {
      const container = await renderSheet({
        'xl/worksheets/sheet1.xml': sheetXml('<row><c r="A1"><v>   </v></c></row>'),
      });

      expect(container.querySelector('td')?.className).toBe('');
    });
  });

  describe('column placement', () => {
    it('keeps a sparse row aligned by padding the gaps', async () => {
      const container = await renderSheet({
        'xl/worksheets/sheet1.xml': sheetXml(
          '<row><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="C1" t="inlineStr"><is><t>c</t></is></c></row>',
        ),
      });

      expect(rowTexts(container)).toStrictEqual([['a', '', 'c']]);
    });

    it('reads a two-letter column reference in base 26', async () => {
      const container = await renderSheet({
        'xl/worksheets/sheet1.xml': sheetXml('<row><c r="AA1" t="inlineStr"><is><t>x</t></is></c></row>'),
      });

      expect(rowTexts(container)[0]).toHaveLength(27);
      expect(rowTexts(container)[0][26]).toBe('x');
    });

    it('falls back to document order for a cell with no reference', async () => {
      const container = await renderSheet({
        'xl/worksheets/sheet1.xml': sheetXml(
          '<row><c t="inlineStr"><is><t>a</t></is></c><c t="inlineStr"><is><t>b</t></is></c></row>',
        ),
      });

      expect(rowTexts(container)).toStrictEqual([['a', 'b']]);
    });

    it('reads a reference with no column letters as the first column', async () => {
      const container = await renderSheet({
        'xl/worksheets/sheet1.xml': sheetXml('<row><c r="1" t="inlineStr"><is><t>a</t></is></c></row>'),
      });

      expect(rowTexts(container)).toStrictEqual([['']]);
    });
  });

  describe('fillOfficeBody', () => {
    const options = (): FilePreviewOptions => ({
      url: 'blob:file',
      fileName: 'report.docx',
      labels: { close: 'Close', error: 'Preview failed', download: 'Save file' },
    });

    const sheetBuffer = async (): Promise<ArrayBuffer> => workbook({
      'xl/worksheets/sheet1.xml': sheetXml('<row><c r="A1" t="inlineStr"><is><t>one</t></is></c></row>'),
    });

    it('shows the error block and no office container when the fetch fails', async () => {
      loaders.loadBinaryPreview.mockResolvedValue({ ok: false, reason: 'fetch-error' });
      const body = document.createElement('div');

      await fillOfficeBody(body, options(), 'xlsx', () => false);

      // A failed fetch must not pull a renderer chunk in to render nothing.
      expect(loaders.loadZip).not.toHaveBeenCalled();
      expect(body.querySelector('[data-role="file-preview-error"]')?.textContent).toBe('Preview failed');
      expect(body.querySelector('.blok-file-preview-office')).toBeNull();
    });

    it('renders a workbook into a kind-named container', async () => {
      loaders.loadBinaryPreview.mockResolvedValue({ ok: true, buf: await sheetBuffer() });
      const body = document.createElement('div');

      await fillOfficeBody(body, options(), 'xlsx', () => false);

      const container = body.querySelector<HTMLElement>('.blok-file-preview-office');

      expect(body.children).toHaveLength(1);
      expect(container?.className).toBe('blok-file-preview-office blok-file-preview-xlsx');
      expect(container?.getAttribute('data-role')).toBe('file-preview-xlsx');
      expect(container?.querySelector('table')?.textContent).toBe('one');
      expect(loaders.loadPptxRenderer).not.toHaveBeenCalled();
    });

    it('hands a docx body to the docx renderer', async () => {
      const buf = new ArrayBuffer(8);
      const render = vi.fn<(data: ArrayBuffer, host: HTMLElement) => Promise<void>>(async () => undefined);

      loaders.loadBinaryPreview.mockResolvedValue({ ok: true, buf });
      loaders.loadDocxRenderer.mockResolvedValue(render);
      const body = document.createElement('div');

      await fillOfficeBody(body, options(), 'docx', () => false);

      expect(render).toHaveBeenCalledTimes(1);
      expect(render.mock.calls[0][0]).toBe(buf);
      expect(render.mock.calls[0][1].className).toBe('blok-file-preview-office blok-file-preview-docx');
      expect(loaders.loadPptxRenderer).not.toHaveBeenCalled();
    });

    it('hands a pptx body to the pptx viewer', async () => {
      const buf = new ArrayBuffer(8);
      const open = vi.fn<(data: ArrayBuffer, host: HTMLElement) => Promise<unknown>>(async () => ({}));

      loaders.loadBinaryPreview.mockResolvedValue({ ok: true, buf });
      loaders.loadPptxRenderer.mockResolvedValue({ open });
      const body = document.createElement('div');

      await fillOfficeBody(body, options(), 'pptx', () => false);

      expect(open).toHaveBeenCalledTimes(1);
      expect(open.mock.calls[0][0]).toBe(buf);
      expect(open.mock.calls[0][1].getAttribute('data-role')).toBe('file-preview-pptx');
      expect(loaders.loadDocxRenderer).not.toHaveBeenCalled();
    });

    it('warns with the failing kind and shows the error block when the renderer throws', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      loaders.loadBinaryPreview.mockResolvedValue({ ok: true, buf: new ArrayBuffer(8) });
      loaders.loadDocxRenderer.mockResolvedValue(vi.fn(async () => {
        throw new Error('boom');
      }));
      const body = document.createElement('div');

      await fillOfficeBody(body, options(), 'docx', () => false);

      expect(warn.mock.calls[0][0]).toBe('[blok] Failed to render docx preview:');
      expect(warn.mock.calls[0][1]).toStrictEqual(new Error('boom'));
      expect(body.querySelector('[data-role="file-preview-error"]')?.textContent).toBe('Preview failed');
    });

    it('keeps the container when the modal closed during a failing render', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      loaders.loadBinaryPreview.mockResolvedValue({ ok: true, buf: new ArrayBuffer(8) });
      loaders.loadDocxRenderer.mockResolvedValue(vi.fn(async () => {
        throw new Error('boom');
      }));
      const isClosed = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
      const body = document.createElement('div');

      await fillOfficeBody(body, options(), 'docx', isClosed);

      expect(body.querySelector('[data-role="file-preview-error"]')).toBeNull();
      expect(body.querySelector('.blok-file-preview-office')).not.toBeNull();
    });
  });
});
