import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { mountErrorScreen } from '../../../../src/tools/video/error-screen';

interface FakeContext {
  fillStyle: string;
  globalAlpha: number;
  imageSmoothingEnabled: boolean;
  fills: Array<{ color: string; x: number; y: number; w: number; h: number }>;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage: ReturnType<typeof vi.fn>;
}

const makeContext = (): FakeContext => {
  const ctx: FakeContext = {
    fillStyle: '',
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    fills: [],
    fillRect(x, y, w, h) {
      ctx.fills.push({ color: ctx.fillStyle, x, y, w, h });
    },
    drawImage: vi.fn(),
  };

  return ctx;
};

class FakeObserver {
  public static last: FakeObserver | null = null;
  public disconnect = vi.fn();
  public observe = vi.fn();
  constructor(private readonly callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
    FakeObserver.last = this;
  }
  public show(isIntersecting: boolean): void {
    this.callback([{ isIntersecting }]);
  }
}

const contexts = new Map<HTMLCanvasElement, FakeContext>();
const frames: FrameRequestCallback[] = [];
const clock = { now: 0 };

/** Run the queued frame, 50ms after the last one. */
const step = (): boolean => {
  const frame = frames.shift();

  if (!frame) return false;
  clock.now += 50;
  frame(clock.now);

  return true;
};

const run = (seconds: number): void => {
  const end = clock.now + seconds * 1000;

  while (clock.now < end && step()) { /* keep stepping */ }
};

const mount = (): { host: HTMLElement; canvas: HTMLCanvasElement; ctx: () => FakeContext } => {
  const host = document.createElement('div');
  const canvas = document.createElement('canvas');

  host.append(canvas);
  document.body.append(host);
  mountErrorScreen(canvas, host);

  return {
    host,
    canvas,
    ctx: () => {
      const ctx = contexts.get(canvas);

      if (!ctx) throw new Error('the screen never asked for a context');

      return ctx;
    },
  };
};

const show = (): void => {
  if (!FakeObserver.last) throw new Error('the screen is not watched');
  FakeObserver.last.show(true);
};

const selfCopies = (canvas: HTMLCanvasElement, ctx: FakeContext): unknown[][] =>
  ctx.drawImage.mock.calls.filter((call) => call[0] === canvas);

beforeEach(() => {
  vi.clearAllMocks();
  contexts.clear();
  frames.length = 0;
  clock.now = 0;
  FakeObserver.last = null;
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => frames.push(frame));
  vi.stubGlobal('cancelAnimationFrame', () => { frames.length = 0; });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const ctx = contexts.get(this) ?? makeContext();

    contexts.set(this, ctx);

    return ctx as unknown as CanvasRenderingContext2D;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('mountErrorScreen', () => {
  it('draws nothing while the screen is off the page', () => {
    const { canvas } = mount();

    expect(contexts.has(canvas)).toBe(false);
    expect(frames).toHaveLength(0);
  });

  it('starts from seven colour bars across the top', () => {
    const { canvas } = mount();

    show();

    const source = [...contexts.entries()].find(([el]) => el !== canvas)?.[1];

    if (!source) throw new Error('no clean frame was painted');
    const top = source.fills.filter((fill) => fill.y === 0);

    expect(top).toHaveLength(7);
    expect(new Set(top.map((fill) => fill.color)).size).toBe(7);
    expect(top.map((fill) => fill.x)).toEqual([...top.map((fill) => fill.x)].sort((a, b) => a - b));
    expect(top[6].x + top[6].w).toBeGreaterThanOrEqual(canvas.width);
  });

  it('takes the bar colours from the theme', () => {
    const { canvas } = mount();

    canvas.style.setProperty('--blok-video-error-bar-1', 'rgb(1, 2, 3)');
    show();

    const source = [...contexts.entries()].find(([el]) => el !== canvas)?.[1];

    expect(source?.fills[0].color).toBe('rgb(1, 2, 3)');
  });

  it('holds the clean frame for a beat, then melts it block by block', () => {
    const { canvas, ctx } = mount();

    show();
    run(0.5);
    expect(selfCopies(canvas, ctx())).toHaveLength(0);

    run(1);
    const copies = selfCopies(canvas, ctx());

    expect(copies.length).toBeGreaterThan(0);
    // a 16px block, moved off its own spot
    expect(copies[0].slice(3, 5)).toEqual([16, 16]);
    expect(copies.some((call) => call[5] !== call[1] || call[6] !== call[2])).toBe(true);
  });

  it('lands a clean keyframe every eight seconds', () => {
    const { canvas, ctx } = mount();

    show();
    run(7.9);
    const before = ctx().drawImage.mock.calls.filter((call) => call[0] !== canvas).length;

    vi.spyOn(Math, 'random').mockReturnValue(0.4);
    run(0.3);
    const restored = ctx().drawImage.mock.calls.filter((call) => call[0] !== canvas).slice(before);

    expect(restored.length).toBeGreaterThan(0);
    // a keyframe block goes back to exactly where it came from
    expect(restored.every((call) => call[1] === call[5] && call[2] === call[6])).toBe(true);
  });

  it('drags the blocks under the pointer along with it', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { host, canvas, ctx } = mount();

    show();
    // after show(): the canvas only takes its real size once it starts drawing
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, canvas.width, canvas.height));
    run(1);
    const calm = selfCopies(canvas, ctx()).at(-1);

    if (!calm) throw new Error('nothing melted');
    const [, x, y] = calm as [unknown, number, number];

    host.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }));
    host.dispatchEvent(new MouseEvent('pointermove', { clientX: x + 20, clientY: y }));
    step();
    const dragged = selfCopies(canvas, ctx()).at(-1);

    expect((dragged?.[5] as number) - (calm[5] as number)).toBeGreaterThan(5);
  });

  it('pauses off screen and picks up again on screen', () => {
    mount();
    show();
    expect(frames).toHaveLength(1);

    FakeObserver.last?.show(false);
    expect(frames).toHaveLength(0);

    show();
    expect(frames).toHaveLength(1);
  });

  it('asks for one frame at a time, however often it is shown', () => {
    mount();
    show();
    show();

    expect(frames).toHaveLength(1);
  });

  it('stops for good once it leaves the page', () => {
    const { host } = mount();

    show();
    run(1);
    host.remove();
    step();

    expect(frames).toHaveLength(0);
    expect(FakeObserver.last?.disconnect).toHaveBeenCalledTimes(1);
  });

  it('shows one still, half-melted frame under reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
    const { canvas, ctx } = mount();

    show();

    expect(frames).toHaveLength(0);
    expect(selfCopies(canvas, ctx()).length).toBeGreaterThan(0);
  });

  it('paints the still frame once, not on every return to the screen', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
    const { canvas, ctx } = mount();

    show();
    const painted = selfCopies(canvas, ctx()).length;

    FakeObserver.last?.show(false);
    show();

    expect(selfCopies(canvas, ctx())).toHaveLength(painted);
  });

  it('stays dark where a canvas cannot draw', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    mount();

    expect(() => show()).not.toThrow();
    expect(frames).toHaveLength(0);
  });

  it('does nothing where the browser cannot watch the screen', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { canvas } = mount();

    expect(contexts.has(canvas)).toBe(false);
    expect(frames).toHaveLength(0);
  });
});
