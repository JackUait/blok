import type { ImageMarkup, ImageMarkupShape, ImageMarkupStroke, ImageMarkupText } from '../../../../types/tools/image';
import type { Point, Size } from '../darkroom/camera';
import { smoothStroke, strokeOutline } from './freehand';
import { ARROW_HEAD_HALF_WIDTH, TEXT_LINE_HEIGHT, arrowHeadLength, contrastInk, isMarkupColor, shapeOutline } from './model';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FONT_FAMILY = "system-ui, -apple-system, 'Segoe UI', sans-serif";
/**
 * Highlighter blend passes, back to front. Multiply keeps dark ink under it dark;
 * screen keeps the colour visible over dark photo areas, where multiply alone turns muddy.
 * markup-editor.ts paints its live highlighter with the same passes.
 */
export const HIGHLIGHTER_PASSES: readonly { blend: string; opacity: string }[] = [
  { blend: 'multiply', opacity: '0.55' },
  { blend: 'screen', opacity: '0.4' },
];
const FILL_OPACITY = '0.2';
const OUTLINE_WIDTH = 0.16;
/** The head's concave back, in head lengths. */
const HEAD_BACK_PULL = 0.55;
/** The shaft stops inside the head, so its round cap never peeks out behind the notch. */
const SHAFT_INSET = 0.7;
const HEAD_SOFTEN = 0.35;
/**
 * Background box padding in fractions of the glyph box. The filter is shared by every
 * size of one colour, so this only approximates 0.25em (exact for a short single line).
 */
const BG_PAD_X = 0.08;
const BG_PAD_Y = 0.2;

interface LayerState { seq: number; size: string }

const counter = { layers: 0 };
const layers = new WeakMap<SVGSVGElement, LayerState>();
/** What each mark node was drawn from; reused while the data is the same. */
const drawn = new WeakMap<Element, { item: ImageMarkup; json: string }>();

const fmt = (n: number): string => String(Math.round(n * 100) / 100 + 0);

const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] => {
  const el = document.createElementNS(SVG_NS, tag);

  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);

  return el;
};

const ink = (color: string): string => (isMarkupColor(color) ? color.toLowerCase() : '#ffffff');

const isStroke = (m: ImageMarkup): m is ImageMarkupStroke => m.type === 'pen' || m.type === 'highlighter';
const isText = (m: ImageMarkup): m is ImageMarkupText => m.type === 'text';

const filterId = (state: LayerState, color: string): string => `blok-markup-bg-${state.seq}-${color.slice(1)}`;

const pointsPx = (item: ImageMarkupStroke, o: Size): number[] =>
  item.points.map((v, i) => {
    const axis = i % 3;

    if (axis === 0) return v * o.w;

    return axis === 1 ? v * o.h : v;
  });

const centreline = (pts: number[]): string => {
  const at = (i: number): Point => ({ x: pts[i * 3] ?? 0, y: pts[i * 3 + 1] ?? 0 });
  const n = Math.floor(pts.length / 3);
  const first = at(0);
  const last = at(Math.max(0, n - 1));
  const curves = Array.from({ length: Math.max(0, n - 2) }, (_, k) => {
    const p = at(k + 1);
    const next = at(k + 2);

    return `Q${fmt(p.x)} ${fmt(p.y)} ${fmt((p.x + next.x) / 2)} ${fmt((p.y + next.y) / 2)}`;
  });

  return `M${fmt(first.x)} ${fmt(first.y)}${curves.join('')}L${fmt(last.x)} ${fmt(last.y)}`;
};

const drawStroke = (item: ImageMarkupStroke, o: Size, width: number, color: string): SVGElement => {
  const pts = smoothStroke(pointsPx(item, o));

  if (item.type === 'pen') {
    const taper = { start: item.cut !== 'start' && item.cut !== 'both', end: item.cut !== 'end' && item.cut !== 'both' };

    return svgEl('path', { d: strokeOutline(pts, width, { taper }), fill: color });
  }

  const d = centreline(pts);
  const g = svgEl('g', {});

  for (const pass of HIGHLIGHTER_PASSES) {
    g.appendChild(svgEl('path', {
      d,
      fill: 'none',
      stroke: color,
      'stroke-width': fmt(width),
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      opacity: pass.opacity,
      style: `mix-blend-mode:${pass.blend}`,
    }));
  }

  return g;
};

