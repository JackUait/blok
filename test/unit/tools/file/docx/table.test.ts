import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderDocxInto } from '../../../../../src/tools/file/docx';
import { buildDocx, p } from './build-docx';


async function renderBuffer(buf: ArrayBuffer): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await renderDocxInto(buf, container);

  return container;
}

const render = async (parts: Parameters<typeof buildDocx>[0]): Promise<HTMLElement> => renderBuffer(await buildDocx(parts));

const fixture = (name: string): ArrayBuffer => {
  const bytes = readFileSync(path.resolve(__dirname, 'fixtures/upstream', `${name}.docx`));

  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const firstTable = (c: HTMLElement): HTMLTableElement => {
  const table = c.querySelector('article table');
  if (!(table instanceof HTMLTableElement)) {
    throw new Error('no table');
  }

  return table;
};

/** Direct rows of a table (not rows of nested tables). */
const rowsOf = (table: HTMLTableElement): HTMLTableRowElement[] => Array.from(table.rows);

const cellText = (td: HTMLTableCellElement): string => Array.from(td.querySelectorAll('p'), (el) => el.textContent ?? '').join('\n\n');

const cellByText = (c: HTMLElement, text: string): HTMLTableCellElement => {
  const td = Array.from(c.querySelectorAll('td')).find((el) => cellText(el) === text);
  if (td === undefined) {
    throw new Error(`no cell "${text}"`);
  }

  return td;
};

const runOf = (c: HTMLElement, text: string): HTMLElement => {
  const span = Array.from(c.querySelectorAll<HTMLElement>('td span')).find((el) => el.textContent === text);
  if (span === undefined) {
    throw new Error(`no run "${text}"`);
  }

  return span;
};

const tc = (text: string, tcPr = ''): string => `<w:tc>${tcPr === '' ? '' : `<w:tcPr>${tcPr}</w:tcPr>`}${p(text)}</w:tc>`;
const tr = (cells: string, trPr = ''): string => `<w:tr>${trPr === '' ? '' : `<w:trPr>${trPr}</w:trPr>`}${cells}</w:tr>`;
const tbl = (rows: string, tblPr = '', grid = ''): string =>
  `<w:tbl>${tblPr === '' ? '' : `<w:tblPr>${tblPr}</w:tblPr>`}${grid === '' ? '' : `<w:tblGrid>${grid}</w:tblGrid>`}${rows}</w:tbl>`;

type Cell = [text: string, colSpan: number, rowSpan: number];

const T = 'Test';
const paras = (...texts: string[]): string => texts.join('\n\n');

/** Visible cells of the old renderer (docx-preview 0.4.1) on these fixtures, from the 2026-10-28 baseline. */
const BASELINE: Record<string, Cell[][]> = {
  table: [
    [[T, 1, 1], [T, 1, 1], [T, 1, 1]],
    [[T, 1, 1], [T, 1, 1], [T, 1, 1]],
  ],
  'table-spans': [
    [[paras(T, T, T, T, T, T, T), 1, 6], [paras(T, T), 1, 2], [paras(T, T), 1, 2], [paras(T, T), 1, 2], ['Test Test', 2, 1]],
    [[T, 1, 1], [T, 1, 1]],
    [[T, 1, 1], [T, 1, 1], [T, 1, 1], [T, 1, 1], [T, 1, 1]],
    [['Test Test Test Test Test', 5, 1]],
    [[paras('Test Test', 'Test Test'), 2, 1], [paras('Test Test Test', 'Test Test Test', 'Test Test Test'), 3, 2]],
    [[T, 1, 1], [T, 1, 1]],
  ],
};

const shape = (table: HTMLTableElement): Cell[][] =>
  rowsOf(table).map((row) => Array.from(row.cells, (td): Cell => [cellText(td), td.colSpan, td.rowSpan]));

describe('renderTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  describe('upstream fixtures match the old renderer', () => {
    it('table: same cell texts and spans', async () => {
      const table = firstTable(await renderBuffer(fixture('table')));

      expect(shape(table)).toEqual(BASELINE.table);
    });

    it('table-spans: same visible cells, continuation cells omitted', async () => {
      const table = firstTable(await renderBuffer(fixture('table-spans')));

      expect(shape(table)).toEqual(BASELINE['table-spans']);
      // The old renderer also kept 9 hidden continuation cells.
      expect(table.querySelectorAll(':scope > tbody > tr > td')).toHaveLength(17);
      expect(table.style.tableLayout).toBe('fixed');
    });
  });

  describe('grid and widths', () => {
    it('writes grid columns as <col> widths and the table width', async () => {
      const table = firstTable(await render({
        body: tbl(tr(tc('a') + tc('b')), '<w:tblW w:w="4000" w:type="dxa"/>', '<w:gridCol w:w="3000"/><w:gridCol w:w="1000"/>'),
      }));
      const cols = Array.from(table.querySelectorAll('colgroup > col'), (col) => (col instanceof HTMLElement ? col.style.width : ''));

      expect(cols).toEqual(['150pt', '50pt']);
      expect(table.style.width).toBe('200pt');
      expect(table.style.borderCollapse).toBe('collapse');
    });

    it('reads pct widths as fiftieths of a percent or as a percent string', async () => {
      const c = await render({
        body: tbl(tr(tc('a', '<w:tcW w:w="25%" w:type="pct"/>') + tc('b', '<w:tcW w:w="0" w:type="auto"/>')), '<w:tblW w:w="2500" w:type="pct"/>'),
      });

      expect(firstTable(c).style.width).toBe('50%');
      expect(cellByText(c, 'a').style.width).toBe('25%');
      expect(cellByText(c, 'b').style.width).toBe('');
    });

    it('centres with auto margins, right-aligns, and indents', async () => {
      const centred = firstTable(await render({ body: tbl(tr(tc('a')), '<w:jc w:val="center"/>') }));
      expect([centred.style.marginLeft, centred.style.marginRight]).toEqual(['auto', 'auto']);
      document.body.replaceChildren();

      const right = firstTable(await render({ body: tbl(tr(tc('a')), '<w:jc w:val="right"/>') }));
      expect([right.style.marginLeft, right.style.marginRight]).toEqual(['auto', '']);
      document.body.replaceChildren();

      const indented = firstTable(await render({ body: tbl(tr(tc('a')), '<w:tblInd w:w="720" w:type="dxa"/>') }));
      expect(indented.style.marginLeft).toBe('36pt');
    });
  });

  describe('spans', () => {
    it('turns gridSpan into colSpan and vMerge into rowSpan without continuation cells', async () => {
      const c = await render({
        body: tbl(
          tr(tc('top', '<w:vMerge w:val="restart"/>') + tc('wide', '<w:gridSpan w:val="2"/>'))
          + tr(tc('', '<w:vMerge/>') + tc('b1') + tc('b2'))
          + tr(tc('', '<w:vMerge w:val="continue"/>') + tc('c1') + tc('c2'))
          + tr(tc('d0') + tc('d1') + tc('d2')),
          '',
          '<w:gridCol w:w="1000"/><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/>',
        ),
      });
      const rows = rowsOf(firstTable(c));

      expect(rows.map((row) => row.cells.length)).toEqual([2, 2, 2, 3]);
      expect(cellByText(c, 'top').rowSpan).toBe(3);
      expect(cellByText(c, 'wide').colSpan).toBe(2);
    });

    it('tracks vMerge by grid column when rows start with gridBefore', async () => {
      const c = await render({
        body: tbl(
          tr(tc('a0') + tc('a1', '<w:vMerge w:val="restart"/>'))
          + tr(tc('', '<w:vMerge/>'), '<w:gridBefore w:val="1"/>'),
          '',
          '<w:gridCol w:w="1000"/><w:gridCol w:w="1000"/>',
        ),
      });
      const rows = rowsOf(firstTable(c));

      expect(cellByText(c, 'a1').rowSpan).toBe(2);
      expect(rows[1].cells).toHaveLength(1);
      expect(rows[1].cells[0].colSpan).toBe(1);
      expect(cellText(rows[1].cells[0])).toBe('');
    });

    it('fills gridBefore and gridAfter with empty borderless cells', async () => {
      const c = await render({
        body: tbl(
          tr(tc('mid'), '<w:gridBefore w:val="2"/><w:gridAfter w:val="1"/>'),
          '<w:tblBorders><w:top w:val="single" w:sz="8" w:color="000000"/><w:left w:val="single" w:sz="8" w:color="000000"/></w:tblBorders>',
          '<w:gridCol w:w="1000"/><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/>',
        ),
      });
      const cells = Array.from(rowsOf(firstTable(c))[0].cells);

      expect(cells.map((td) => td.colSpan)).toEqual([2, 1, 1]);
      expect(cells[0].childNodes).toHaveLength(0);
      expect(cells[0].style.borderTopStyle).toBe('none');
      expect(cells[1].style.borderTopStyle).toBe('solid');
    });
  });

  describe('borders', () => {
    const grid = '<w:gridCol w:w="1000"/><w:gridCol w:w="1000"/>';
    const borders = '<w:tblBorders>'
      + '<w:top w:val="single" w:sz="8" w:color="FF0000"/><w:left w:val="double" w:sz="4" w:color="00FF00"/>'
      + '<w:bottom w:val="dotted" w:sz="1" w:color="auto"/><w:right w:val="dashSmallGap" w:sz="96" w:color="0000FF"/>'
      + '<w:insideH w:val="thick" w:sz="16" w:color="111111"/><w:insideV w:val="nil"/>'
      + '</w:tblBorders>';

    it('uses outer borders on edge cells and inside borders between cells', async () => {
      const c = await render({ body: tbl(tr(tc('a') + tc('b')) + tr(tc('c') + tc('d')), borders, grid) });
      const a = cellByText(c, 'a');
      const d = cellByText(c, 'd');

      expect([a.style.borderTopStyle, a.style.borderTopWidth, a.style.borderTopColor]).toEqual(['solid', '1pt', 'rgb(255, 0, 0)']);
      expect([a.style.borderLeftStyle, a.style.borderLeftWidth]).toEqual(['double', '0.5pt']);
      expect([a.style.borderBottomStyle, a.style.borderBottomWidth]).toEqual(['solid', '2pt']);
      expect(a.style.borderRightStyle).toBe('none');
      expect([d.style.borderBottomStyle, d.style.borderBottomWidth]).toEqual(['dotted', '0.25pt']);
      expect([d.style.borderRightStyle, d.style.borderRightWidth]).toEqual(['dashed', '6pt']);
      expect(d.style.borderTopColor).toBe('rgb(17, 17, 17)');
    });

    it('lets tcBorders beat table borders, and start/end mean left/right', async () => {
      const c = await render({
        body: tbl(tr(tc('a', '<w:tcBorders><w:top w:val="none"/><w:end w:val="single" w:sz="4" w:color="ABCDEF"/></w:tcBorders>') + tc('b')), borders, grid),
      });
      const a = cellByText(c, 'a');

      expect(a.style.borderTopStyle).toBe('none');
      expect([a.style.borderRightStyle, a.style.borderRightColor]).toEqual(['solid', 'rgb(171, 205, 239)']);
    });

    it('takes table borders from the table style', async () => {
      const c = await render({
        styles: `<w:style w:type="table" w:styleId="Grid"><w:tblPr>${borders}</w:tblPr></w:style>`,
        body: tbl(tr(tc('a')), '<w:tblStyle w:val="Grid"/>'),
      });

      expect(cellByText(c, 'a').style.borderTopStyle).toBe('solid');
    });
  });

  describe('cell margins, shading, alignment, height', () => {
    it('uses Word\'s default margins when nothing sets them', async () => {
      const a = cellByText(await render({ body: tbl(tr(tc('a'))) }), 'a');

      expect([a.style.paddingTop, a.style.paddingRight, a.style.paddingBottom, a.style.paddingLeft]).toEqual(['0pt', '5.4pt', '0pt', '5.4pt']);
      expect(a.style.verticalAlign).toBe('top');
    });

    it('lets tcMar beat tblCellMar side by side', async () => {
      const c = await render({
        body: tbl(
          tr(tc('a', '<w:tcMar><w:left w:w="0" w:type="dxa"/></w:tcMar>')),
          '<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:start w:w="200" w:type="dxa"/><w:end w:w="100" w:type="dxa"/></w:tblCellMar>',
        ),
      });
      const a = cellByText(c, 'a');

      expect([a.style.paddingTop, a.style.paddingRight, a.style.paddingBottom, a.style.paddingLeft]).toEqual(['2pt', '5pt', '0pt', '0pt']);
    });

    it('paints shading, vertical alignment and row height', async () => {
      const c = await render({
        body: tbl(
          tr(tc('a', '<w:shd w:val="clear" w:fill="FFCC00"/><w:vAlign w:val="center"/>') + tc('b', '<w:vAlign w:val="bottom"/>') + tc('t'), '<w:trHeight w:val="400" w:hRule="atLeast"/>'),
          '<w:shd w:val="clear" w:fill="EEEEEE"/>',
        ),
      });
      const row = rowsOf(firstTable(c))[0];

      expect(cellByText(c, 'a').style.backgroundColor).toBe('rgb(255, 204, 0)');
      expect(cellByText(c, 'a').style.verticalAlign).toBe('middle');
      expect(cellByText(c, 'b').style.verticalAlign).toBe('bottom');
      expect(cellByText(c, 't').style.backgroundColor).toBe('rgb(238, 238, 238)');
      expect(row.style.height).toBe('20pt');
    });
  });

  describe('table style layers and conditional formats', () => {
    const style = '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"/>'
      + '<w:style w:type="paragraph" w:styleId="Red"><w:rPr><w:color w:val="FF0000"/></w:rPr></w:style>'
      + '<w:style w:type="table" w:styleId="Fancy">'
      + '<w:rPr><w:color w:val="0000FF"/><w:sz w:val="18"/></w:rPr>'
      + '<w:tblStylePr w:type="firstRow"><w:rPr><w:b/></w:rPr><w:tcPr><w:shd w:val="clear" w:fill="000080"/></w:tcPr></w:tblStylePr>'
      + '<w:tblStylePr w:type="lastRow"><w:rPr><w:i/></w:rPr></w:tblStylePr>'
      + '<w:tblStylePr w:type="firstCol"><w:rPr><w:u w:val="single"/></w:rPr><w:tcPr><w:shd w:val="clear" w:fill="00FF00"/></w:tcPr></w:tblStylePr>'
      + '<w:tblStylePr w:type="band1Horz"><w:tcPr><w:shd w:val="clear" w:fill="DDDDDD"/></w:tcPr></w:tblStylePr>'
      + '<w:tblStylePr w:type="band2Horz"><w:tcPr><w:shd w:val="clear" w:fill="AAAAAA"/></w:tcPr></w:tblStylePr>'
      + '</w:style>';
    const rows = ['h', 'r1', 'r2', 'r3', 'f'].map((name) => tr(tc(`${name}0`) + tc(`${name}1`))).join('');

    it('puts the table style between docDefaults and the paragraph style', async () => {
      const c = await render({
        styles: style,
        body: tbl(tr(`<w:tc>${p('plain')}${p('red', '<w:pStyle w:val="Red"/>')}</w:tc>`), '<w:tblStyle w:val="Fancy"/><w:tblLook w:val="0000"/>'),
      });

      expect(runOf(c, 'plain').style.color).toBe('rgb(0, 0, 255)');
      expect(runOf(c, 'plain').style.fontSize).toBe('9pt');
      expect(runOf(c, 'red').style.color).toBe('rgb(255, 0, 0)');
    });

    it('applies header, last row, first column and row bands from tblLook attributes', async () => {
      const c = await render({
        styles: style,
        body: tbl(rows, '<w:tblStyle w:val="Fancy"/><w:tblLook w:firstRow="1" w:lastRow="1" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>'),
      });

      expect(runOf(c, 'h1').style.fontWeight).toBe('bold');
      expect(cellByText(c, 'h1').style.backgroundColor).toBe('rgb(0, 0, 128)');
      // firstRow beats firstCol
      expect(cellByText(c, 'h0').style.backgroundColor).toBe('rgb(0, 0, 128)');
      expect(runOf(c, 'f1').style.fontStyle).toBe('italic');
      expect(runOf(c, 'r20').style.textDecorationLine).toBe('underline');
      expect(cellByText(c, 'r20').style.backgroundColor).toBe('rgb(0, 255, 0)');
      // Bands count from the first row after the header.
      expect(cellByText(c, 'r11').style.backgroundColor).toBe('rgb(221, 221, 221)');
      expect(cellByText(c, 'r21').style.backgroundColor).toBe('rgb(170, 170, 170)');
      expect(cellByText(c, 'r31').style.backgroundColor).toBe('rgb(221, 221, 221)');
      expect(runOf(c, 'r11').style.fontWeight).not.toBe('bold');
    });

    it('reads the legacy hex tblLook bitmask, and noHBand turns bands off', async () => {
      // 0x0020 firstRow | 0x0200 noHBand
      const c = await render({ styles: style, body: tbl(rows, '<w:tblStyle w:val="Fancy"/><w:tblLook w:val="0220"/>') });

      expect(runOf(c, 'h0').style.fontWeight).toBe('bold');
      expect(runOf(c, 'f0').style.fontStyle).not.toBe('italic');
      expect(cellByText(c, 'r11').style.backgroundColor).toBe('');
      expect(cellByText(c, 'r20').style.backgroundColor).toBe('');
    });

    it('lets a tblLook attribute beat its hex bit', async () => {
      const c = await render({ styles: style, body: tbl(rows, '<w:tblStyle w:val="Fancy"/><w:tblLook w:val="0020" w:firstRow="0"/>') });

      expect(runOf(c, 'h0').style.fontWeight).not.toBe('bold');
    });

    it('honours tblStyleRowBandSize', async () => {
      const banded = style.replace('<w:rPr><w:color w:val="0000FF"/>', '<w:tblPr><w:tblStyleRowBandSize w:val="2"/></w:tblPr><w:rPr><w:color w:val="0000FF"/>');
      const c = await render({ styles: banded, body: tbl(rows, '<w:tblStyle w:val="Fancy"/><w:tblLook w:firstRow="1" w:noVBand="1"/>') });

      expect(cellByText(c, 'r11').style.backgroundColor).toBe('rgb(221, 221, 221)');
      expect(cellByText(c, 'r21').style.backgroundColor).toBe('rgb(221, 221, 221)');
      expect(cellByText(c, 'r31').style.backgroundColor).toBe('rgb(170, 170, 170)');
    });

    it('applies wholeTable, column bands and the last column', async () => {
      const columns = '<w:style w:type="table" w:styleId="Cols">'
        + '<w:tblStylePr w:type="wholeTable"><w:rPr><w:color w:val="00AA00"/></w:rPr></w:tblStylePr>'
        + '<w:tblStylePr w:type="band1Vert"><w:tcPr><w:shd w:val="clear" w:fill="111111"/></w:tcPr></w:tblStylePr>'
        + '<w:tblStylePr w:type="band2Vert"><w:tcPr><w:shd w:val="clear" w:fill="222222"/></w:tcPr></w:tblStylePr>'
        + '<w:tblStylePr w:type="lastCol"><w:tcPr><w:shd w:val="clear" w:fill="333333"/></w:tcPr></w:tblStylePr>'
        + '</w:style>';
      const c = await render({
        styles: columns,
        body: tbl(tr(tc('c0') + tc('c1') + tc('c2') + tc('c3')), '<w:tblStyle w:val="Cols"/><w:tblLook w:firstColumn="1" w:lastColumn="1" w:noVBand="0" w:noHBand="1"/>'),
      });

      expect(runOf(c, 'c0').style.color).toBe('rgb(0, 170, 0)');
      expect(cellByText(c, 'c0').style.backgroundColor).toBe('');
      expect(cellByText(c, 'c1').style.backgroundColor).toBe('rgb(17, 17, 17)');
      expect(cellByText(c, 'c2').style.backgroundColor).toBe('rgb(34, 34, 34)');
      expect(cellByText(c, 'c3').style.backgroundColor).toBe('rgb(51, 51, 51)');
    });

    it('takes cell borders from a conditional format', async () => {
      const bordered = style.replace(
        '<w:tblStylePr w:type="firstRow"><w:rPr><w:b/></w:rPr><w:tcPr>',
        '<w:tblStylePr w:type="firstRow"><w:rPr><w:b/></w:rPr><w:tcPr><w:tcBorders><w:bottom w:val="single" w:sz="12" w:color="000000"/></w:tcBorders>',
      );
      const c = await render({ styles: bordered, body: tbl(rows, '<w:tblStyle w:val="Fancy"/><w:tblLook w:firstRow="1"/>') });

      expect([cellByText(c, 'h0').style.borderBottomStyle, cellByText(c, 'h0').style.borderBottomWidth]).toEqual(['solid', '1.5pt']);
      expect(cellByText(c, 'r10').style.borderBottomStyle).toBe('none');
    });
  });

  describe('structure', () => {
    it('renders a nested table inside a cell', async () => {
      const c = await render({ body: tbl(tr(`<w:tc>${p('outer')}${tbl(tr(tc('inner')))}${p('')}</w:tc>`)) });
      const outer = firstTable(c);

      expect(outer.querySelectorAll('table')).toHaveLength(1);
      expect(rowsOf(outer)).toHaveLength(1);
      expect(cellByText(c, 'inner').closest('table')).not.toBe(outer);
    });

    it('unwraps sdt and customXml around rows and cells', async () => {
      const c = await render({
        body: tbl(
          `<w:sdt><w:sdtContent>${tr(`<w:customXml>${tc('x')}</w:customXml><w:sdt><w:sdtContent>${tc('y')}</w:sdtContent></w:sdt>`)}</w:sdtContent></w:sdt>`
          + `<w:customXml>${tr(tc('z'))}</w:customXml>`,
        ),
      });

      expect(shape(firstTable(c)).map((row) => row.map(([text]) => text))).toEqual([['x', 'y'], ['z']]);
    });

    it('skips a row deleted with tracked changes', async () => {
      const c = await render({ body: tbl(tr(tc('keep')) + tr(tc('gone'), '<w:del w:id="1" w:author="a" w:date="2020-01-01T00:00:00Z"/>')) });

      expect(shape(firstTable(c)).map((row) => row.map(([text]) => text))).toEqual([['keep']]);
    });

    it('survives absurd spans', async () => {
      const c = await render({ body: tbl(tr(tc('a', '<w:gridSpan w:val="99999999"/>') + tc('b', '<w:gridSpan w:val="-3"/>'))) });
      const cells = Array.from(rowsOf(firstTable(c))[0].cells);

      expect(cells[0].colSpan).toBeLessThanOrEqual(1000);
      expect(cells[1].colSpan).toBe(1);
    });
  });
});

describe('renderTable — default table style', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('applies the w:default table style to a table that names none', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    await renderDocxInto(await buildDocx({
      styles: '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:tblPr><w:tblCellMar><w:left w:w="200" w:type="dxa"/><w:right w:w="200" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>',
      body: '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
    }), container);

    expect(container.querySelector('td')?.style.paddingLeft).toBe('10pt');
  });
});
