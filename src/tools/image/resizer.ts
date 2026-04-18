import { MAX_WIDTH_PERCENT, MIN_WIDTH_PERCENT } from './constants';

export type ResizeEdge = 'left' | 'right';

export interface ComputeWidthInput {
  edge: ResizeEdge;
  /** Width of the layout container in pixels */
  containerWidth: number;
  /** Pointer X relative to viewport */
  dragX: number;
  /** Container's left X relative to viewport — used to translate dragX to container-relative */
  originX: number;
}

export function clampPercent(value: number): number {
  if (value < MIN_WIDTH_PERCENT) return MIN_WIDTH_PERCENT;
  if (value > MAX_WIDTH_PERCENT) return MAX_WIDTH_PERCENT;
  return value;
}

/**
 * Compute new width percent given pointer position during edge drag.
 * Right-edge drag: width = relativeX / containerWidth.
 * Left-edge drag:  width = (containerWidth - relativeX) / containerWidth.
 */
export function computeWidthPercent(input: ComputeWidthInput): number {
  const relativeX = input.dragX - input.originX;
  const ratio = input.edge === 'right'
    ? relativeX / input.containerWidth
    : (input.containerWidth - relativeX) / input.containerWidth;
  return clampPercent(Math.round(ratio * 100));
}
