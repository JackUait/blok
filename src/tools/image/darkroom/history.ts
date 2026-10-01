import type { ImageAdjust, ImageCrop, ImageFilterPreset } from '../../../../types/tools/image';
import { ADJUST_KEYS } from '../adjust';
import type { Geometry } from '../geometry';

export interface Snapshot {
  rect: ImageCrop;
  ratioKey: string;
  geometry: Geometry;
  filter: ImageFilterPreset;
  adjust: Required<ImageAdjust>;
}

export interface CropHistory {
  push(s: Snapshot): void;
  undo(): Snapshot | null;
  redo(): Snapshot | null;
  current(): Snapshot;
}

// Camera round trips leave float noise; smaller changes are not a new step.
const SAME = 1e-6;

const same = (a: Snapshot, b: Snapshot): boolean => a.ratioKey === b.ratioKey
  && a.filter === b.filter && ADJUST_KEYS.every((k) => a.adjust[k] === b.adjust[k])
  && a.geometry.rotation === b.geometry.rotation && a.geometry.flipX === b.geometry.flipX
  && Math.abs(a.geometry.straighten - b.geometry.straighten) < SAME
  && Math.abs(a.rect.x - b.rect.x) < SAME && Math.abs(a.rect.y - b.rect.y) < SAME
  && Math.abs(a.rect.w - b.rect.w) < SAME && Math.abs(a.rect.h - b.rect.h) < SAME;

export function createHistory(initial: Snapshot): CropHistory {
  const entries: Snapshot[] = [initial];
  const at = { i: 0 };

  return {
    push(s) {
      if (same(s, entries[at.i])) return;
      entries.splice(at.i + 1);
      entries.push(s);
      at.i = entries.length - 1;
    },
    undo() {
      if (at.i === 0) return null;
      at.i -= 1;

      return entries[at.i];
    },
    redo() {
      if (at.i === entries.length - 1) return null;
      at.i += 1;

      return entries[at.i];
    },
    current: () => entries[at.i],
  };
}
