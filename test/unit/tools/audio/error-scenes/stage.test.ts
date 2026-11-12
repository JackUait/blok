import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { mountErrorStage, BREAK_DELAY_MS } from '../../../../../src/tools/audio/error-scenes/stage';
import type { ErrorScene, SceneLayout, ScenePointer } from '../../../../../src/tools/audio/error-scenes/types';

type Entry = { isIntersecting: boolean; intersectionRatio: number };

class FakeIntersectionObserver {
  public static last: FakeIntersectionObserver | null = null;
  public disconnect = vi.fn();
  public observe = vi.fn();
  constructor(private readonly callback: (entries: Entry[]) => void) {
    FakeIntersectionObserver.last = this;
  }
  public report(intersectionRatio: number): void {
    this.callback([{ isIntersecting: intersectionRatio > 0, intersectionRatio }]);
  }
}

class FakeResizeObserver {
  public static last: FakeResizeObserver | null = null;
  public disconnect = vi.fn();
  public observe = vi.fn();
  constructor(private readonly callback: () => void) {
    FakeResizeObserver.last = this;
  }
  public fire(): void {
    this.callback();
  }
}

const frames: FrameRequestCallback[] = [];
const clock = { now: 0 };

/** Run the queued frame, 16ms after the last one. */
const frame = (): boolean => {
  const next = frames.shift();

  if (!next) return false;
  clock.now += 16;
  next(clock.now);

  return true;
};

interface FakeScene extends ErrorScene {
  layouts: SceneLayout[];
  steps: number;
  resets: number;
  paints: number;
  /** Steps left before the scene reports it is at rest. */
  busyFor: number;
  seen: ScenePointer | null;
}

const makeScene = (extra: Partial<ErrorScene> = {}): FakeScene => {
  const scene: FakeScene = {
    layouts: [],
    steps: 0,
    resets: 0,
    paints: 0,
    busyFor: 3,
    seen: null,
    layout(layout) {
      scene.layouts.push(layout);
    },
    reset() {
      scene.resets += 1;
    },
    step(_dt, pointer) {
      scene.steps += 1;
      scene.seen = { ...pointer };
      scene.busyFor -= 1;

      return scene.busyFor > 0;
    },
    paint() {
      scene.paints += 1;
    },
    ...extra,
  };

  return scene;
};

const size = (el: HTMLElement, width: number, height: number): void => {
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: height });
};

const mount = (scene: ErrorScene, width = 768, height = 216): { card: HTMLElement; canvas: HTMLCanvasElement; destroy(): void } => {
  const card = document.createElement('div');
  const canvas = document.createElement('canvas');

  card.append(canvas);
  document.body.append(card);
  size(card, width, height);
  const handle = mountErrorStage(canvas, card, scene);

  FakeResizeObserver.last?.fire();

  return { card, canvas, destroy: handle.destroy };
};

const show = (ratio: number): void => {
  if (!FakeIntersectionObserver.last) throw new Error('the stage is not watching the card');
  FakeIntersectionObserver.last.report(ratio);
};

