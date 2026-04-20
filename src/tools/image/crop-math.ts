import type { ImageCrop } from '../../../types/tools/image';

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const FULL_RECT: ImageCrop = { x: 0, y: 0, w: 100, h: 100 };
const MIN = 5;

export function isFullRect(r: ImageCrop): boolean {
  return r.x === 0 && r.y === 0 && r.w === 100 && r.h === 100;
}

export function clampRect(r: ImageCrop): ImageCrop {
  const { x: rx, y: ry, w: rw, h: rh } = r;
  const w = Math.max(MIN, Math.min(100, rw));
  const h = Math.max(MIN, Math.min(100, rh));
  const x = Math.max(0, Math.min(100 - w, rx));
  const y = Math.max(0, Math.min(100 - h, ry));
  return { x, y, w, h };
}

export function resizeRect(
  start: ImageCrop,
  handle: Handle,
  dxPct: number,
  dyPct: number
): ImageCrop {
  const { x: sx, y: sy, w: sw, h: sh } = start;
  const hasW = handle.includes('w');
  const hasE = handle.includes('e');
  const hasN = handle.includes('n');
  const hasS = handle.includes('s');

  const startRight = sx + sw;
  const startBottom = sy + sh;

  const left = hasW
    ? Math.max(0, Math.min(startRight - MIN, sx + dxPct))
    : sx;
  const right = hasE
    ? Math.max(sx + MIN, Math.min(100, startRight + dxPct))
    : startRight;
  const top = hasN
    ? Math.max(0, Math.min(startBottom - MIN, sy + dyPct))
    : sy;
  const bottom = hasS
    ? Math.max(sy + MIN, Math.min(100, startBottom + dyPct))
    : startBottom;

  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function applyRatio(rect: ImageCrop, ratio: number | null): ImageCrop {
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) return rect;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const baseW = rect.w;
  const baseH = baseW / ratio;
  const w = baseH > rect.h ? rect.h * ratio : baseW;
  const h = baseH > rect.h ? rect.h : baseH;
  return clampRect({ x: cx - w / 2, y: cy - h / 2, w, h });
}
