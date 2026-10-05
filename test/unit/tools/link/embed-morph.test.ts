import { describe, it, expect } from 'vitest';
import {
  cardFrames,
  heroHop,
  landingOf,
  riderOffset,
  type CardBox,
} from '../../../../src/tools/link/embed/morph';

const card = (cx: number, cy: number, w: number, h: number, r = 10): CardBox => ({ cx, cy, w, h, r });
const part = (cx: number, cy: number, w = 10, h = 10): CardBox => ({ cx, cy, w, h, r: 0 });

describe('embed morph card', () => {
  const from = card(100, 60, 100, 60, 16);
  const to = card(100, 56, 150, 90, 10);

  it('starts on the old card and lands exactly on the new one', () => {
    const frames = cardFrames(from, to);

    expect(frames[0]).toEqual(from);
    expect(frames[frames.length - 1]).toEqual(to);
  });

  it('overshoots its new size before it settles, like a spring', () => {
    const widest = Math.max(...cardFrames(from, to).map((frame) => frame.w));

    expect(widest).toBeGreaterThan(to.w);
  });

  it('squashes and stretches: width and height do not grow in step', () => {
    const progress = cardFrames(from, to).map((frame) => [
      (frame.w - from.w) / (to.w - from.w),
      (frame.h - from.h) / (to.h - from.h),
    ]);

    expect(progress.some(([w, h]) => Math.abs(w - h) > 0.05)).toBe(true);
  });

  it('never turns inside out when it shrinks to a tiny card', () => {
    const frames = cardFrames(card(100, 60, 160, 100, 16), card(100, 60, 4, 4, 2));

    expect(frames.every((frame) => frame.w > 0 && frame.h > 0 && frame.r >= 0)).toBe(true);
  });
});

describe('embed morph riders', () => {
  const home = card(100, 60, 100, 60);

  it('leaves a part where it is when the card is at home', () => {
    expect(riderOffset(part(80, 50), home, home)).toEqual({ dx: 0, dy: 0, scale: 1 });
  });

  it('keeps a part at the same place on a card that moved and grew', () => {
    const offset = riderOffset(part(80, 50), home, card(110, 70, 200, 120));

    // 20px left and 10px up of the centre, doubled with the card.
    expect(offset).toEqual({ dx: 110 - 40 - 80, dy: 70 - 20 - 50, scale: 2 });
  });

  it('scales a part by the tighter side, so it never stretches out of shape', () => {
    expect(riderOffset(part(100, 60), home, card(100, 60, 300, 60)).scale).toBe(1);
  });
});

describe('embed morph landings', () => {
  const newCard = card(100, 60, 140, 90);
  const landing = (names: string, at = part(100, 60), extra: Record<string, string> = {}): ReturnType<typeof landingOf> =>
    landingOf({ classes: names.split(' ').map((name) => `blok-media-preview__${name}`), box: at, index: Number(extra.index ?? 0) }, newCard);

  it.each([
    ['line', 'grow'],
    ['line line--title', 'grow'],
    ['cell', 'grow'],
    ['track', 'grow'],
    ['bar', 'rise'],
    ['chart-bar', 'rise'],
    ['trend', 'draw'],
    ['tick', 'draw'],
    ['road', 'draw'],
    ['link', 'draw'],
    ['progress', 'fill'],
    ['hill hill--far', 'lift'],
    ['park', 'lift'],
    ['screen', 'pop'],
    ['blob', 'pop'],
  ])('lands a %s part with %s', (names, kind) => {
    expect(landing(names).kind).toBe(kind);
  });

  it('reads left to right: a part on the left lands before one on the right', () => {
    expect(landing('line', part(50, 60)).start).toBeLessThan(landing('line', part(150, 60)).start);
  });

  it('raises the waveform bars one after another', () => {
    expect(landing('bar', part(100, 60), { index: '0' }).start)
      .toBeLessThan(landing('bar', part(100, 60), { index: '5' }).start);
  });

  it('settles a part that fills most of the card without bouncing past its edges', () => {
    expect(landing('screen', part(100, 50, 130, 62)).soft).toBe(true);
    expect(landing('screen', part(60, 40, 30, 30)).soft).toBe(false);
  });

  it('grows lines and cells from their left edge and bars from their base', () => {
    expect(landing('line').origin).toBe('left center');
    expect(landing('chart-bar').origin).toBe('center bottom');
  });
});

describe('embed morph hero hop', () => {
  const oldSpot = part(53, 60, 58, 60);
  const newSpot = part(100, 47, 28, 28);

  it('takes off from the old hero spot and lands at rest', () => {
    const poses = heroHop(oldSpot, newSpot);
    const first = poses[0];
    const last = poses[poses.length - 1];

    expect(first.dx).toBeCloseTo(oldSpot.cx - newSpot.cx);
    expect(first.dy).toBeCloseTo(oldSpot.cy - newSpot.cy);
    expect(last).toEqual({ dx: 0, dy: 0, scale: 1, rotate: 0 });
  });

  it('flies on an arc above the straight line between the spots', () => {
    const above = heroHop(oldSpot, newSpot).map((pose) => {
      const left = pose.dx / (oldSpot.cx - newSpot.cx);

      return (oldSpot.cy - newSpot.cy) * left - pose.dy;
    });

    expect(Math.max(...above)).toBeGreaterThan(10);
  });

  it('takes off leaning the way it travels, then unwinds', () => {
    expect(heroHop(oldSpot, newSpot)[0].rotate).toBeGreaterThan(0);
    expect(heroHop(newSpot, oldSpot)[0].rotate).toBeLessThan(0);
  });

  it('starts at the old hero size', () => {
    expect(heroHop(oldSpot, newSpot)[0].scale).toBeGreaterThan(1.5);
  });
});
