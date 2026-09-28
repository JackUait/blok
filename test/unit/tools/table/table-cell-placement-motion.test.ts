import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { movePlacementWithMotion } from '../../../../src/tools/table/table-cell-placement-motion';

/** A cell's blocks container with block holders whose box depends on the container's placement. */
const makeCell = (boxes: Record<string, Array<[number, number]>>, count: number): { container: HTMLElement; holders: HTMLElement[] } => {
  const container = document.createElement('div');

  container.setAttribute('data-blok-table-cell-blocks', '');
  const holders = Array.from({ length: count }, (_, index) => {
    const holder = document.createElement('div');

    holder.setAttribute('data-blok-element', '');
    holder.getBoundingClientRect = (): DOMRect => {
      const [left, top] = boxes[container.getAttribute('data-blok-cell-placement') ?? 'top-left'][index];

      return new DOMRect(left, top, 40, 20);
    };
    container.appendChild(holder);

    return holder;
  });

  document.body.appendChild(container);

  return { container, holders };
};

type Animate = (keyframes: Keyframe[], options: KeyframeAnimationOptions) => void;

const stubMotion = (reduced: boolean): Mock<Animate> => {
  const animate = vi.fn<Animate>();

  // jsdom has neither matchMedia nor the Web Animations API.
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({ matches: reduced && query.includes('reduce'), media: query }),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(HTMLElement.prototype, 'animate', { value: animate, configurable: true, writable: true });

  return animate;
};

describe('movePlacementWithMotion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations');
    Reflect.deleteProperty(window, 'matchMedia');
    document.body.replaceChildren();
  });

  it('glides every block from where it was to where the new placement puts it', () => {
    const animate = stubMotion(false);
    const { container, holders } = makeCell({
      'top-left': [[0, 0], [0, 24]],
      'middle-center': [[60, 30], [70, 54]],
    }, 2);

    movePlacementWithMotion([container], () => container.setAttribute('data-blok-cell-placement', 'middle-center'));

    expect(animate).toHaveBeenCalledTimes(2);
    expect(animate.mock.contexts).toEqual(holders);
    expect(animate.mock.calls[0][0]).toEqual([{ transform: 'translate(-60px, -30px)' }, { transform: 'none' }]);
    expect(animate.mock.calls[1][0]).toEqual([{ transform: 'translate(-70px, -30px)' }, { transform: 'none' }]);
  });

  it('moves every block at once and lands within 200ms, with no overshoot, so it never trails the click', () => {
    const animate = stubMotion(false);
    const { container } = makeCell({ 'top-left': [[0, 0], [0, 24]], 'middle-right': [[80, 30], [90, 54]] }, 2);

    movePlacementWithMotion([container], () => container.setAttribute('data-blok-cell-placement', 'middle-right'));

    for (const [, timing] of animate.mock.calls) {
      expect(timing.delay ?? 0).toBe(0);
      expect(Number(timing.duration)).toBeLessThanOrEqual(200);
      // No control point above 1: the block never passes its target and comes back.
      const controls = (timing.easing ?? '').match(/-?[\d.]+/g)?.map(Number) ?? [];

      expect(controls).toHaveLength(4);
      expect(Math.max(controls[1], controls[3])).toBeLessThanOrEqual(1);
    }
  });

  it('applies the placement exactly once, after measuring', () => {
    stubMotion(false);
    const { container } = makeCell({ 'top-left': [[0, 0]], 'middle-right': [[80, 30]] }, 1);
    const apply = vi.fn(() => container.setAttribute('data-blok-cell-placement', 'middle-right'));

    movePlacementWithMotion([container], apply);

    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('leaves a block that did not move alone', () => {
    const animate = stubMotion(false);
    const { container } = makeCell({ 'top-left': [[0, 0]], 'bottom-left': [[0, 0]] }, 1);

    movePlacementWithMotion([container], () => container.setAttribute('data-blok-cell-placement', 'bottom-left'));

    expect(animate).not.toHaveBeenCalled();
  });

  it('jumps straight to the new placement for people who ask for reduced motion', () => {
    const animate = stubMotion(true);
    const { container } = makeCell({ 'top-left': [[0, 0]], 'middle-right': [[80, 30]] }, 1);

    movePlacementWithMotion([container], () => container.setAttribute('data-blok-cell-placement', 'middle-right'));

    expect(animate).not.toHaveBeenCalled();
    expect(container.getAttribute('data-blok-cell-placement')).toBe('middle-right');
  });

  it('still applies the placement where the Web Animations API is missing', () => {
    const { container } = makeCell({ 'top-left': [[0, 0]], 'middle-right': [[80, 30]] }, 1);

    expect(() => movePlacementWithMotion([container], () => container.setAttribute('data-blok-cell-placement', 'middle-right'))).not.toThrow();
    expect(container.getAttribute('data-blok-cell-placement')).toBe('middle-right');
  });

  it('cancels a glide still running before starting the next, so they never stack', () => {
    stubMotion(false);
    const running = { cancel: vi.fn() };

    Object.defineProperty(HTMLElement.prototype, 'getAnimations', { value: () => [running], configurable: true, writable: true });
    const { container } = makeCell({ 'top-left': [[0, 0]], 'middle-right': [[80, 30]] }, 1);

    movePlacementWithMotion([container], () => container.setAttribute('data-blok-cell-placement', 'middle-right'));

    expect(running.cancel).toHaveBeenCalledTimes(1);
  });

  it('moves the blocks of every selected cell', () => {
    const animate = stubMotion(false);
    const first = makeCell({ 'top-left': [[0, 0]], 'middle-center': [[50, 20]] }, 1);
    const second = makeCell({ 'top-left': [[200, 0]], 'middle-center': [[250, 20]] }, 1);

    movePlacementWithMotion([first.container, second.container], () => {
      first.container.setAttribute('data-blok-cell-placement', 'middle-center');
      second.container.setAttribute('data-blok-cell-placement', 'middle-center');
    });

    expect(animate.mock.contexts).toEqual([...first.holders, ...second.holders]);
  });
});
