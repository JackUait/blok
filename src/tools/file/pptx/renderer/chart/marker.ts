import { px, svg } from './svg';

/** Draws a marker centred on (x, y); unknown Office symbols fall back to a circle. */
export function drawMarker(parent: Element, symbol: string, x: number, y: number, size: number, color: string): SVGElement {
  const r = size / 2;
  const at = (dx: number, dy: number): string => `${px(x + dx)} ${px(y + dy)}`;
  const shapes: Record<string, string> = {
    diamond: `M${at(0, -r)} L${at(r, 0)} L${at(0, r)} L${at(-r, 0)} Z`,
    square: `M${at(-r, -r)} L${at(r, -r)} L${at(r, r)} L${at(-r, r)} Z`,
    triangle: `M${at(0, -r)} L${at(r, r)} L${at(-r, r)} Z`,
    x: `M${at(-r, -r)} L${at(r, r)} M${at(r, -r)} L${at(-r, r)}`,
    plus: `M${at(0, -r)} L${at(0, r)} M${at(-r, 0)} L${at(r, 0)}`,
    dash: `M${at(-r, 0)} L${at(r, 0)}`,
  };
  const d = shapes[symbol];
  const attrs = { 'data-pptx-chart': 'marker', 'data-x': px(x), 'data-y': px(y) };

  if (d === undefined) {
    return svg('circle', { ...attrs, cx: px(x), cy: px(y), r: px(symbol === 'dot' ? r / 2 : r), fill: color }, parent);
  }
  const stroked = symbol === 'x' || symbol === 'plus' || symbol === 'dash';

  return svg('path', stroked ? { ...attrs, d, stroke: color, 'stroke-width': 1.5, fill: 'none' } : { ...attrs, d, fill: color }, parent);
}
