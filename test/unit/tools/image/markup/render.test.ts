import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ImageMarkup, ImageMarkupShape, ImageMarkupStroke, ImageMarkupText } from '../../../../../types/tools/image';
import type { Size } from '../../../../../src/tools/image/darkroom/camera';
import { createMarkupLayer, updateMarkupLayer } from '../../../../../src/tools/image/markup/render';

const SVG_NS = 'http://www.w3.org/2000/svg';
const O: Size = { w: 1000, h: 500 };

const pen = (over: Partial<ImageMarkupStroke> = {}): ImageMarkupStroke => ({
  id: 'p1', type: 'pen', color: '#ff3b30', points: [0.1, 0.1, 0.5, 0.2, 0.2, 0.5, 0.3, 0.1, 0.5], size: 0.01, ...over,
});
const shape = (over: Partial<ImageMarkupShape> = {}): ImageMarkupShape => ({
  id: 's1', type: 'rect', color: '#0a84ff', x1: 0.5, y1: 0.6, x2: 0.1, y2: 0.2, size: 0.01, ...over,
});
const text = (over: Partial<ImageMarkupText> = {}): ImageMarkupText => ({
  id: 't1', type: 'text', color: '#ffcc00', x: 0.5, y: 0.5, text: 'Hi', size: 0.06, ...over,
});

const marks = (svg: SVGSVGElement): Element[] => Array.from(svg.querySelectorAll('[data-markup-id]'));
const mark = (svg: SVGSVGElement, id: string): Element => {
  const el = svg.querySelector(`[data-markup-id="${id}"]`);

  if (el === null) throw new Error(`no mark ${id}`);

  return el;
};
const child = (el: Element, selector: string): Element => {
  const found = el.querySelector(selector);

  if (found === null) throw new Error(`no ${selector}`);

  return found;
};
const num = (el: Element, attr: string): number => Number(el.getAttribute(attr));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createMarkupLayer', () => {
  it('builds an inert, full-size svg in the svg namespace', () => {
    const svg = createMarkupLayer([], O);
    const style = svg.getAttribute('style') ?? '';

    expect(svg.namespaceURI).toBe(SVG_NS);
    expect(svg.getAttribute('data-role')).toBe('image-markup');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(svg.getAttribute('viewBox')).toBe('0 0 1000 500');
    expect(svg.hasAttribute('preserveAspectRatio')).toBe(false);
    expect(style).toContain('position:absolute');
    expect(style).toContain('inset:0');
    expect(style).toContain('width:100%');
    expect(style).toContain('height:100%');
    expect(style).toContain('pointer-events:none');
    expect(style).not.toContain('overflow');
  });

  it('stays empty without a size until updated', () => {
    const svg = createMarkupLayer([pen()], null);

    expect(svg.hasAttribute('viewBox')).toBe(false);
    expect(marks(svg)).toHaveLength(0);

    updateMarkupLayer(svg, [pen()], O);

    expect(svg.getAttribute('viewBox')).toBe('0 0 1000 500');
    expect(marks(svg)).toHaveLength(1);
  });

  it('draws one element per mark, back to front, tagged with id and type', () => {
    const svg = createMarkupLayer([pen(), shape(), text()], O);

    expect(marks(svg).map((el) => [el.getAttribute('data-markup-id'), el.getAttribute('data-markup-type')])).toEqual([
      ['p1', 'pen'], ['s1', 'rect'], ['t1', 'text'],
    ]);
    expect(marks(svg).every((el) => el.parentNode === svg)).toBe(true);
  });
});

