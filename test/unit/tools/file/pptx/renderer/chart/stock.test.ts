import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { chartXml, ser } from './chartXml';
import { n, part, parts, render, texts, yOn } from './renderXml';

const CATS = ['Jan', 'Feb', 'Mar'];
const NO_LINE = '<a:ln><a:noFill/></a:ln>';
const AXES = '<c:catAx><c:axId val="1"/></c:catAx><c:valAx><c:axId val="2"/></c:valAx>';

function stock(list: { name: string; vals: number[]; marker?: string }[], plotExtra: string): string {
  const sers = list.map((s, i) => ser({ name: s.name, order: i, cats: CATS, vals: s.vals, spPr: NO_LINE, marker: s.marker ?? '<c:marker><c:symbol val="none"/></c:marker>' })).join('');

  return chartXml(`<c:stockChart>${sers}${plotExtra}<c:axId val="1"/><c:axId val="2"/></c:stockChart>${AXES}`, { tail: '<c:legend><c:legendPos val="b"/></c:legend>' });
}

const HIGH = [55, 57, 60];
const LOW = [44, 46, 50];
const CLOSE = [50, 55, 52];
const OPEN = [48, 54, 57];
const hlc = (extra = '<c:hiLowLines/>'): string => stock([
  { name: 'High', vals: HIGH },
  { name: 'Low', vals: LOW },
  { name: 'Close', vals: CLOSE, marker: '<c:marker><c:symbol val="dash"/><c:size val="7"/></c:marker>' },
], extra);
const ohlc = (upDown: string): string => stock([
  { name: 'Open', vals: OPEN },
  { name: 'High', vals: HIGH },
  { name: 'Low', vals: LOW },
  { name: 'Close', vals: CLOSE },
], `<c:hiLowLines/>${upDown}`);

describe('stock charts', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('draws a high-low line per category from the low to the high value', () => {
    const frame = render(hlc());
    const axis = part(frame, 'value-axis');
    const lines = parts(frame, 'hi-low');

    expect(lines).toHaveLength(3);
    lines.forEach((l, i) => {
      expect(n(l, 'x1')).toBeCloseTo(n(l, 'x2'), 3);
      expect(Math.min(n(l, 'y1'), n(l, 'y2'))).toBeCloseTo(yOn(axis, HIGH[i]), 1);
      expect(Math.max(n(l, 'y1'), n(l, 'y2'))).toBeCloseTo(yOn(axis, LOW[i]), 1);
    });
    expect(n(lines[1], 'x1')).toBeGreaterThan(n(lines[0], 'x1'));
  });

  it('marks the close with the series marker on its high-low line', () => {
    const frame = render(hlc());
    const markers = parts(frame, 'series').flatMap((g) => [...g.querySelectorAll('[data-pptx-chart="marker"]')]);
    const lines = parts(frame, 'hi-low');
    const axis = part(frame, 'value-axis');

    expect(markers).toHaveLength(3);
    markers.forEach((m, i) => {
      expect(n(m, 'data-x')).toBeCloseTo(n(lines[i], 'x1'), 3);
      expect(n(m, 'data-y')).toBeCloseTo(yOn(axis, CLOSE[i]), 1);
    });
  });

  it('draws no high-low lines unless the plot asks for them', () => {
    expect(parts(render(hlc('')), 'hi-low')).toHaveLength(0);
  });

  it('draws up bars where the close beats the open and down bars elsewhere, from open to close', () => {
    const frame = render(ohlc('<c:upDownBars><c:gapWidth val="150"/><c:upBars/><c:downBars/></c:upDownBars>'));
    const axis = part(frame, 'value-axis');
    const up = parts(frame, 'up-bar');
    const down = parts(frame, 'down-bar');

    expect(up).toHaveLength(2);
    expect(down).toHaveLength(1);
    expect(n(up[0], 'y')).toBeCloseTo(yOn(axis, CLOSE[0]), 1);
    expect(n(up[0], 'y') + n(up[0], 'height')).toBeCloseTo(yOn(axis, OPEN[0]), 1);
    expect(n(down[0], 'y')).toBeCloseTo(yOn(axis, OPEN[2]), 1);
    expect(n(down[0], 'y') + n(down[0], 'height')).toBeCloseTo(yOn(axis, CLOSE[2]), 1);
    expect(up[0].getAttribute('fill')?.toLowerCase()).toBe('#ffffff');
    expect(down[0].getAttribute('fill')?.toLowerCase()).toBe('#000000');
  });

  it('fills up and down bars with the colours the deck gives them', () => {
    const fill = (c: string): string => `<c:spPr><a:solidFill><a:srgbClr val="${c}"/></a:solidFill></c:spPr>`;
    const frame = render(ohlc(`<c:upDownBars><c:upBars>${fill('00B050')}</c:upBars><c:downBars>${fill('FF0000')}</c:downBars></c:upDownBars>`));

    expect(parts(frame, 'up-bar')[0].getAttribute('fill')?.toLowerCase()).toBe('#00b050');
    expect(parts(frame, 'down-bar')[0].getAttribute('fill')?.toLowerCase()).toBe('#ff0000');
  });

  it('lists every series in the legend and labels the categories', () => {
    const frame = render(hlc());

    expect(texts(part(frame, 'legend'))).toEqual(['High', 'Low', 'Close']);
    expect(texts(part(frame, 'category-axis'))).toEqual(CATS);
  });

  it('draws volume bars and prices together, the prices on the secondary axis', () => {
    const volume = ser({ name: 'Volume', order: 0, cats: CATS, vals: [1000, 3000, 2000] });
    const prices = [['High', HIGH], ['Low', LOW], ['Close', CLOSE]] as const;
    const sers = prices.map(([name, vals], i) => ser({ name, order: i + 1, cats: CATS, vals: [...vals], spPr: NO_LINE })).join('');
    const frame = render(chartXml(`<c:barChart><c:barDir val="col"/>${volume}<c:axId val="1"/><c:axId val="2"/></c:barChart>
      <c:stockChart>${sers}<c:hiLowLines/><c:axId val="3"/><c:axId val="4"/></c:stockChart>
      ${AXES}<c:catAx><c:axId val="3"/><c:delete val="1"/></c:catAx><c:valAx><c:axId val="4"/><c:axPos val="r"/></c:valAx>`));
    const lines = parts(frame, 'hi-low');

    expect(lines).toHaveLength(3);
    expect(Math.min(n(lines[2], 'y1'), n(lines[2], 'y2'))).toBeCloseTo(yOn(part(frame, 'secondary-value-axis'), HIGH[2]), 1);
    expect(parts(frame, 'series')[0].querySelectorAll('rect')).toHaveLength(3);
  });
});
