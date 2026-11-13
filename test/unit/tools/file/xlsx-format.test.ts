import { describe, it, expect } from 'vitest';
import { formatNumber, readStyles } from '../../../../src/tools/file/xlsx-format';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const parse = (xml: string): Document => new DOMParser().parseFromString(xml, 'application/xml');

describe('formatNumber', () => {
  it.each([
    ['General', 40000, '40000'],
    ['0', 3.7, '4'],
    ['0.00', 3.14159, '3.14'],
    ['#,##0', 1507296, '1,507,296'],
    ['#,##0.00', 1234.5, '1,234.50'],
    ['0%', 0.065, '7%'],
    ['0.0%', 0.065, '6.5%'],
    ['0.00%', 0.125, '12.50%'],
    ['$#,##0.00', 672, '$672.00'],
    ['#,##0\\ "€"', 1200, '1,200 €'],
    ['[$£-809]#,##0', 99, '£99'],
    ['#,##0;[Red]-#,##0', -1200, '-1,200'],
  ])('shows %s of %d as %s', (code, value, text) => {
    expect(formatNumber(value, code, 'en-US')).toBe(text);
  });

  it('keeps the raw text for a format it does not know', () => {
    expect(formatNumber(1.5, '# ?/?', 'en-US')).toBe('1.5');
  });

  it('shows a date serial as a date', () => {
    // 46189 is 2026-06-16 in the 1900 date system.
    expect(formatNumber(46189, 'yyyy-mm-dd', 'en-US')).toBe('Jun 16, 2026');
  });

  it('shows a date serial with a time when the format has hours', () => {
    expect(formatNumber(46189.5, 'm/d/yy h:mm', 'en-US')).toBe('Jun 16, 2026, 12:00 PM');
  });

  it('does not take the month in a number format for a date', () => {
    expect(formatNumber(5, '0 "min"', 'en-US')).toBe('5 min');
  });
});

describe('readStyles', () => {
  const styles = parse(`<?xml version="1.0"?><styleSheet xmlns="${NS}">
    <numFmts><numFmt numFmtId="164" formatCode="0.0%"/></numFmts>
    <fonts><font/><font><b/></font><font><b val="0"/></font></fonts>
    <cellXfs>
      <xf numFmtId="0" fontId="0"/>
      <xf numFmtId="3" fontId="1"/>
      <xf numFmtId="164" fontId="2"/>
      <xf numFmtId="14" fontId="0"/>
    </cellXfs>
  </styleSheet>`);

  it('reads no styles from a workbook without a styles part', () => {
    expect(readStyles(null)).toEqual([]);
  });

  it('maps each cell style to its format code and boldness', () => {
    expect(readStyles(styles)).toEqual([
      { code: 'General', bold: false },
      { code: '#,##0', bold: true },
      { code: '0.0%', bold: false },
      { code: 'm/d/yyyy', bold: false },
    ]);
  });
});