describe('marks', () => {
  it('draws a pen stroke as a filled outline', () => {
    const path = child(mark(createMarkupLayer([pen()], O), 'p1'), 'path');

    expect(path.getAttribute('fill')).toBe('#ff3b30');
    expect(path.getAttribute('d')).toMatch(/^M.*Z$/);
    expect(path.hasAttribute('stroke')).toBe(false);
  });

  it('draws an eraser-cut pen end blunt, so the cut is as wide as the ink', () => {
    const straight = { points: [0.1, 0.2, 0.5, 0.5, 0.2, 0.5], size: 0.02 };
    const cut = child(mark(createMarkupLayer([pen({ ...straight, cut: 'start' })], O), 'p1'), 'path').getAttribute('d') ?? '';
    const whole = child(mark(createMarkupLayer([pen(straight)], O), 'p1'), 'path').getAttribute('d') ?? '';
    const reachAt = (d: string, x: number): number =>
      Math.max(0, ...Array.from(d.matchAll(/(-?\d*\.?\d+) (-?\d*\.?\d+)/g), (m) => [Number(m[1]), Number(m[2])])
        .filter(([px]) => Math.abs((px ?? 0) - x) <= 3).map(([, py]) => Math.abs((py ?? 0) - 100)));

    expect(reachAt(cut, 103)).toBeGreaterThan(4.5);
    expect(reachAt(whole, 103)).toBeLessThan(4);
    expect(reachAt(cut, 497)).toBeLessThan(4);
  });

  it('draws a highlighter as a flat stroke in two passes: multiply keeps ink dark, screen keeps it bright on dark photos', () => {
    const svg = createMarkupLayer([pen({ id: 'h', type: 'highlighter', color: '#ffcc00', size: 0.03 })], O);
    const paths = Array.from(mark(svg, 'h').querySelectorAll('path'));

    expect(paths.map((p) => p.getAttribute('style'))).toEqual(['mix-blend-mode:multiply', 'mix-blend-mode:screen']);
    expect(paths.map((p) => p.getAttribute('opacity'))).toEqual(['0.55', '0.4']);
    for (const path of paths) {
      expect(path.getAttribute('fill')).toBe('none');
      expect(path.getAttribute('stroke')).toBe('#ffcc00');
      expect(num(path, 'stroke-width')).toBe(15);
      expect(path.getAttribute('stroke-linecap')).toBe('round');
      expect(path.getAttribute('stroke-linejoin')).toBe('round');
      expect(path.getAttribute('d')).toMatch(/^M100 50/);
    }
  });

  it('draws a one-point highlighter as a dot', () => {
    const svg = createMarkupLayer([pen({ id: 'h', type: 'highlighter', points: [0.5, 0.5, 0.5] })], O);

    expect(child(mark(svg, 'h'), 'path').getAttribute('d')).toBe('M500 250L500 250');
  });

  it('draws a rect on its normalised box in O px', () => {
    const rect = child(mark(createMarkupLayer([shape()], O), 's1'), 'rect');

    expect([num(rect, 'x'), num(rect, 'y'), num(rect, 'width'), num(rect, 'height')]).toEqual([100, 100, 400, 200]);
    expect(rect.getAttribute('stroke')).toBe('#0a84ff');
    expect(num(rect, 'stroke-width')).toBe(5);
    expect(rect.getAttribute('stroke-linejoin')).toBe('round');
    expect(rect.getAttribute('fill')).toBe('none');
  });

  it.each(['rounded-rect', 'star', 'polygon', 'bubble'] as const)('draws a %s as a closed outline path', (type) => {
    const item = shape({ id: 'x', type, ...(type === 'bubble' ? { tx: 0.1, ty: 0.9 } : {}) });
    const path = child(mark(createMarkupLayer([item], O), 'x'), 'path');

    expect(path.getAttribute('d')).toMatch(/^M[\d. ]+(L[\d. -]+)+Z$/);
    expect(path.getAttribute('stroke')).toBe('#0a84ff');
    expect(num(path, 'stroke-width')).toBe(5);
    expect(path.getAttribute('fill')).toBe('none');
    const filled = child(mark(createMarkupLayer([{ ...item, fill: true }], O), 'x'), 'path');

    expect(filled.getAttribute('fill')).toBe('#0a84ff');
    expect(filled.getAttribute('fill-opacity')).toBe('0.2');
  });

  it('fills a rect and an ellipse with a translucent wash of their colour', () => {
    const svg = createMarkupLayer([shape({ fill: true }), shape({ id: 'e', type: 'ellipse', fill: true })], O);
    const rect = child(mark(svg, 's1'), 'rect');
    const ellipse = child(mark(svg, 'e'), 'ellipse');

    expect(rect.getAttribute('fill')).toBe('#0a84ff');
    expect(rect.getAttribute('fill-opacity')).toBe('0.2');
    expect([num(ellipse, 'cx'), num(ellipse, 'cy'), num(ellipse, 'rx'), num(ellipse, 'ry')]).toEqual([300, 200, 200, 100]);
    expect(ellipse.getAttribute('fill-opacity')).toBe('0.2');
  });

  it('draws a line between its points with round caps', () => {
    const svg = createMarkupLayer([shape({ type: 'line', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6 })], O);
    const path = child(mark(svg, 's1'), 'path');

    expect(path.getAttribute('d')).toBe('M100 100L500 300');
    expect(path.getAttribute('stroke-linecap')).toBe('round');
    expect(path.getAttribute('fill')).toBe('none');
  });

  it('draws an arrow as a shaft hidden under a filled head at the tip', () => {
    // 400 px shaft, 5 px stroke: head = max(20, min(48, 50)) = 48
    const svg = createMarkupLayer([shape({ type: 'arrow', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.2 })], O);
    const [shaft, head] = Array.from(mark(svg, 's1').querySelectorAll('path'));
    const shaftEnd = Number((shaft?.getAttribute('d') ?? '').split(/[ML ]/).filter(Boolean)[2]);
    const headD = head?.getAttribute('d') ?? '';

    expect(shaft?.getAttribute('fill')).toBe('none');
    expect(shaftEnd).toBeGreaterThan(500 - 48);
    expect(shaftEnd).toBeLessThan(500 - 48 * 0.5);
    expect(head?.getAttribute('fill')).toBe('#0a84ff');
    expect(headD.startsWith('M500 100')).toBe(true);
    expect(headD).toContain('Q');
    expect(headD.endsWith('Z')).toBe(true);
  });

  it('draws text centred on its point, one tspan per line, never as html', () => {
    const svg = createMarkupLayer([text({ text: '<b>a</b>\nsecond' })], O);
    const el = child(mark(svg, 't1'), 'text');
    const spans = Array.from(el.querySelectorAll('tspan'));

    expect(el.getAttribute('text-anchor')).toBe('middle');
    expect(el.getAttribute('dominant-baseline')).toBe('central');
    expect(el.getAttribute('font-weight')).toBe('700');
    expect(el.getAttribute('font-family')).toContain('system-ui');
    expect(num(el, 'font-size')).toBe(30);
    expect(el.getAttribute('fill')).toBe('#ffcc00');
    expect(el.querySelector('b')).toBeNull();
    expect(spans.map((s) => s.textContent)).toEqual(['<b>a</b>', 'second']);
    expect(spans.map((s) => num(s, 'x'))).toEqual([500, 500]);
    // Two lines of 37.5 px, centred on y = 250
    expect(num(el, 'y')).toBe(250);
    expect(spans.map((s) => num(s, 'dy'))).toEqual([-18.75, 37.5]);
  });

  it('keeps an empty line as a line', () => {
    const el = child(mark(createMarkupLayer([text({ text: 'a\n\nb' })], O), 't1'), 'text');

    expect(el.querySelectorAll('tspan')).toHaveLength(3);
  });

  it('turns text about its centre', () => {
    const el = child(mark(createMarkupLayer([text({ rotation: -30 })], O), 't1'), 'text');

    expect(el.getAttribute('transform')).toBe('rotate(-30 500 250)');
    expect(child(mark(createMarkupLayer([text()], O), 't1'), 'text').hasAttribute('transform')).toBe(false);
  });

  it('outlines text with the contrasting ink behind the glyphs', () => {
    const el = child(mark(createMarkupLayer([text({ style: 'outline' })], O), 't1'), 'text');

    expect(el.getAttribute('stroke')).toBe('#111111');
    expect(num(el, 'stroke-width')).toBeCloseTo(4.8, 6);
    expect(el.getAttribute('paint-order')).toBe('stroke');
    expect(el.getAttribute('stroke-linejoin')).toBe('round');
  });

  it('paints a background box through a per-layer, per-colour filter', () => {
    const svg = createMarkupLayer([text({ style: 'background' }), text({ id: 't2', style: 'background' })], O);
    const el = child(mark(svg, 't1'), 'text');
    const filterRef = el.getAttribute('filter') ?? '';
    const id = /^url\(#(.+)\)$/.exec(filterRef)?.[1] ?? '';
    const filter = svg.querySelector(`filter[id="${id}"]`);

    expect(el.getAttribute('fill')).toBe('#111111');
    expect(filter).not.toBeNull();
    expect(filter?.querySelector('feFlood')?.getAttribute('flood-color')).toBe('#ffcc00');
    expect(filter?.querySelector('feComposite')?.getAttribute('operator')).toBe('over');
    expect(filter?.querySelector('feComposite')?.getAttribute('in')).toBe('SourceGraphic');
    expect(Number(filter?.getAttribute('x'))).toBeLessThan(0);
    expect(Number(filter?.getAttribute('height'))).toBeGreaterThan(1);
    expect(svg.querySelectorAll('filter')).toHaveLength(1);
    expect(child(mark(svg, 't2'), 'text').getAttribute('filter')).toBe(filterRef);
  });

  it('gives each layer its own filter ids', () => {
    const a = createMarkupLayer([text({ style: 'background' })], O);
    const b = createMarkupLayer([text({ style: 'background' })], O);

    expect(a.querySelector('filter')?.id).not.toBe(b.querySelector('filter')?.id);
  });

  it('falls back to white for a colour that is not #rrggbb', () => {
    const svg = createMarkupLayer([pen({ color: 'url(javascript:alert(1))' })], O);

    expect(child(mark(svg, 'p1'), 'path').getAttribute('fill')).toBe('#ffffff');
  });

  it('sizes strokes from the short side', () => {
    const svg = createMarkupLayer([shape({ size: 0.02 })], { w: 300, h: 800 });

    expect(num(child(mark(svg, 's1'), 'rect'), 'stroke-width')).toBe(6);
  });
});

describe('updateMarkupLayer', () => {
  it('reuses the node of an unchanged mark', () => {
    const svg = createMarkupLayer([pen(), shape()], O);
    const before = mark(svg, 'p1');

    updateMarkupLayer(svg, [pen(), shape()], O);

    expect(mark(svg, 'p1')).toBe(before);
  });

  it('reorders, removes and adds marks by id', () => {
    const svg = createMarkupLayer([pen(), shape(), text()], O);
    const p = mark(svg, 'p1');
    const t = mark(svg, 't1');

    updateMarkupLayer(svg, [text(), pen(), shape({ id: 's9' })], O);

    expect(marks(svg).map((el) => el.getAttribute('data-markup-id'))).toEqual(['t1', 'p1', 's9']);
    expect(mark(svg, 'p1')).toBe(p);
    expect(mark(svg, 't1')).toBe(t);
  });

  it('redraws a mark whose data changed', () => {
    const svg = createMarkupLayer([shape()], O);

    updateMarkupLayer(svg, [shape({ x1: 0.9 })], O);

    expect(num(child(mark(svg, 's1'), 'rect'), 'width')).toBe(800);
    expect(marks(svg)).toHaveLength(1);
  });

  it('redraws everything when the box size changes', () => {
    const svg = createMarkupLayer([shape()], O);
    const before = mark(svg, 's1');

    updateMarkupLayer(svg, [shape()], { w: 500, h: 250 });

    expect(svg.getAttribute('viewBox')).toBe('0 0 500 250');
    expect(mark(svg, 's1')).not.toBe(before);
    expect(num(child(mark(svg, 's1'), 'rect'), 'stroke-width')).toBe(2.5);
  });

  it('drops filters no mark uses any more', () => {
    const svg = createMarkupLayer([text({ style: 'background' })], O);

    updateMarkupLayer(svg, [text({ style: 'background', color: '#ff3b30' })], O);

    expect(Array.from(svg.querySelectorAll('feFlood')).map((f) => f.getAttribute('flood-color'))).toEqual(['#ff3b30']);

    updateMarkupLayer(svg, [], O);

    expect(svg.querySelectorAll('filter')).toHaveLength(0);
    expect(marks(svg)).toHaveLength(0);
  });

  it('draws a duplicate id twice instead of moving one node', () => {
    const svg = createMarkupLayer([], O);

    updateMarkupLayer(svg, [pen(), pen()], O);

    expect(marks(svg)).toHaveLength(2);
  });

  it('accepts every mark type in one pass', () => {
    const all: ImageMarkup[] = [
      pen(), pen({ id: 'h', type: 'highlighter' }), shape(), shape({ id: 'e', type: 'ellipse' }),
      shape({ id: 'l', type: 'line' }), shape({ id: 'a', type: 'arrow' }), text(),
    ];

    expect(marks(createMarkupLayer(all, O))).toHaveLength(7);
  });
});
