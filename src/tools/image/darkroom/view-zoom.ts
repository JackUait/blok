import type { Box, Point, Size } from './camera';

/** A look closer that never edits: stage content p shows at p·z + (x, y). */
export interface View { z: number; x: number; y: number }

export const FIT: View = { z: 1, x: 0, y: 0 };

/** Fit is the floor, and the zoomed content always covers the stage. */
export function clampView(v: View, stage: Size): View {
  const z = Math.max(1, v.z);

  return {
    z,
    x: Math.min(0, Math.max(stage.w * (1 - z), v.x)),
    y: Math.min(0, Math.max(stage.h * (1 - z), v.y)),
  };
}

export function zoomViewAt(v: View, factor: number, at: Point, stage: Size, max: number): View {
  const z = Math.min(max, Math.max(1, v.z * factor));
  const k = z / v.z;

  return clampView({ z, x: at.x - (at.x - v.x) * k, y: at.y - (at.y - v.y) * k }, stage);
}

export function panView(v: View, dx: number, dy: number, stage: Size): View {
  return clampView({ ...v, x: v.x + dx, y: v.y + dy }, stage);
}

export function toView(b: Box, v: View): Box {
  return { x: b.x * v.z + v.x, y: b.y * v.z + v.y, w: b.w * v.z, h: b.h * v.z };
}
