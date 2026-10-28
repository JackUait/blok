import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import type * as SvgModule from '../../../../../../../src/tools/file/pptx/renderer/chart/svg';

// Drawing is stubbed so the test times the layout, not jsdom building nodes.
vi.mock('../../../../../../../src/tools/file/pptx/renderer/chart/svg', async (importOriginal) => {
  const actual = await importOriginal<typeof SvgModule>();

  return { ...actual, svg: vi.fn(), group: vi.fn(), text: vi.fn() };
});

import { text } from '../../../../../../../src/tools/file/pptx/renderer/chart/svg';
import { drawLegend } from '../../../../../../../src/tools/file/pptx/renderer/chart/legend';
import { model, series, STYLE } from './chartModel';

const root = (): Element => document.createElementNS('http://www.w3.org/2000/svg', 'svg');

/** x of each legend label, in drawing order. */
const labelXs = (): number[] => vi.mocked(text).mock.calls.map(([, x]) => x);

describe('legend layout', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('places top legend entries side by side, each after the one before', () => {
    const list = ['a', 'bbb', 'cc'].map((name) => series([1], { name }));

    drawLegend(model('bar', list, { legend: { position: 't' } }), { x: 0, y: 0, w: 1000, h: 300 }, root(), STYLE);
    const xs = labelXs();
    const pad = STYLE.size * 0.5;
    const width = (label: string): number => STYLE.size * 1.2 + STYLE.size * 0.4 + label.length * STYLE.size * 0.55;

    expect(xs[1] - xs[0]).toBeCloseTo(width('a') + pad, 6);
    expect(xs[2] - xs[1]).toBeCloseTo(width('bbb') + pad, 6);
  });

  it('lays out a bottom legend with 60k entries in linear time', () => {
    const list = Array.from({ length: 60_000 }, (_, i) => series([1], { name: 'x'.repeat(i % 3 + 1) }));
    const started = performance.now();

    drawLegend(model('bar', list, { legend: { position: 'b' } }), { x: 0, y: 0, w: 400, h: 300 }, root(), STYLE);
    const elapsed = performance.now() - started;
    const xs = labelXs();

    expect(xs).toHaveLength(60_000);
    expect(xs[59_999]).toBeGreaterThan(xs[59_998]);
    expect(elapsed).toBeLessThan(1000);
  });
});
