import type { ChartModel } from './model';
import type { Box } from './legend';
import { group, px, svg } from './svg';

// At c:bubbleScale 100 the largest bubble spans a quarter of the shorter plot side.
// Unverified against Office; it matches the reference renderer on a full slide.
const MAX_DIAMETER_SHARE = 0.25;
// Lets overlapping bubbles show through. The exact Office opacity is unverified.
const FILL_OPACITY = 0.75;

export function drawBubbles(model: ChartModel, plot: Box, xPx: (v: number) => number, yPx: (v: number) => number, root: Element): void {
  const scale = Math.max(0, model.bubble?.scale ?? 100) / 100;
  const byWidth = model.bubble?.byWidth ?? false;
  // reduce, not a spread: a hostile deck can carry millions of sizes.
  const largest = model.series.reduce((m, s) => (s.bubbleSizes ?? []).reduce((mm, v) => (Number.isFinite(v) ? Math.max(mm, v) : mm), m), 0);
  const maxR = (Math.min(plot.w, plot.h) * MAX_DIAMETER_SHARE * scale) / 2;

  if (largest <= 0) {
    return;
  }
  model.series.forEach((s) => {
    const g = group('series', root);

    s.values.forEach((y, i) => {
      const size = s.bubbleSizes?.[i] ?? 0;

      if (s.blanks.has(i) || !(size > 0)) {
        return;
      }
      const share = size / largest;
      const r = maxR * (byWidth ? share : Math.sqrt(share));

      svg('circle', { 'data-pptx-chart': 'bubble', cx: px(xPx(s.xValues[i] ?? i + 1)), cy: px(yPx(y)), r: px(r), fill: s.pointColors[i] ?? s.color, 'fill-opacity': FILL_OPACITY }, g);
    });
  });
}
