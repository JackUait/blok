import type { ChartNodeData } from '../model/nodes/ChartNode';
import type { RenderContext } from './RenderContext';

/** Draws the chart frame at its slide position. */
export function renderChart(node: ChartNodeData, _ctx: RenderContext): HTMLElement {
  const frame = document.createElement('div');
  frame.style.position = 'absolute';
  frame.style.left = `${node.position.x}px`;
  frame.style.top = `${node.position.y}px`;
  frame.style.width = `${node.size.w}px`;
  frame.style.height = `${node.size.h}px`;

  return frame;
}
