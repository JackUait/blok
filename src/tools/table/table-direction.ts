import { getElementDirection } from '../../components/utils/direction';
import type { TextDirection } from '../../components/utils/direction';

/**
 * Table geometry is measured in reading order: `edges` (from
 * getCumulativeColEdges) grow from column 0's inline start. In RTL column 0
 * sits on the right, so these helpers mirror a logical offset inside the grid
 * to a physical one and back. The mirror is its own inverse.
 */
export const gridX = (x: number, gridWidth: number, direction: TextDirection): number =>
  direction === 'rtl' ? gridWidth - x : x;

/**
 * Physical x of column boundary `k`, from the grid's left edge.
 */
export const colEdgeX = (edges: number[], k: number, direction: TextDirection): number =>
  gridX(edges[k] ?? 0, edges[edges.length - 1] ?? 0, direction);

/**
 * Client x mirrored for RTL, so "further toward the inline end" is always the
 * larger number. Lets gesture math written for LTR run unchanged.
 */
export interface InlineAxis {
  x(clientX: number): number;
  start(rect: Pick<DOMRect, 'left' | 'right'>): number;
  end(rect: Pick<DOMRect, 'left' | 'right'>): number;
}

const LTR_AXIS: InlineAxis = {
  x: clientX => clientX,
  start: rect => rect.left,
  end: rect => rect.right,
};

const RTL_AXIS: InlineAxis = {
  x: clientX => -clientX,
  start: rect => -rect.right,
  end: rect => -rect.left,
};

export const inlineAxis = (direction: TextDirection): InlineAxis =>
  direction === 'rtl' ? RTL_AXIS : LTR_AXIS;

/**
 * Scroll a horizontal scroller to its inline end. RTL scrollLeft runs 0…-max.
 */
export const scrollToInlineEnd = (scroller: HTMLElement): void => {
  const target = scroller;

  target.scrollLeft = getElementDirection(scroller) === 'rtl' ? -scroller.scrollWidth : scroller.scrollWidth;
};