const pointerAt = (canvas: HTMLCanvasElement, type: string, x: number, y: number): void => {
  canvas.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  frames.length = 0;
  clock.now = 0;
  FakeIntersectionObserver.last = null;
  FakeResizeObserver.last = null;
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (next: FrameRequestCallback) => frames.push(next));
  vi.stubGlobal('cancelAnimationFrame', () => { frames.length = 0; });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    setTransform: vi.fn(),
    clearRect: vi.fn(),
  }) as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('mountErrorStage: when the break plays', () => {
  it('shows the unbroken object and does not play while the card is only partly on screen', () => {
    const scene = makeScene();

    mount(scene);
    show(0.6);
    vi.advanceTimersByTime(5000);

    expect(scene.steps).toBe(0);
    expect(frames).toHaveLength(0);
    expect(scene.resets).toBe(1);
    expect(scene.paints).toBe(1);
  });

  it('plays 500ms after the card is on screen in its full height, not sooner', () => {
    const scene = makeScene();

    mount(scene);
    show(1);
    vi.advanceTimersByTime(BREAK_DELAY_MS - 1);
    expect(frames).toHaveLength(0);

    vi.advanceTimersByTime(1);
    frame();

    expect(scene.steps).toBe(1);
    expect(BREAK_DELAY_MS).toBe(500);
  });

  it('starts the wait again when the card leaves full view before the 500ms are over', () => {
    const scene = makeScene();

    mount(scene);
    show(1);
    vi.advanceTimersByTime(300);
    show(0.8);
    vi.advanceTimersByTime(1000);
    expect(frames).toHaveLength(0);

    show(1);
    vi.advanceTimersByTime(300);
    expect(frames).toHaveLength(0);
    vi.advanceTimersByTime(200);

    expect(frames).toHaveLength(1);
  });

  it('plays the break once: scrolling away and back does not replay it', () => {
    const scene = makeScene();

    mount(scene);
    show(1);
    vi.advanceTimersByTime(BREAK_DELAY_MS);
    while (frame()) { /* run to rest */ }
    const resets = scene.resets;

    show(0);
    show(1);
    vi.advanceTimersByTime(BREAK_DELAY_MS);

    expect(scene.resets).toBe(resets);
    expect(frames).toHaveLength(0);
  });

  it('stops asking for frames once the scene is at rest', () => {
    const scene = makeScene();

    mount(scene);
    show(1);
    vi.advanceTimersByTime(BREAK_DELAY_MS);
    while (frame()) { /* run to rest */ }

    expect(scene.steps).toBe(3);
    expect(frames).toHaveLength(0);
  });

  it('pauses while the card is off screen and goes on when it is back', () => {
    const scene = makeScene();

    scene.busyFor = 100;
    mount(scene);
    show(1);
    vi.advanceTimersByTime(BREAK_DELAY_MS);
    frame();
    show(0);
    expect(frames).toHaveLength(0);

    show(0.3);

    expect(frames).toHaveLength(1);
  });

  it('with reduced motion shows the broken object at once and never animates', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const scene = makeScene();

    mount(scene);
    show(1);
    vi.advanceTimersByTime(BREAK_DELAY_MS);

    expect(scene.steps).toBe(3);
    expect(frames).toHaveLength(0);
  });
});

describe('mountErrorStage: layout', () => {
  it('gives a wide card the right part of the card, full height', () => {
    const scene = makeScene();
    const { canvas } = mount(scene, 768, 216);

    expect(scene.layouts[0]).toEqual({ width: 768, height: 216, scale: 1, zone: { x: 361, y: 0, width: 407, floor: 216 } });
    expect(canvas.width).toBe(768);
    expect(canvas.height).toBe(216);
  });

  it('gives a narrow card the strip above the words', () => {
    const scene = makeScene();
    const { card } = mount(scene, 380, 420);

    expect(scene.layouts[0].zone).toEqual({ x: 0, y: 0, width: 380, floor: 172 });
    // The card's own layout is CSS's job: a write here would resize the card inside its resize report.
    expect(card.getAttributeNames()).toEqual([]);
  });

  it('caps the backing store at two pixels per CSS pixel', () => {
    vi.stubGlobal('devicePixelRatio', 3);
    const scene = makeScene();
    const { canvas } = mount(scene, 768, 216);

    expect(scene.layouts[0].scale).toBe(2);
    expect(canvas.width).toBe(1536);
  });

  it('keeps a played scene broken when the card changes size', () => {
    const scene = makeScene();
    const { card } = mount(scene);

    show(1);
    vi.advanceTimersByTime(BREAK_DELAY_MS);
    while (frame()) { /* run to rest */ }
    scene.busyFor = 4;
    size(card, 600, 216);
    FakeResizeObserver.last?.fire();

    expect(scene.layouts).toHaveLength(2);
    expect(scene.steps).toBe(3 + 4);
    expect(frames).toHaveLength(0);
  });

  it('ignores a resize report that changed nothing', () => {
    const scene = makeScene();

    mount(scene);
    FakeResizeObserver.last?.fire();

    expect(scene.layouts).toHaveLength(1);
  });
});

