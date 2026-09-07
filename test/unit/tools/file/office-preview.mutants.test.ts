import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import JSZip from 'jszip';

import { isOfficeKind, renderXlsxInto } from '../../../../src/tools/file/office-preview';

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
  });
});
