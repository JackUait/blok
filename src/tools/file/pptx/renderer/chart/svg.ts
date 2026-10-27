const SVG_NS = 'http://www.w3.org/2000/svg';

export type Attrs = Record<string, string | number>;

/** Rounds to 0.0001px so paths stay short and stable. */
export function px(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, parent?: Element): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);

  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, String(value));
  }
  parent?.appendChild(el);

  return el;
}

/** A labelled group; `data-pptx-chart` names the chart part it holds. */
export function group(part: string, parent: Element): SVGGElement {
  return svg('g', { 'data-pptx-chart': part }, parent);
}

export interface TextStyle {
  size: number;
  color: string;
  family: string;
  bold?: boolean;
}

/** Deck text goes in through textContent only; it is untrusted. */
export function text(parent: Element, x: number, y: number, content: string, style: TextStyle, anchor = 'middle'): SVGTextElement {
  const el = svg('text', {
    x: px(x),
    y: px(y),
    'font-size': px(style.size),
    'font-family': style.family,
    fill: style.color,
    'text-anchor': anchor,
    'dominant-baseline': 'central',
  }, parent);

  if (style.bold) {
    el.setAttribute('font-weight', 'bold');
  }
  el.textContent = content;

  return el;
}

/** Rough width of a line of text; jsdom cannot measure, and layout only needs room. */
export function textWidth(content: string, size: number): number {
  return content.length * size * 0.55;
}
