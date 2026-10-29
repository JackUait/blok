import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { chartXml, ser } from './chartXml';
import { n, part, parts, pathPoints, render, texts } from './renderXml';

const CATS = ['Speed', 'Power', 'Agility', 'Defense', 'Stamina'];
const A = [85, 70, 90, 65, 75];
const B = [70, 85, 65, 80, 90];

function radar(style: string, opts: { marker?: string; valAx?: string } = {}): string {
  return chartXml(`<c:radarChart><c:radarStyle val="${style}"/>
    ${ser({ name: 'A', order: 0, cats: CATS, vals: A, marker: opts.marker })}
    ${ser({ name: 'B', order: 1, cats: CATS, vals: B, marker: opts.marker })}
    <c:axId val="1"/><c:axId val="2"/></c:radarChart>
    <c:catAx><c:axId val="1"/><c:majorGridlines/></c:catAx>
    <c:valAx><c:axId val="2"/><c:majorGridlines/>${opts.valAx ?? ''}</c:valAx>`, { tail: '<c:legend><c:legendPos val="r"/></c:legend>' });
}

/** Centre and outer radius, read from the first spoke (centre to the top vertex). */
function geometry(frame: Element): { cx: number; cy: number; r: number } {
  const spoke = part(frame, 'radar-spoke');
  const cx = n(spoke, 'x1');
  const cy = n(spoke, 'y1');

  return { cx, cy, r: Math.hypot(n(spoke, 'x2') - cx, n(spoke, 'y2') - cy) };
}

describe('radar charts', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('puts each vertex on its spoke, clockwise from the top, at its share of the axis maximum', () => {
    const frame = render(radar('marker'));
    const { cx, cy, r } = geometry(frame);
    const polygons = parts(frame, 'series').map((g) => pathPoints(g.querySelector('[data-pptx-chart="radar-shape"]')?.getAttribute('d') ?? null));

    expect(polygons).toHaveLength(2);
    [A, B].forEach((values, si) => {
      expect(polygons[si]).toHaveLength(values.length);
      values.forEach((v, i) => {
        const angle = (i * 2 * Math.PI) / values.length;
        const [x, y] = polygons[si][i];

        expect(x).toBeCloseTo(cx + (r * v / 100) * Math.sin(angle), 1);
        expect(y).toBeCloseTo(cy - (r * v / 100) * Math.cos(angle), 1);
      });
    });
  });

  it('draws one spoke per category and one ring per major unit, labelled up the first spoke', () => {
    const frame = render(radar('marker'));

    expect(parts(frame, 'radar-spoke')).toHaveLength(5);
    expect(parts(frame, 'radar-ring')).toHaveLength(5);
    expect(texts(part(frame, 'value-axis'))).toEqual(['0', '20', '40', '60', '80', '100']);
  });

  it('keeps the scale the value axis declares', () => {
    const frame = render(radar('marker', { valAx: '<c:scaling><c:max val="100"/><c:min val="0"/></c:scaling><c:majorUnit val="25"/>' }));

    expect(parts(frame, 'radar-ring')).toHaveLength(4);
    expect(texts(part(frame, 'value-axis'))).toEqual(['0', '25', '50', '75', '100']);
  });

  it('writes category names beyond the spoke ends', () => {
    const frame = render(radar('marker'));
    const { cx, cy, r } = geometry(frame);
    const labels = [...part(frame, 'category-axis').querySelectorAll('text')];

    expect(labels.map((t) => t.textContent)).toEqual(CATS);
    labels.forEach((t) => expect(Math.hypot(n(t, 'x') - cx, n(t, 'y') - cy)).toBeGreaterThan(r));
  });

  it('fills the shapes of a filled radar and outlines the others', () => {
    const fill = (xml: string): string[] => parts(render(xml), 'radar-shape').map((p) => p.getAttribute('fill') ?? '');

    expect(fill(radar('filled')).map((f) => f.toLowerCase())).toEqual(['#4472c4', '#ed7d31']);
    expect(fill(radar('standard'))).toEqual(['none', 'none']);
  });

  it('draws markers on a marker radar unless the series turns them off', () => {
    const plotted = (xml: string): number => parts(render(xml), 'series').reduce((sum, g) => sum + g.querySelectorAll('[data-pptx-chart="marker"]').length, 0);

    expect(plotted(radar('marker'))).toBe(10);
    expect(plotted(radar('marker', { marker: '<c:marker><c:symbol val="none"/></c:marker>' }))).toBe(0);
    expect(plotted(radar('standard'))).toBe(0);
  });

  it('lists the series in the legend with line keys, or swatches when filled', () => {
    const lines = part(render(radar('standard')), 'legend');
    const filled = part(render(radar('filled')), 'legend');

    expect(texts(lines)).toEqual(['A', 'B']);
    expect(lines.querySelectorAll('line')).toHaveLength(2);
    expect(filled.querySelectorAll('rect')).toHaveLength(2);
  });
});