describe('mountErrorStage: pointer', () => {
  const played = (scene: FakeScene, extra?: { width: number; height: number }): HTMLCanvasElement => {
    const { canvas } = mount(scene, extra?.width, extra?.height);

    show(1);
    vi.advanceTimersByTime(BREAK_DELAY_MS);
    while (frame()) { /* run to rest */ }

    return canvas;
  };

  it('does not wake the scene before the break has played', () => {
    const scene = makeScene();
    const { canvas } = mount(scene);

    pointerAt(canvas, 'pointermove', 40, 50);

    expect(frames).toHaveLength(0);
    expect(scene.steps).toBe(0);
  });

  it('wakes a resting scene and hands it the pointer position', () => {
    const scene = makeScene();
    const canvas = played(scene);

    scene.busyFor = 1;
    pointerAt(canvas, 'pointermove', 40, 50);
    frame();

    expect(scene.seen).toMatchObject({ x: 40, y: 50, inside: true, down: false });
  });

  it('reports the pointer as gone after it leaves', () => {
    const scene = makeScene();
    const canvas = played(scene);

    pointerAt(canvas, 'pointermove', 40, 50);
    scene.busyFor = 1;
    pointerAt(canvas, 'pointerleave', 900, 50);
    while (frame()) { /* run to rest */ }

    expect(scene.seen?.inside).toBe(false);
  });

  it('tells the scene about a press and a release', () => {
    const press = vi.fn();
    const release = vi.fn();
    const scene = makeScene({ press, release });
    const canvas = played(scene);

    pointerAt(canvas, 'pointerdown', 10, 20);
    expect(press).toHaveBeenCalledWith(expect.objectContaining({ x: 10, y: 20, down: true }));

    pointerAt(canvas, 'pointerup', 10, 20);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('keeps a held pointer inside after it leaves the canvas', () => {
    const scene = makeScene({ drag: true });
    const canvas = played(scene);

    pointerAt(canvas, 'pointerdown', 10, 20);
    scene.busyFor = 1;
    pointerAt(canvas, 'pointerleave', 900, 20);
    while (frame()) { /* run to rest */ }

    expect(scene.seen).toMatchObject({ inside: true, down: true });
  });

  it('marks a draggable scene so touch does not scroll the page', () => {
    const { canvas } = mount(makeScene({ drag: true }));

    expect(canvas.getAttribute('data-drag')).toBe('true');
  });
});

describe('mountErrorStage: goo', () => {
  it('draws a goo scene through its own filter and paints the overlay above it', () => {
    const paintOverlay = vi.fn();
    const scene = makeScene({ goo: true, paintOverlay });
    const { card, canvas } = mount(scene);
    const filter = card.querySelector('filter');
    const overlay = card.querySelector('canvas[data-role="audio-error-gloss"]');

    expect(filter?.id).toBeTruthy();
    expect(canvas.style.filter).toContain(`#${filter?.id}`);
    expect(overlay).not.toBeNull();
    expect(paintOverlay).toHaveBeenCalledTimes(1);
  });

  it('gives two cards different filter ids', () => {
    const first = mount(makeScene({ goo: true, paintOverlay: vi.fn() }));
    const second = mount(makeScene({ goo: true, paintOverlay: vi.fn() }));

    expect(first.card.querySelector('filter')?.id).not.toBe(second.card.querySelector('filter')?.id);
  });

  it('adds no filter for a plain scene', () => {
    const { card, canvas } = mount(makeScene());

    expect(card.querySelector('filter')).toBeNull();
    expect(canvas.style.filter).toBe('');
  });
});

describe('mountErrorStage: teardown', () => {
  it('stops everything on destroy', () => {
    const scene = makeScene();
    const { canvas, destroy } = mount(scene);

    show(1);
    destroy();
    vi.advanceTimersByTime(BREAK_DELAY_MS);
    pointerAt(canvas, 'pointermove', 5, 5);

    expect(frames).toHaveLength(0);
    expect(scene.steps).toBe(0);
    expect(FakeIntersectionObserver.last?.disconnect).toHaveBeenCalled();
    expect(FakeResizeObserver.last?.disconnect).toHaveBeenCalled();
  });

  it('does nothing where the browser cannot watch the card', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const scene = makeScene();
    const card = document.createElement('div');
    const canvas = document.createElement('canvas');

    card.append(canvas);

    expect(() => mountErrorStage(canvas, card, scene).destroy()).not.toThrow();
    expect(scene.layouts).toHaveLength(0);
  });
});