const lineAttrs = (color: string, width: number): Record<string, string> => ({
  fill: 'none', stroke: color, 'stroke-width': fmt(width), 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
});

const drawArrow = (a: Point, b: Point, color: string, width: number): SVGElement[] => {
  const len = Math.hypot(b.x - a.x, b.y - a.y);

  if (len === 0) return [svgEl('path', { d: `M${fmt(a.x)} ${fmt(a.y)}L${fmt(b.x)} ${fmt(b.y)}`, ...lineAttrs(color, width) })];

  const head = arrowHeadLength(width, len);
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const back = (k: number): Point => ({ x: b.x - u.x * head * k, y: b.y - u.y * head * k });
  const base = back(1);
  const half = head * ARROW_HEAD_HALF_WIDTH;
  const wing = (s: number): string => `${fmt(base.x - u.y * half * s)} ${fmt(base.y + u.x * half * s)}`;
  const pull = back(HEAD_BACK_PULL);
  const end = back(SHAFT_INSET);

  return [
    svgEl('path', { d: `M${fmt(a.x)} ${fmt(a.y)}L${fmt(end.x)} ${fmt(end.y)}`, ...lineAttrs(color, width) }),
    svgEl('path', {
      d: `M${fmt(b.x)} ${fmt(b.y)}L${wing(1)}Q${fmt(pull.x)} ${fmt(pull.y)} ${wing(-1)}Z`,
      fill: color,
      stroke: color,
      'stroke-width': fmt(width * HEAD_SOFTEN),
      'stroke-linejoin': 'round',
    }),
  ];
};

const drawShape = (item: ImageMarkupShape, o: Size, width: number, color: string): SVGElement[] => {
  const a = { x: item.x1 * o.w, y: item.y1 * o.h };
  const b = { x: item.x2 * o.w, y: item.y2 * o.h };

  if (item.type === 'line') return [svgEl('path', { d: `M${fmt(a.x)} ${fmt(a.y)}L${fmt(b.x)} ${fmt(b.y)}`, ...lineAttrs(color, width) })];
  if (item.type === 'arrow') return drawArrow(a, b, color, width);

  const fill: Record<string, string> = item.fill === true ? { fill: color, 'fill-opacity': FILL_OPACITY } : { fill: 'none' };
  const paint = { stroke: color, 'stroke-width': fmt(width), 'stroke-linejoin': 'round', ...fill };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);

  const outline = shapeOutline(item, o);

  if (outline !== null) {
    const d = outline.map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(p.x)} ${fmt(p.y)}`).join('');

    return [svgEl('path', { d: `${d}Z`, ...paint })];
  }
  if (item.type === 'rect') return [svgEl('rect', { x: fmt(x), y: fmt(y), width: fmt(w), height: fmt(h), ...paint })];

  return [svgEl('ellipse', { cx: fmt(x + w / 2), cy: fmt(y + h / 2), rx: fmt(w / 2), ry: fmt(h / 2), ...paint })];
};

const drawText = (item: ImageMarkupText, o: Size, font: number, color: string, state: LayerState): SVGElement => {
  const cx = fmt(item.x * o.w);
  const cy = fmt(item.y * o.h);
  const lines = item.text.split('\n');
  const lineHeight = font * TEXT_LINE_HEIGHT;
  const el = svgEl('text', {
    x: cx,
    y: cy,
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    'font-family': FONT_FAMILY,
    'font-weight': '700',
    'font-size': fmt(font),
    fill: color,
  });

  if (item.rotation !== undefined && item.rotation !== 0) el.setAttribute('transform', `rotate(${fmt(item.rotation)} ${cx} ${cy})`);

  if (item.style === 'outline') {
    el.setAttribute('stroke', contrastInk(color));
    el.setAttribute('stroke-width', fmt(font * OUTLINE_WIDTH));
    el.setAttribute('stroke-linejoin', 'round');
    el.setAttribute('paint-order', 'stroke');
  } else if (item.style === 'background') {
    el.setAttribute('fill', contrastInk(color));
    el.setAttribute('filter', `url(#${filterId(state, color)})`);
  }

  lines.forEach((line, i) => {
    const span = svgEl('tspan', { x: cx, dy: fmt(i === 0 ? (-(lines.length - 1) / 2) * lineHeight : lineHeight) });

    // An empty tspan takes no line; a no-break space keeps the gap.
    span.textContent = line === '' ? ' ' : line;
    el.appendChild(span);
  });

  return el;
};

