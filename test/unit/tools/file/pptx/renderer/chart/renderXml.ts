import { renderChart } from '../../../../../../../src/tools/file/pptx/renderer/ChartRenderer';
import type { ChartNodeData } from '../../../../../../../src/tools/file/pptx/model/nodes/ChartNode';
import { parseXml, SafeXmlNode } from '../../../../../../../src/tools/file/pptx/parser/XmlParser';
import { createMockRenderContext } from '../../helpers/mockContext';

const PATH = 'ppt/charts/chart1.xml';

/** Renders chart XML into a w×h chart frame. */
export function render(xml: string, w = 400, h = 600): HTMLElement {
  const ctx = createMockRenderContext();
  const node: ChartNodeData = {
    id: '1', name: 'Chart', nodeType: 'chart', chartPath: PATH,
    position: { x: 0, y: 0 }, size: { w, h }, rotation: 0, flipH: false, flipV: false,
    source: new SafeXmlNode(null),
  };

  ctx.presentation.charts.set(PATH, parseXml(xml));

  return renderChart(node, ctx);
}

export const n = (el: Element | null | undefined, attr: string): number => Number(el?.getAttribute(attr));
export const parts = (root: Element, name: string): Element[] => [...root.querySelectorAll(`[data-pptx-chart="${name}"]`)];
export const part = (root: Element, name: string): Element => {
  const found = root.querySelector(`[data-pptx-chart="${name}"]`);

  if (!found) {
    throw new Error(`no ${name}`);
  }

  return found;
};
export const texts = (el: Element): string[] => [...el.querySelectorAll('text')].map((t) => t.textContent ?? '');
/** Absolute points of an SVG path made of M/L commands. */
export const pathPoints = (d: string | null): number[][] =>
  [...(d ?? '').matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

/** Where a value sits along a vertical axis, read from its first two tick labels. */
export function yOn(axis: Element, v: number): number {
  const ticks = [...axis.querySelectorAll('text')].map((t) => {
    const label = t.textContent ?? '';

    return [Number(label.replace('%', '')) / (label.endsWith('%') ? 100 : 1), n(t, 'y')];
  });
  const [[v0, y0], [v1, y1]] = ticks;

  return y0 + ((v - v0) / (v1 - v0)) * (y1 - y0);
}

/** A numeric data reference, as c:bubbleSize and friends carry it. */
export function numRef(tag: string, values: number[]): string {
  const pts = values.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('');

  return `<c:${tag}><c:numRef><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${pts}</c:numCache></c:numRef></c:${tag}>`;
}
