import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { drawPie, pieSlices } from '../../../../../../../src/tools/file/pptx/renderer/chart/pie';
import { extractNumericValues, formatValue } from '../../../../../../../src/tools/file/pptx/renderer/chart/format';
import type { SafeXmlNode } from '../../../../../../../src/tools/file/pptx/parser/XmlParser';
import { model, series, STYLE } from './chartModel';

const BOX = { x: 0, y: 0, w: 400, h: 300 };

/** A node that answers every query with nothing, like a missing XML element. */
const missing = {
  exists: () => false, children: () => [], child: () => missing, numAttr: () => undefined, text: () => '',
};

/** A numRef whose cache holds `count` points, all at index 0, without parsing megabytes of XML. */
const numRefWithPoints = (count: number): SafeXmlNode => {
  const point = { numAttr: () => 0, child: () => ({ text: () => '7' }) };
  const points = Array.from({ length: count }, () => point);
  const cache = {
    exists: () => true,
    children: (name: string) => (name === 'pt' ? points : []),
    child: () => missing,
  };
  const ref = { child: (name: string) => (name === 'numRef' ? { child: () => cache } : missing) };

  return ref as unknown as SafeXmlNode;
};

describe('charts with hostile numbers', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  describe('format codes asking for absurd precision', () => {
    const digits = (count: number): string => '0'.repeat(count);

    it('formats a percent that asks for more than 100 decimals', () => {
      expect(() => formatValue(0.5, `0.${digits(101)}%`)).not.toThrow();
      expect(formatValue(0.5, `0.${digits(101)}%`)).toMatch(/^50\.0+%$/);
    });

    it('formats a plain number that asks for more than 100 decimals', () => {
      expect(formatValue(1.5, `0.${digits(101)}`)).toBe('1.5');
    });

    it('formats a grouped number that asks for more than 100 decimals', () => {
      expect(() => formatValue(1234.5, `#,##0.${digits(101)}`)).not.toThrow();
      expect(formatValue(1234.5, `#,##0.${digits(101)}`)).toMatch(/^1,234\.50+$/);
    });

    it('shows at most 20 decimals for a grouped number', () => {
      const [, fraction] = formatValue(1234.5, `#,##0.${digits(25)}`).split('.');

      expect(fraction).toHaveLength(20);
    });
  });

  describe('very long series', () => {
    it('reads a cache with a million points', () => {
      expect(() => extractNumericValues(numRefWithPoints(1_000_000))).not.toThrow();
      expect(extractNumericValues(numRefWithPoints(1_000_000))).toEqual([7]);
    });

    it('draws a pie whose explosion list has a million entries', () => {
      const root = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const explosion = new Array<number>(1_000_000).fill(0);

      explosion[0] = 20;
      expect(() => drawPie(model('pie', [series([1, 1], { explosion })]), BOX, root, STYLE)).not.toThrow();
      expect(root.querySelectorAll('path')).toHaveLength(2);
    });

    it('lays out the slices of a 100k-point pie in linear time', () => {
      const values = new Array<number>(100_000).fill(1);
      const started = performance.now();
      const slices = pieSlices(values, 0);
      const elapsed = performance.now() - started;

      expect(slices[slices.length - 1].end).toBeCloseTo(360, 6);
      expect(slices[50_000].start).toBeCloseTo(180, 6);
      expect(elapsed).toBeLessThan(500);
    });
  });
});
