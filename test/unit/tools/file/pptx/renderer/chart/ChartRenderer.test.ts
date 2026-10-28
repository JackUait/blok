import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { renderChart } from '../../../../../../../src/tools/file/pptx/renderer/ChartRenderer';
import type { ChartNodeData } from '../../../../../../../src/tools/file/pptx/model/nodes/ChartNode';
import { parseXml, SafeXmlNode } from '../../../../../../../src/tools/file/pptx/parser/XmlParser';
import { createMockRenderContext } from '../../helpers/mockContext';
import { chartXml, ser } from './chartXml';

const PATH = 'ppt/charts/chart1.xml';

function chartNode(w = 400, h = 600): ChartNodeData {
  return {
    id: '1', name: 'Chart', nodeType: 'chart', chartPath: PATH,
    position: { x: 10, y: 20 }, size: { w, h }, rotation: 0, flipH: false, flipV: false,
    source: new SafeXmlNode(null),
  };
}

function render(xml: string, size?: { w: number; h: number }): HTMLElement {
  const ctx = createMockRenderContext();
  ctx.presentation.charts.set(PATH, parseXml(xml));

  return renderChart(chartNode(size?.w, size?.h), ctx);
}

const n = (el: Element | null | undefined, attr: string): number => Number(el?.getAttribute(attr));
const parts = (root: Element, part: string): Element[] => [...root.querySelectorAll(`[data-pptx-chart="${part}"]`)];
const part = (root: Element, name: string): Element => {
  const found = root.querySelector(`[data-pptx-chart="${name}"]`);

  if (!found) {
    throw new Error(`no ${name}`);
  }

  return found;
};
const texts = (el: Element): string[] => [...el.querySelectorAll('text')].map((t) => t.textContent ?? '');
const plot = (root: Element): { x: number; y: number; w: number; h: number } => {
  const r = part(root, 'plot');

  return { x: n(r, 'x'), y: n(r, 'y'), w: n(r, 'width'), h: n(r, 'height') };
};
const seriesRects = (root: Element): Element[][] => parts(root, 'series').map((g) => [...g.querySelectorAll('rect')]);
/** Absolute points of an SVG path made of M/L commands. */
const pathPoints = (d: string | null): number[][] =>
  [...(d ?? '').matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

const bars = (grouping: string, extra = ''): string => chartXml(`<c:barChart><c:barDir val="col"/><c:grouping val="${grouping}"/>
  ${ser({ name: 'A', order: 0, cats: ['Q1', 'Q2'], vals: [10, 40] })}
  ${ser({ name: 'B', order: 1, cats: ['Q1', 'Q2'], vals: [20, 10] })}
  ${extra}</c:barChart><c:catAx/><c:valAx><c:majorGridlines/></c:valAx>`);

describe('renderChart', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  describe('frame', () => {
    it('positions the frame and fills it with an SVG of the same size', () => {
      const frame = render(bars('clustered'));
      const svg = frame.querySelector('svg');

      expect(frame.style.left).toBe('10px');
      expect(frame.style.top).toBe('20px');
      expect(frame.style.width).toBe('400px');
      expect(svg?.getAttribute('viewBox')).toBe('0 0 400 600');
    });

    it('draws an empty frame, without throwing, for a missing or unreadable chart part', () => {
      const ctx = createMockRenderContext();
      const missing = renderChart(chartNode(), ctx);

      ctx.presentation.charts.set(PATH, new SafeXmlNode(null));
      const broken = renderChart(chartNode(), ctx);

      expect(missing.style.width).toBe('400px');
      expect(missing.childElementCount).toBe(0);
      expect(missing.textContent).toBe('');
      expect(broken.querySelectorAll('[data-pptx-chart="series"]')).toHaveLength(0);
    });

    it('draws only the title for plot types it cannot draw', () => {
      const title = '<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>Skills</a:t></a:r></a:p></c:rich></c:tx></c:title>';
      const frame = render(chartXml(`<c:radarChart>${ser({ name: 'S', cats: ['a', 'b', 'c'], vals: [1, 2, 3] })}</c:radarChart>`, { head: title }));

      expect(texts(frame)).toEqual(['Skills']);
      expect(parts(frame, 'series')).toHaveLength(0);
    });

    it('puts deck text into SVG text nodes, never markup', () => {
      const evil = '&lt;img src=x onerror=alert(1)&gt;';
      const frame = render(chartXml(`<c:pieChart>${ser({ name: evil, cats: [evil], vals: [1] })}</c:pieChart>`,
        { head: '<c:autoTitleDeleted val="0"/>', tail: '<c:legend/>' }));

      expect(frame.querySelector('img')).toBeNull();
      expect(part(frame, 'title').textContent).toBe('<img src=x onerror=alert(1)>');
    });
  });

  describe('bars', () => {
    it('draws clustered column heights in proportion to values, series side by side', () => {
      const frame = render(bars('clustered'));
      const [a, b] = seriesRects(frame);
      const p = plot(frame);
      const perUnit = n(a[1], 'height') / 40;

      expect(n(a[0], 'height') / 10).toBeCloseTo(perUnit, 2);
      expect(n(b[0], 'height') / 20).toBeCloseTo(perUnit, 2);
      expect(n(a[0], 'y') + n(a[0], 'height')).toBeCloseTo(p.y + p.h, 2);
      expect(n(a[0], 'x') + n(a[0], 'width')).toBeLessThanOrEqual(n(b[0], 'x') + 0.001);
      expect(n(b[0], 'x')).toBeLessThan(n(a[1], 'x'));
    });

    it('colours series from the theme accent cycle', () => {
      const [a, b] = seriesRects(render(bars('clustered')));

      expect(a[0].getAttribute('fill')?.toLowerCase()).toBe('#4472c4');
      expect(b[0].getAttribute('fill')?.toLowerCase()).toBe('#ed7d31');
    });

    it('stacks series on top of each other', () => {
      const frame = render(bars('stacked'));
      const [a, b] = seriesRects(frame);

      expect(n(b[0], 'y') + n(b[0], 'height')).toBeCloseTo(n(a[0], 'y'), 2);
      expect(n(a[0], 'x')).toBeCloseTo(n(b[0], 'x'), 2);
      expect((n(a[0], 'height') + n(b[0], 'height')) / 30).toBeCloseTo(n(a[1], 'height') / 40, 2);
    });

    it('fills every percent-stacked column to 100%', () => {
      const frame = render(bars('percentStacked'));
      const [a, b] = seriesRects(frame);
      const p = plot(frame);

      expect(n(a[0], 'height') + n(b[0], 'height')).toBeCloseTo(p.h, 2);
      expect(n(a[1], 'height') + n(b[1], 'height')).toBeCloseTo(p.h, 2);
      expect(n(a[0], 'height') / p.h).toBeCloseTo(1 / 3, 2);
      expect(texts(part(frame, 'value-axis'))).toEqual(['0%', '10%', '20%', '30%', '40%', '50%', '60%', '70%', '80%', '90%', '100%']);
    });

    it('draws negative columns below the zero line', () => {
      const frame = render(chartXml(`<c:barChart><c:barDir val="col"/>${ser({ cats: ['a', 'b'], vals: [15, -8] })}</c:barChart><c:catAx/><c:valAx/>`));
      const [[up, down]] = seriesRects(frame);
      const zero = n(part(frame, 'category-axis').querySelector('line'), 'y1');

      expect(n(up, 'y') + n(up, 'height')).toBeCloseTo(zero, 2);
      expect(n(down, 'y')).toBeCloseTo(zero, 2);
      expect(n(down, 'height') / 8).toBeCloseTo(n(up, 'height') / 15, 2);
      expect(texts(part(frame, 'value-axis'))[0]).toBe('-10');
    });

    it('lays horizontal bars from the left axis with the first category at the bottom', () => {
      const frame = render(chartXml(`<c:barChart><c:barDir val="bar"/>${ser({ cats: ['first', 'second'], vals: [45, 15] })}</c:barChart><c:catAx/><c:valAx/>`));
      const [[first, second]] = seriesRects(frame);
      const p = plot(frame);

      expect(n(first, 'x')).toBeCloseTo(p.x, 2);
      expect(n(first, 'width') / 45).toBeCloseTo(n(second, 'width') / 15, 2);
      expect(n(first, 'y')).toBeGreaterThan(n(second, 'y'));
      expect(texts(part(frame, 'category-axis'))).toEqual(['first', 'second']);
    });

    it('varies colours by point for one series', () => {
      const [[first, second]] = seriesRects(render(chartXml(`<c:barChart>${ser({ cats: ['a', 'b'], vals: [1, 2] })}</c:barChart><c:catAx/><c:valAx/>`)));

      expect(first.getAttribute('fill')?.toLowerCase()).toBe('#4472c4');
      expect(second.getAttribute('fill')?.toLowerCase()).toBe('#ed7d31');
    });
  });

  describe('axes', () => {
    it('labels the value axis with the automatic scale and draws a gridline per tick', () => {
      const frame = render(chartXml(`<c:barChart>${ser({ order: 0, cats: ['a', 'b', 'c'], vals: [45, 61, 28] })}${ser({ order: 1, cats: ['a', 'b', 'c'], vals: [1, 1, 1] })}</c:barChart><c:catAx/><c:valAx><c:majorGridlines/></c:valAx>`));

      expect(texts(part(frame, 'value-axis'))).toEqual(['0', '10', '20', '30', '40', '50', '60', '70']);
      expect(part(frame, 'gridlines').querySelectorAll('line')).toHaveLength(8);
      expect(texts(part(frame, 'category-axis'))).toEqual(['a', 'b', 'c']);
    });

    it('fits the tick count to the whole plot area, labels included (oracle composite 0006)', () => {
      const txPr = '<c:txPr><a:bodyPr/><a:p><a:pPr><a:defRPr sz="1800"/></a:pPr></a:p></c:txPr>';
      const frame = render(chartXml(`<c:barChart>${ser({ order: 0, cats: ['a', 'b', 'c'], vals: [45, 61, 28] })}${ser({ order: 1, cats: ['a', 'b', 'c'], vals: [1, 1, 1] })}</c:barChart><c:catAx/><c:valAx/>`, { txPr }), { w: 600, h: 484 });

      expect(texts(part(frame, 'value-axis'))).toEqual(['0', '10', '20', '30', '40', '50', '60', '70']);
    });

    it('draws no gridlines when the axis has none', () => {
      const frame = render(chartXml(`<c:barChart>${ser({ cats: ['a'], vals: [5] })}</c:barChart><c:catAx/><c:valAx/>`));

      expect(parts(frame, 'gridlines')).toHaveLength(0);
    });

    it('formats tick labels with the axis number format, else the series format', () => {
      const axisFmt = render(chartXml(`<c:barChart>${ser({ cats: ['a'], vals: [2500] })}</c:barChart><c:catAx/><c:valAx><c:numFmt formatCode="#,##0" sourceLinked="0"/></c:valAx>`));
      const seriesFmt = render(chartXml(`<c:barChart>${ser({ cats: ['a'], vals: [0.5], formatCode: '0%' })}</c:barChart><c:catAx/><c:valAx/>`));

      expect(texts(part(axisFmt, 'value-axis'))).toContain('1,000');
      expect(texts(part(seriesFmt, 'value-axis'))).toContain('50%');
    });

    it('keeps the scale the axis declares', () => {
      const frame = render(chartXml(`<c:barChart>${ser({ cats: ['a'], vals: [5] })}</c:barChart><c:catAx/>
        <c:valAx><c:scaling><c:max val="20"/><c:min val="0"/></c:scaling><c:majorUnit val="5"/></c:valAx>`));

      expect(texts(part(frame, 'value-axis'))).toEqual(['0', '5', '10', '15', '20']);
    });

    it('survives absurd axis bounds and major units from a hostile file', () => {
      const frame = render(chartXml(`<c:barChart>${ser({ cats: ['a'], vals: [5] })}</c:barChart><c:catAx/>
        <c:valAx><c:scaling><c:max val="1e308"/><c:min val="-1e308"/></c:scaling><c:majorUnit val="1e-300"/></c:valAx>`));

      expect(seriesRects(frame)[0]).toHaveLength(1);
      expect(texts(part(frame, 'value-axis')).length).toBeLessThanOrEqual(201);
    });

    it('hides a deleted axis', () => {
      const frame = render(chartXml(`<c:barChart>${ser({ cats: ['a'], vals: [5] })}</c:barChart><c:catAx/><c:valAx><c:delete val="1"/></c:valAx>`));

      expect(parts(frame, 'value-axis')).toHaveLength(0);
    });
  });

  describe('lines and areas', () => {
    const lines = (grouping: string, extra = ''): string => chartXml(`<c:lineChart><c:grouping val="${grouping}"/>
      ${ser({ name: 'A', order: 0, cats: ['a', 'b', 'c'], vals: [10, 20, 40] })}
      ${ser({ name: 'B', order: 1, cats: ['a', 'b', 'c'], vals: [5, 5, 5], marker: '<c:marker><c:symbol val="none"/></c:marker>' })}
      ${extra}</c:lineChart><c:catAx/><c:valAx/>`);

    it('draws one point per category at band centres, heights in proportion', () => {
      const frame = render(lines('standard', '<c:marker val="1"/>'));
      const p = plot(frame);
      const pts = pathPoints(part(frame, 'series').querySelector('[data-pptx-chart="line"]')?.getAttribute('d') ?? null);
      const bottom = p.y + p.h;

      expect(pts).toHaveLength(3);
      expect(pts[0][0]).toBeCloseTo(p.x + p.w / 6, 2);
      expect((bottom - pts[2][1]) / 40).toBeCloseTo((bottom - pts[0][1]) / 10, 2);
    });

    it('draws markers unless the series turns them off', () => {
      const [a, b] = parts(render(lines('standard', '<c:marker val="1"/>')), 'series');

      expect(a.querySelectorAll('[data-pptx-chart="marker"]')).toHaveLength(3);
      expect(b.querySelectorAll('[data-pptx-chart="marker"]')).toHaveLength(0);
    });

    it('stacks line values', () => {
      const frame = render(lines('stacked'));
      const p = plot(frame);
      const [a, b] = parts(frame, 'series').map((g) => pathPoints(g.querySelector('[data-pptx-chart="line"]')?.getAttribute('d') ?? null));
      const bottom = p.y + p.h;

      expect((bottom - b[0][1]) / 15).toBeCloseTo((bottom - a[0][1]) / 10, 2);
    });

    it('breaks the line at a blank point', () => {
      const withGap = ser({ cats: ['a', 'b', 'c', 'd'], vals: [1, 2, 3, 4] }).replace('<c:pt idx="1"><c:v>2</c:v></c:pt>', '');
      const frame = render(chartXml(`<c:lineChart><c:grouping val="standard"/>${withGap}</c:lineChart><c:catAx/><c:valAx/>`));
      const d = part(frame, 'line').getAttribute('d') ?? '';

      expect(d.match(/M/g)).toHaveLength(2);
      expect(pathPoints(d)).toHaveLength(3);
    });

    it('draws a smoothed line as curves', () => {
      const smooth = ser({ cats: ['a', 'b', 'c'], vals: [1, 3, 2], extra: '<c:smooth val="1"/>' });
      const frame = render(chartXml(`<c:lineChart><c:grouping val="standard"/>${smooth}</c:lineChart><c:catAx/><c:valAx/>`));
      const d = part(frame, 'line').getAttribute('d') ?? '';

      expect(d.match(/C/g)).toHaveLength(2);
      expect(d).not.toContain('L');
    });

    it('stacks areas edge to edge on a midCat axis', () => {
      const frame = render(chartXml(`<c:areaChart><c:grouping val="stacked"/>
        ${ser({ order: 0, cats: ['a', 'b'], vals: [10, 20] })}${ser({ order: 1, cats: ['a', 'b'], vals: [10, 10] })}
        </c:areaChart><c:catAx/><c:valAx><c:crossBetween val="midCat"/></c:valAx>`));
      const p = plot(frame);
      const [, top] = parts(frame, 'series').map((g) => pathPoints(g.querySelector('[data-pptx-chart="area"]')?.getAttribute('d') ?? null));
      const [lower] = parts(frame, 'series').map((g) => pathPoints(g.querySelector('[data-pptx-chart="area"]')?.getAttribute('d') ?? null));

      expect(top[0][0]).toBeCloseTo(p.x, 2);
      expect(top[1][0]).toBeCloseTo(p.x + p.w, 2);
      expect(top.some(([, y]) => Math.abs(y - lower[0][1]) < 1e-6)).toBe(true);
    });
  });

  describe('pies', () => {
    it('lists categories in the legend with their slice colours', () => {
      const frame = render(chartXml(`<c:pieChart><c:varyColors val="1"/>${ser({ cats: ['x', 'y', 'z'], vals: [1, 1, 2] })}</c:pieChart>`, { tail: '<c:legend/>' }));
      const legend = part(frame, 'legend');
      const slices = part(frame, 'series').querySelectorAll('path');

      expect(texts(legend)).toEqual(['x', 'y', 'z']);
      expect(slices).toHaveLength(3);
      expect(slices[2].getAttribute('fill')?.toLowerCase()).toBe('#a5a5a5');
    });

    it('labels slices with percentages when dLbls asks for them', () => {
      const frame = render(chartXml(`<c:pieChart>${ser({ cats: ['x', 'y'], vals: [1, 3] })}
        <c:dLbls><c:showPercent val="1"/></c:dLbls></c:pieChart>`));

      expect(texts(part(frame, 'data-labels'))).toEqual(['25%', '75%']);
    });
  });

  describe('doughnuts', () => {
    const doughnut = (series: string): string => chartXml(`<c:doughnutChart>${series}<c:holeSize val="50"/></c:doughnutChart>`);

    it('cuts a hole in the middle', () => {
      const frame = render(doughnut(ser({ cats: ['x', 'y'], vals: [1, 3] })));
      const slices = [...part(frame, 'series').querySelectorAll('path')].map((p) => p.getAttribute('d') ?? '');

      expect(slices).toHaveLength(2);
      // A slice with a hole has an outer and an inner arc; a pie slice has one.
      slices.forEach((d) => expect(d.match(/A/g)).toHaveLength(2));
    });

    it('draws one ring per series', () => {
      const frame = render(doughnut(ser({ order: 0, cats: ['x', 'y'], vals: [1, 3] }) + ser({ order: 1, cats: ['x', 'y'], vals: [2, 2] })));

      expect(parts(frame, 'series')).toHaveLength(2);
      expect(parts(frame, 'series').map((g) => g.querySelectorAll('path').length)).toEqual([2, 2]);
    });
  });

  describe('scatter', () => {
    it('places points by their x values and hides a line set to noFill', () => {
      const frame = render(chartXml(`<c:scatterChart><c:scatterStyle val="lineMarker"/>
        ${ser({ xs: [0, 5, 10], vals: [1, 2, 3], spPr: '<a:ln><a:noFill/></a:ln>' })}</c:scatterChart>
        <c:valAx><c:axPos val="b"/></c:valAx><c:valAx><c:axPos val="l"/></c:valAx>`));
      const series = part(frame, 'series');
      const markers = [...series.querySelectorAll('[data-pptx-chart="marker"]')];
      const xs = markers.map((m) => n(m, 'data-x'));

      expect(series.querySelector('[data-pptx-chart="line"]')).toBeNull();
      expect(markers).toHaveLength(3);
      expect(xs[1] - xs[0]).toBeCloseTo(xs[2] - xs[1], 2);
    });
  });

  describe('legend and labels', () => {
    it('lists series in order and reserves room on the side it names', () => {
      const right = render(bars('clustered'), undefined);
      const top = render(chartXml(`<c:barChart>${ser({ name: 'A', order: 0, cats: ['a'], vals: [1] })}${ser({ name: 'B', order: 1, cats: ['a'], vals: [2] })}</c:barChart><c:catAx/><c:valAx/>`, { tail: '<c:legend><c:legendPos val="t"/></c:legend>' }));
      const noLegend = plot(right);

      expect(parts(right, 'legend')).toHaveLength(0);
      expect(texts(part(top, 'legend'))).toEqual(['A', 'B']);
      expect(plot(top).y).toBeGreaterThan(noLegend.y);
    });

    it('lists stacked line and area series top-down, as they stack', () => {
      const area = render(chartXml(`<c:areaChart><c:grouping val="stacked"/>${ser({ name: 'A', order: 0, cats: ['a'], vals: [1] })}${ser({ name: 'B', order: 1, cats: ['a'], vals: [2] })}</c:areaChart><c:catAx/><c:valAx/>`, { tail: '<c:legend/>' }));

      expect(texts(part(area, 'legend'))).toEqual(['B', 'A']);
    });

    it('writes formatted values on bars when dLbls shows values', () => {
      const frame = render(chartXml(`<c:barChart>${ser({ order: 0, cats: ['a', 'b'], vals: [1234.5, 20], formatCode: '#,##0.0' })}${ser({ order: 1, cats: ['a', 'b'], vals: [1, 1] })}
        <c:dLbls><c:showVal val="1"/></c:dLbls></c:barChart><c:catAx/><c:valAx/>`));

      expect(texts(part(frame, 'data-labels'))).toEqual(['1,234.5', '20.0', '1', '1']);
    });
  });
});
