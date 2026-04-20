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
  const x = hasW ? sx + dxPct : sx;
  const y = hasN ? sy + dyPct : sy;
  const w = sw + (hasE ? dxPct : 0) - (hasW ? dxPct : 0);
  const h = sh + (hasS ? dyPct : 0) - (hasN ? dyPct : 0);
  return clampRect({ x, y, w, h });
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
