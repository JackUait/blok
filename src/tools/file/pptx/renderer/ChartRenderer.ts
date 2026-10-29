// Derived from @aiden0z/pptx-renderer 1.4.0 (Apache-2.0); modified for Blok. See NOTICE.
import type { ChartNodeData } from '../model/nodes/ChartNode';
import type { RenderContext } from './RenderContext';
import type { Box } from './chart/legend';
import { drawCartesian } from './chart/cartesian';
import { drawLegend } from './chart/legend';
import { readChart } from './chart/model';
import { drawPie } from './chart/pie';
import { drawRadar } from './chart/radar';
import { group, svg, text } from './chart/svg';

function frameFor(node: ChartNodeData): HTMLElement {
  const frame = document.createElement('div');

  frame.style.position = 'absolute';
  frame.style.left = `${node.position.x}px`;
  frame.style.top = `${node.position.y}px`;
  frame.style.width = `${node.size.w}px`;
  frame.style.height = `${node.size.h}px`;

  return frame;
}

function draw(node: ChartNodeData, ctx: RenderContext, frame: HTMLElement): void {
  const part = ctx.presentation.charts.get(node.chartPath);

  if (!part?.exists()) {
    return;
  }
  const chartTheme = ctx.presentation.chartThemes?.get(node.chartPath);
  const chartCtx = chartTheme ? { ...ctx, theme: chartTheme, colorCache: new Map() } : ctx;
  const model = readChart(part, chartCtx, node.chartPath);
  const { w, h } = node.size;
  const root = svg('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}`, overflow: 'hidden' });
  const style = model.text;
  const pad = style.size * 0.5;
  const titleStyle = { ...style, size: model.title?.size ?? style.size, bold: model.title?.bold };
  const titleH = model.title ? titleStyle.size * 1.4 : 0;

  frame.appendChild(root);
  if (model.title) {
    text(group('title', root), w / 2, pad + titleH / 2, model.title.text, titleStyle);
  }
  if (model.kind === 'unsupported' || model.series.length === 0) {
    return;
  }
  const inner: Box = { x: pad, y: pad + titleH + (model.title ? pad : 0), w: w - pad * 2, h: h - pad * 2 - titleH - (model.title ? pad : 0) };
  const plotArea = drawLegend(model, inner, root, style);

  if (model.kind === 'pie' || model.kind === 'doughnut') {
    drawPie(model, plotArea, root, style);
  } else if (model.kind === 'radar') {
    drawRadar(model, plotArea, root, style);
  } else {
    drawCartesian(model, plotArea, root, style);
  }
}

export function renderChart(node: ChartNodeData, ctx: RenderContext): HTMLElement {
  const frame = frameFor(node);

  try {
    draw(node, ctx, frame);
  } catch {
    // A malformed chart part keeps its empty frame instead of breaking the slide.
    frame.replaceChildren();
  }

  return frame;
}
