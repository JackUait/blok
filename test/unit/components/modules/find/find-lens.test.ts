import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FindLens } from '../../../../../src/components/modules/find/find-lens';

const rect = (top: number, left: number, width: number, height: number): { top: number; left: number; width: number; height: number } => ({
  top,
  left,
  width,
  height,
});

const boxesIn = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-blok-testid="find-lens-box"]'));

const lensIn = (container: HTMLElement): HTMLElement | null =>
  container.querySelector<HTMLElement>('[data-blok-testid="find-lens"]');

describe('FindLens', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    container.remove();
  });

  it('adds nothing to the container until it is first moved', () => {
    const lens = new FindLens(container);

    expect(lensIn(container)).toBeNull();

    lens.destroy();
  });

  it('draws one box per rect, placed from the rect', () => {
    const lens = new FindLens(container);

    lens.moveTo([rect(10, 20, 100, 18), rect(30, 0, 40, 18)]);

    const boxes = boxesIn(container);

    expect(boxes).toHaveLength(2);
    expect(boxes[0].style.transform).toBe('translate(20px, 10px)');
    expect(boxes[0].style.width).toBe('100px');
    expect(boxes[0].style.height).toBe('18px');
    expect(boxes[1].style.transform).toBe('translate(0px, 30px)');
    expect(boxes[1].style.width).toBe('40px');
  });

  it('draws one box for pieces of a match that touch on the same line', () => {
    const lens = new FindLens(container);

    // A struck-out match and its replacement in the preview: two spans, one line.
    lens.moveTo([rect(10, 20, 40, 18), rect(10, 60, 30, 18), rect(10, 20, 70, 18)]);

    const boxes = boxesIn(container);

    expect(boxes).toHaveLength(1);
    expect(boxes[0].style.transform).toBe('translate(20px, 10px)');
    expect(boxes[0].style.width).toBe('70px');
  });

  it('is decorative and never takes pointer events', () => {
    const lens = new FindLens(container);

    lens.moveTo([rect(0, 0, 10, 10)]);

    const root = lensIn(container);

    expect(root?.getAttribute('aria-hidden')).toBe('true');
    expect(root?.style.pointerEvents).toBe('none');
  });

  it('reuses its boxes when it moves', () => {
    const lens = new FindLens(container);

    lens.moveTo([rect(0, 0, 10, 10)]);
    const [first] = boxesIn(container);

    lens.moveTo([rect(50, 60, 30, 10)]);
    const [moved] = boxesIn(container);

    expect(moved).toBe(first);
    expect(moved.style.transform).toBe('translate(60px, 50px)');
  });

  it('drops boxes the new match does not need', () => {
    const lens = new FindLens(container);

    lens.moveTo([rect(0, 0, 10, 10), rect(20, 0, 10, 10), rect(40, 0, 10, 10)]);
    lens.moveTo([rect(0, 0, 10, 10)]);

    expect(boxesIn(container)).toHaveLength(1);
  });

  it('plays the arrival only when asked, and clears it when it ends', () => {
    const lens = new FindLens(container);

    lens.moveTo([rect(0, 0, 10, 10)]);
    const [box] = boxesIn(container);

    expect(box.hasAttribute('data-blok-find-lens-arrive')).toBe(false);

    lens.moveTo([rect(0, 0, 10, 10)], { pulse: true });

    expect(box.hasAttribute('data-blok-find-lens-arrive')).toBe(true);

    box.dispatchEvent(new Event('animationend'));

    expect(box.hasAttribute('data-blok-find-lens-arrive')).toBe(false);
  });

  it('hides without forgetting its boxes, and shows again on the next move', () => {
    const lens = new FindLens(container);

    lens.moveTo([rect(0, 0, 10, 10)]);
    lens.hide();

    expect(lensIn(container)?.hidden).toBe(true);

    lens.moveTo([rect(5, 5, 10, 10)]);

    expect(lensIn(container)?.hidden).toBe(false);
  });

  it('hides when moved to no rects', () => {
    const lens = new FindLens(container);

    lens.moveTo([rect(0, 0, 10, 10)]);
    lens.moveTo([]);

    expect(lensIn(container)?.hidden).toBe(true);
  });

  it('removes itself on destroy', () => {
    const lens = new FindLens(container);

    lens.moveTo([rect(0, 0, 10, 10)]);
    lens.destroy();

    expect(lensIn(container)).toBeNull();
  });
});