const drawMark = (item: ImageMarkup, o: Size, state: LayerState): SVGGElement => {
  const g = svgEl('g', { 'data-markup-id': item.id, 'data-markup-type': item.type });
  const px = item.size * Math.min(o.w, o.h);
  const color = ink(item.color);

  if (isStroke(item)) g.appendChild(drawStroke(item, o, px, color));
  else if (isText(item)) g.appendChild(drawText(item, o, px, color, state));
  else g.append(...drawShape(item, o, px, color));

  drawn.set(g, { item, json: JSON.stringify(item) });

  return g;
};

const unchanged = (el: Element, item: ImageMarkup): boolean => {
  const was = drawn.get(el);

  if (was === undefined) return false;
  // Same object means same drawing: callers must not mutate a mark after passing it in.
  if (was.item === item) return true;

  const json = JSON.stringify(item);

  if (json !== was.json) return false;
  drawn.set(el, { item, json });

  return true;
};

const defsOf = (svg: SVGSVGElement): Element => {
  const first = svg.firstElementChild;

  if (first !== null && first.localName === 'defs') return first;

  const defs = svgEl('defs');

  svg.insertBefore(defs, svg.firstChild);

  return defs;
};

const syncFilters = (defs: Element, markup: ImageMarkup[], state: LayerState): void => {
  const wanted = new Map<string, string>();

  for (const item of markup.filter((m): m is ImageMarkupText => isText(m) && m.style === 'background')) {
    const color = ink(item.color);

    wanted.set(filterId(state, color), color);
  }

  for (const filter of Array.from(defs.querySelectorAll('filter'))) {
    if (!wanted.delete(filter.id)) filter.remove();
  }

  for (const [id, color] of wanted) {
    const filter = svgEl('filter', {
      id, x: String(-BG_PAD_X), y: String(-BG_PAD_Y), width: String(1 + 2 * BG_PAD_X), height: String(1 + 2 * BG_PAD_Y),
    });

    filter.append(
      svgEl('feFlood', { 'flood-color': color, result: 'bg' }),
      svgEl('feComposite', { in: 'SourceGraphic', in2: 'bg', operator: 'over' })
    );
    defs.appendChild(filter);
  }
};

/** Draws `markup` into `svg`, reusing the node of every mark whose data and box are unchanged. */
export function updateMarkupLayer(svg: SVGSVGElement, markup: ImageMarkup[], o: Size): void {
  const state = layers.get(svg) ?? { seq: ++counter.layers, size: '' };
  const size = `${o.w}x${o.h}`;
  const defs = defsOf(svg);
  const existing = new Map<string, Element>();

  layers.set(svg, state);

  const resized = state.size !== size;

  if (resized) {
    state.size = size;
    svg.setAttribute('viewBox', `0 0 ${fmt(o.w)} ${fmt(o.h)}`);
  }

  // A new size redraws everything: every px value depends on it.
  for (const el of resized ? [] : Array.from(svg.children)) {
    const id = el.getAttribute('data-markup-id');

    if (id !== null && !existing.has(id)) existing.set(id, el);
  }

  const nodes = markup.map((item) => {
    const old = existing.get(item.id);

    existing.delete(item.id);

    return old !== undefined && unchanged(old, item) ? old : drawMark(item, o, state);
  });
  const keep = new Set<Node>([defs, ...nodes]);

  for (const stale of Array.from(svg.childNodes).filter((n) => !keep.has(n))) stale.remove();

  // Moves only the nodes that are out of place, so an unchanged layer is not touched.
  nodes.reduce<ChildNode | null>((cursor, node) => {
    if (node === cursor) return cursor.nextSibling;
    svg.insertBefore(node, cursor);

    return cursor;
  }, defs.nextSibling);

  syncFilters(defs, markup, state);
}

/** An inert overlay for the O box. With `o` null it stays empty until `updateMarkupLayer`. */
export function createMarkupLayer(markup: ImageMarkup[], o: Size | null): SVGSVGElement {
  const svg = svgEl('svg', {
    'data-role': 'image-markup',
    'aria-hidden': 'true',
    focusable: 'false',
    style: 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none',
  });

  if (o !== null) updateMarkupLayer(svg, markup, o);

  return svg;
}
