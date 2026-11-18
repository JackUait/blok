import { describe, expect, it } from 'vitest';
import { MIN_HEIGHT_PX, MIN_WIDTH_PX } from '../../../../src/tools/video/constants';
import { floorForShape, resizeFloorPx } from '../../../../src/tools/video/resize-floor';

const frame = (width: number, height: number, aspectRatio = ''): HTMLElement => {
  const media = document.createElement('div');

  media.style.aspectRatio = aspectRatio;
  media.getBoundingClientRect = (): DOMRect => ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) });

  return media;
};

describe('video resize floor', () => {
  it('keeps the smallest player 124px tall and 180px wide', () => {
    expect(MIN_HEIGHT_PX).toBe(124);
    expect(MIN_WIDTH_PX).toBe(180);
  });

  it('stops a wide video on its height', () => {
    expect(floorForShape(16 / 9)).toBe(221);
    expect(floorForShape(21 / 9)).toBe(290);
  });

  it('stops a square or tall video on its width', () => {
    expect(floorForShape(1)).toBe(180);
    expect(floorForShape(3 / 4)).toBe(180);
    expect(floorForShape(9 / 16)).toBe(180);
  });

  it('switches from the width limit to the height limit where the two meet', () => {
    expect(floorForShape(180 / 124)).toBe(180);
    expect(floorForShape(181 / 124)).toBe(181);
  });

  it('never returns a width that leaves the player under 124px tall', () => {
    for (const shape of [1.5, 16 / 9, 1.85, 2, 21 / 9, 3]) {
      expect(floorForShape(shape) / shape).toBeGreaterThanOrEqual(MIN_HEIGHT_PX);
    }
  });

  it('falls back to 16:9 for a shape that is not a positive number', () => {
    expect(floorForShape(0)).toBe(221);
    expect(floorForShape(Number.NaN)).toBe(221);
    expect(floorForShape(Number.POSITIVE_INFINITY)).toBe(221);
  });

  it('reads the shape from the frame as it is drawn', () => {
    expect(resizeFloorPx(frame(600, 300))).toBe(248);
    expect(resizeFloorPx(frame(300, 400))).toBe(180);
  });

  it('reads the declared shape when the frame has no size yet', () => {
    expect(resizeFloorPx(frame(0, 0, '2 / 1'))).toBe(248);
    expect(resizeFloorPx(frame(0, 0, '9 / 16'))).toBe(180);
  });

  it('treats a frame with no size and no declared shape as 16:9', () => {
    expect(resizeFloorPx(frame(0, 0))).toBe(221);
  });
});
