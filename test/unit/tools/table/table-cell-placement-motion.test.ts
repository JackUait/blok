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
    // Halfway there each block leans into its travel, then straightens as it lands.
    expect(animate.mock.calls[0][0]).toEqual([
      { transform: 'translate(-60px, -30px) skewX(0deg)' },
      { offset: 0.5, transform: 'translate(-30px, -15px) skewX(-5deg)' },
      { transform: 'translate(0px, 0px) skewX(0deg)' },
    ]);
    expect(animate.mock.calls[1][0]).toEqual([
      { transform: 'translate(-70px, -30px) skewX(0deg)' },
      { offset: 0.5, transform: 'translate(-35px, -15px) skewX(-5.83deg)' },
      { transform: 'translate(0px, 0px) skewX(0deg)' },
    ]);
  });

  it.each([
    ['left', [[200, 0]], [[0, 0]], 8],
    ['right, capped for a long trip', [[0, 0]], [[300, 0]], -8],
    ['straight down, without leaning', [[0, 0]], [[0, 40]], 0],
  ] as const)('leans a block moving %s', (_direction, from, to, lean) => {
    const animate = stubMotion(false);
    const { container } = makeCell({ 'top-left': from.map(([x, y]) => [x, y]), 'middle-right': to.map(([x, y]) => [x, y]) }, 1);

    movePlacementWithMotion([container], () => container.setAttribute('data-blok-cell-placement', 'middle-right'));

    expect(animate.mock.calls[0][0][1].transform).toContain(`skewX(${lean}deg)`);
  });

  it('moves every block at once, fast, accelerating from rest and braking without overshoot', () => {
    const animate = stubMotion(false);
    const { container } = makeCell({ 'top-left': [[0, 0], [0, 24]], 'middle-right': [[80, 30], [90, 54]] }, 2);

    movePlacementWithMotion([container], () => container.setAttribute('data-blok-cell-placement', 'middle-right'));

    for (const [, timing] of animate.mock.calls) {
      expect(timing.delay ?? 0).toBe(0);
      expect(Number(timing.duration)).toBeLessThanOrEqual(240);
      const controls = (timing.easing ?? '').match(/-?[\d.]+/g)?.map(Number) ?? [];

      expect(controls).toHaveLength(4);
      // Starts at rest and builds speed: the first control point sits flat and late.
      expect(controls[0]).toBeGreaterThanOrEqual(0.5);
      expect(controls[1]).toBe(0);
      // No control point above 1: the block never passes its target and comes back.
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

  it('moves only blocks, never other elements in the cell', () => {
    const animate = stubMotion(false);
    const { container, holders } = makeCell({ 'top-left': [[0, 0]], 'middle-right': [[80, 0]] }, 1);
    const stray = document.createElement('div');

    stray.getBoundingClientRect = (): DOMRect =>
      new DOMRect(container.hasAttribute('data-blok-cell-placement') ? 80 : 0, 0, 10, 10);
    container.appendChild(stray);

    movePlacementWithMotion([container], () => container.setAttribute('data-blok-cell-placement', 'middle-right'));

    expect(animate.mock.contexts).toEqual(holders);
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
