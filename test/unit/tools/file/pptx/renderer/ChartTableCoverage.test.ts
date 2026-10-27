// Derived from @aiden0z/pptx-renderer 1.4.0 tests (Apache-2.0); modified for Blok.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { borderXml, cornerStyles, tableFixture } from '../fixtures/chart-table-coverage';

// Table half only: the chart cases belong with the chart renderer.
describe('table merged edges and conditional styles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const base = `<a:wholeTbl><a:tcStyle><a:tcBdr>${borderXml('bottom', 'FF0000')}${borderXml('right', 'FF0000')}${borderXml('insideH', '0000FF')}${borderXml('insideV', '0000FF')}</a:tcBdr></a:tcStyle></a:wholeTbl>`;
  it('uses bottom/right outside border at merged end, retaining interior borders', () => {
    const vertical = tableFixture(base, '', [
      '<a:tc rowSpan="2"/><a:tc/>',
      '<a:tc vMerge="1"/><a:tc/>',
    ]);
    expect(vertical.querySelector('td')!.style.borderBottomColor).toBe('rgb(255, 0, 0)');
    expect(vertical.querySelector('td')!.style.borderRightColor).toBe('rgb(0, 0, 255)');
    const horizontal = tableFixture(base, '', [
      '<a:tc gridSpan="2"/><a:tc hMerge="1"/>',
      '<a:tc/><a:tc/>',
    ]);
    expect(horizontal.querySelector('td')!.style.borderRightColor).toBe('rgb(255, 0, 0)');
    expect(horizontal.querySelector('td')!.style.borderBottomColor).toBe('rgb(0, 0, 255)');
  });
  it('merged cells ending inside the table keep inside borders', () => {
    const element = tableFixture(
      base,
      '',
      [
        '<a:tc rowSpan="2" gridSpan="2"/><a:tc hMerge="1"/><a:tc/>',
        '<a:tc vMerge="1"/><a:tc vMerge="1"/><a:tc/>',
        '<a:tc/><a:tc/><a:tc/>',
      ],
      3,
    );
    const cell = element.querySelector('td')!;
    expect(cell.style.borderBottomColor).toBe('rgb(0, 0, 255)');
    expect(cell.style.borderRightColor).toBe('rgb(0, 0, 255)');
  });
  it('a direct border overrides a conditional border clear', () => {
    const styles =
      base +
      '<a:firstRow><a:tcStyle><a:tcBdr><a:bottom><a:lnRef idx="0"/></a:bottom></a:tcBdr></a:tcStyle></a:firstRow>';
    const element = tableFixture(styles, 'firstRow="1"', [
      '<a:tc><a:tcPr><a:lnB w="38100"><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></a:lnB></a:tcPr></a:tc><a:tc/>',
    ]);
    expect(element.querySelector('td')!.style.borderBottomColor).toBe('rgb(0, 255, 0)');
  });
  for (const clear of ['<a:ln><a:noFill/></a:ln>', '<a:lnRef idx="0"/>', '']) {
    it(`conditional border ${clear || 'absent'} clears or inherits`, () => {
      const element = tableFixture(
        base +
          `<a:firstRow><a:tcStyle><a:tcBdr><a:bottom>${clear}</a:bottom></a:tcBdr></a:tcStyle></a:firstRow>`,
        'firstRow="1"',
      );
      const td = element.querySelector('td')!;
      // jsdom 29 expands the engine's `border-bottom: none` to a currentcolor color.
      if (clear) expect(td.style.borderBottomStyle).toBe('none');
      else expect(td.style.borderBottomColor).toBe('rgb(0, 0, 255)');
    });
  }
  for (const [flags, colors] of [
    [
      'firstRow="1" lastRow="1" firstCol="1" lastCol="1"',
      ['rgb(255, 0, 0)', 'rgb(0, 255, 0)', 'rgb(0, 0, 255)', 'rgb(255, 255, 0)'],
    ],
    [
      'firstRow="0" lastRow="0" firstCol="1" lastCol="1"',
      ['rgb(204, 204, 204)', 'rgb(221, 221, 221)', 'rgb(204, 204, 204)', 'rgb(221, 221, 221)'],
    ],
    [
      'firstRow="1" lastRow="1" firstCol="0" lastCol="0"',
      ['rgb(170, 170, 170)', 'rgb(170, 170, 170)', 'rgb(187, 187, 187)', 'rgb(187, 187, 187)'],
    ],
  ] as const) {
    it(`corner flags ${flags}`, () => {
      expect(
        Array.from(
          tableFixture(cornerStyles(), flags).querySelectorAll('td'),
          (td) => td.style.backgroundColor,
        ),
      ).toEqual(colors);
    });
  }
  it('direct formatting overrides corners and direct noFill clears border', () => {
    const element = tableFixture(base + cornerStyles(), 'firstRow="1" firstCol="1"', [
      '<a:tc><a:tcPr><a:solidFill><a:srgbClr val="123456"/></a:solidFill><a:lnB><a:noFill/></a:lnB></a:tcPr></a:tc><a:tc/>',
    ]);
    expect(element.querySelector('td')!.style.backgroundColor).toBe('rgb(18, 52, 86)');
    // jsdom 29 expands the engine's `border-bottom: none` to a currentcolor color.
    expect(element.querySelector('td')!.style.borderBottomStyle).toBe('none');
  });
  it('one row and one column apply only enabled corner intersections', () => {
    expect(
      Array.from(
        tableFixture(cornerStyles(), 'firstRow="1" firstCol="1" lastCol="1"', [
          '<a:tc/><a:tc/>',
        ]).querySelectorAll('td'),
        (td) => td.style.backgroundColor,
      ),
    ).toEqual(['rgb(255, 0, 0)', 'rgb(0, 255, 0)']);
    expect(
      Array.from(
        tableFixture(
          cornerStyles(),
          'firstRow="1" lastRow="1" firstCol="1"',
          ['<a:tc/>', '<a:tc/>'],
          1,
        ).querySelectorAll('td'),
        (td) => td.style.backgroundColor,
      ),
    ).toEqual(['rgb(255, 0, 0)', 'rgb(0, 0, 255)']);
  });
  it('a one-cell table uses later east/south corner sections when several intersections coincide', () => {
    const withoutSE = cornerStyles().replace(/<a:seCell>[\s\S]*?<\/a:seCell>/, '');
    const flags = 'firstRow="1" lastRow="1" firstCol="1" lastCol="1"';
    expect(
      tableFixture(withoutSE, flags, ['<a:tc/>'], 1).querySelector('td')!.style.backgroundColor,
    ).toBe('rgb(0, 255, 0)');
    expect(
      tableFixture(cornerStyles(), flags, ['<a:tc/>'], 1).querySelector('td')!.style
        .backgroundColor,
    ).toBe('rgb(255, 255, 0)');
  });
});
