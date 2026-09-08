import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Mutation-focused cover for the polyfill module.
 *
 * The module is a side-effect module whose every branch is a top-level guard,
 * so each case has to re-import it (`vi.resetModules()`) with the globals it
 * probes set up first. Nothing here observes the module directly — the only
 * evidence is what it writes onto `Element.prototype` and onto whatever object
 * `globalThis.window` points at.
 */
const POLYFILLS_PATH = '../../../src/components/polyfills';

interface MutableGlobal {
  window?: unknown;
  Element?: unknown;
  setTimeout?: unknown;
  clearTimeout?: unknown;
  requestAnimationFrame?: unknown;
  cancelAnimationFrame?: unknown;
  requestIdleCallback?: unknown;
  cancelIdleCallback?: unknown;
}

interface ScrollPrototype {
  scrollIntoViewIfNeeded?: (centerIfNeeded?: boolean) => void;
}

/**
 * A stand-in for `window` that is NOT `globalThis`.
 *
 * In jsdom (and in a browser) `globalThis === window`, which makes the two
 * `globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window)`
 * blocks unreachable: whatever installs the property on one installs it on the
 * other. Pointing `globalThis.window` at a separate object is the only way to
 * drive those blocks at all.
 */
interface FakeWindow {
  requestIdleCallback?: unknown;
  cancelIdleCallback?: unknown;
  requestAnimationFrame?: unknown;
  cancelAnimationFrame?: unknown;
  setTimeout: (handler: () => void, timeout?: number) => number;
  clearTimeout: (handle?: number) => void;
  performance: { now: () => number };
}

const mutableGlobal = globalThis as unknown as MutableGlobal;
const elementPrototype = Element.prototype as ScrollPrototype;
const mapPrototype = Map.prototype as unknown as {
  delete: (this: Map<unknown, unknown>, key: unknown) => boolean;
};

const savedWindow = mutableGlobal.window;
const savedElement = mutableGlobal.Element;
const savedSetTimeout = mutableGlobal.setTimeout;
const savedClearTimeout = mutableGlobal.clearTimeout;
const savedRequestAnimationFrame = mutableGlobal.requestAnimationFrame;
const savedCancelAnimationFrame = mutableGlobal.cancelAnimationFrame;
const savedRequestIdleCallback = mutableGlobal.requestIdleCallback;
const savedCancelIdleCallback = mutableGlobal.cancelIdleCallback;
const savedScrollIntoViewIfNeeded = elementPrototype.scrollIntoViewIfNeeded;

const loadPolyfills = async (): Promise<void> => {
  vi.resetModules();
  await import(POLYFILLS_PATH);
};

const takeInstalledScrollIntoViewIfNeeded = (): ((centerIfNeeded?: boolean) => void) => {
  const installed = elementPrototype.scrollIntoViewIfNeeded;

  if (typeof installed !== 'function') {
    throw new Error('polyfills did not install Element.prototype.scrollIntoViewIfNeeded');
  }

  return installed;
};

const defineNumber = (element: HTMLElement, property: string, value: number): void => {
  Object.defineProperty(element, property, {
    configurable: true,
    get: () => value,
  });
};

// Border widths are non-zero and different from each other so a mutant that
// swaps one for the other, or drops one, lands on its own number.
const BORDER_TOP_WIDTH = 7;
const BORDER_LEFT_WIDTH = 11;

interface Geometry {
  parentOffsetTop: number;
  parentOffsetLeft: number;
  parentClientHeight: number;
  parentClientWidth: number;
  parentScrollTop: number;
  parentScrollLeft: number;
  childOffsetTop: number;
  childOffsetLeft: number;
  childClientHeight: number;
  childClientWidth: number;
}

interface ScrollOutcome {
  scrollTop: number;
  scrollLeft: number;
  scrollIntoViewCalls: unknown[];
}

/**
 * Runs the polyfill over one fabricated layout and reports every effect it can
 * have: both scroll axes AND the `scrollIntoView` arguments.
 *
 * All three travel together because asserting one axis alone survives every
 * mutant that only moves the other.
 */
const measure = (geometry: Geometry, centerIfNeeded?: boolean): ScrollOutcome => {
  const parent: HTMLElement = document.createElement('div');
  const child: HTMLElement = document.createElement('div');
  const scrollIntoViewCalls: unknown[] = [];
  let scrollTop = geometry.parentScrollTop;
  let scrollLeft = geometry.parentScrollLeft;

  defineNumber(parent, 'offsetTop', geometry.parentOffsetTop);
  defineNumber(parent, 'offsetLeft', geometry.parentOffsetLeft);
  defineNumber(parent, 'clientHeight', geometry.parentClientHeight);
  defineNumber(parent, 'clientWidth', geometry.parentClientWidth);
  defineNumber(child, 'offsetTop', geometry.childOffsetTop);
  defineNumber(child, 'offsetLeft', geometry.childOffsetLeft);
  defineNumber(child, 'clientHeight', geometry.childClientHeight);
  defineNumber(child, 'clientWidth', geometry.childClientWidth);

  Object.defineProperty(parent, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  Object.defineProperty(parent, 'scrollLeft', {
    configurable: true,
    get: () => scrollLeft,
    set: (value: number) => {
      scrollLeft = value;
    },
  });
  Object.defineProperty(child, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: (alignToTop?: boolean): void => {
      scrollIntoViewCalls.push(alignToTop);
    },
  });

  parent.appendChild(child);
  document.body.appendChild(parent);

  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: (property: string): string => {
      if (property === 'border-top-width') {
        return `${BORDER_TOP_WIDTH}px`;
      }

      if (property === 'border-left-width') {
        return `${BORDER_LEFT_WIDTH}px`;
      }

      return '0';
    },
  } as unknown as CSSStyleDeclaration));

  takeInstalledScrollIntoViewIfNeeded().call(child, centerIfNeeded);
  parent.remove();

  return { scrollTop, scrollLeft, scrollIntoViewCalls };
};

/*
 * Every layout below is hand-solved so that the original and each arithmetic or
 * comparison mutant land on a DIFFERENT number. `*_EDGE` layouts sit exactly on
 * a comparison's boundary, which is the only input that separates `<` from `<=`
 * and `>` from `>=`.
 */

// overTop false, overBottom true, overLeft false, overRight true.
const BOTH_AXES: Geometry = {
  parentOffsetTop: 5,
  parentOffsetLeft: 3,
  parentClientHeight: 100,
  parentClientWidth: 120,
  parentScrollTop: 0,
  parentScrollLeft: 0,
  childOffsetTop: 400,
  childOffsetLeft: 500,
  childClientHeight: 20,
  childClientWidth: 30,
};

// overTop only: 50 - 5 = 45 < 52, and the `+` mutant gives 55 which is not.
const ABOVE_VIEWPORT: Geometry = {
  parentOffsetTop: 5,
  parentOffsetLeft: 3,
  parentClientHeight: 100,
  parentClientWidth: 120,
  parentScrollTop: 52,
  parentScrollLeft: 0,
  childOffsetTop: 50,
  childOffsetLeft: 10,
  childClientHeight: 20,
  childClientWidth: 30,
};

// overTop's boundary: 50 - 5 === 45 === scrollTop, so `<` is false and `<=` true.
const TOP_EDGE: Geometry = {
  ...ABOVE_VIEWPORT,
  parentScrollTop: 45,
};

// overBottom only: 60 - 5 + 60 - 7 = 108 > 100.
const BELOW_VIEWPORT: Geometry = {
  parentOffsetTop: 5,
  parentOffsetLeft: 3,
  parentClientHeight: 100,
  parentClientWidth: 120,
  parentScrollTop: 0,
  parentScrollLeft: 0,
  childOffsetTop: 60,
  childOffsetLeft: 10,
  childClientHeight: 60,
  childClientWidth: 30,
};

// overBottom's boundary: 60 - 5 + 52 - 7 === 100 === scrollTop + clientHeight.
const BOTTOM_EDGE: Geometry = {
  ...BELOW_VIEWPORT,
  childClientHeight: 52,
};

// overLeft only: 50 - 3 = 47 < 50, and the `+` mutant gives 53 which is not.
const LEFT_OF_VIEWPORT: Geometry = {
  parentOffsetTop: 5,
  parentOffsetLeft: 3,
  parentClientHeight: 100,
  parentClientWidth: 120,
  parentScrollTop: 0,
  parentScrollLeft: 50,
  childOffsetTop: 10,
  childOffsetLeft: 50,
  childClientHeight: 20,
  childClientWidth: 30,
};

// overLeft's boundary: 50 - 3 === 47 === scrollLeft.
const LEFT_EDGE: Geometry = {
  ...LEFT_OF_VIEWPORT,
  parentScrollLeft: 47,
};

// overRight only: 60 - 3 + 80 - 11 = 126 > 120.
const RIGHT_OF_VIEWPORT: Geometry = {
  parentOffsetTop: 5,
  parentOffsetLeft: 3,
  parentClientHeight: 100,
  parentClientWidth: 120,
  parentScrollTop: 0,
  parentScrollLeft: 0,
  childOffsetTop: 10,
  childOffsetLeft: 60,
  childClientHeight: 20,
  childClientWidth: 80,
};

// overRight's boundary: 60 - 3 + 74 - 11 === 120 === scrollLeft + clientWidth.
const RIGHT_EDGE: Geometry = {
  ...RIGHT_OF_VIEWPORT,
  childClientWidth: 74,
};

const makeFakeWindow = (
  scheduled: Array<{ fn: () => void; delay: number | undefined }>,
  cleared: unknown[],
): FakeWindow => ({
  setTimeout: (handler: () => void, timeout?: number): number => {
    scheduled.push({ fn: handler,
      delay: timeout });

    return 99;
  },
  clearTimeout: (handle?: number): void => {
    cleared.push(handle);
  },
  performance: { now: () => 42 },
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  mutableGlobal.window = savedWindow;
  mutableGlobal.Element = savedElement;
  mutableGlobal.setTimeout = savedSetTimeout;
  mutableGlobal.clearTimeout = savedClearTimeout;
  mutableGlobal.requestAnimationFrame = savedRequestAnimationFrame;
  mutableGlobal.cancelAnimationFrame = savedCancelAnimationFrame;
  mutableGlobal.requestIdleCallback = savedRequestIdleCallback;
  mutableGlobal.cancelIdleCallback = savedCancelIdleCallback;

  // Assigning `undefined` would leave an own property behind, which is not the
  // state jsdom starts in; the whole descriptor has to go.
  if (savedScrollIntoViewIfNeeded === undefined) {
    Reflect.deleteProperty(Element.prototype, 'scrollIntoViewIfNeeded');
  } else {
    elementPrototype.scrollIntoViewIfNeeded = savedScrollIntoViewIfNeeded;
  }

  vi.restoreAllMocks();
});

describe('polyfills — Element.prototype.scrollIntoViewIfNeeded install guard', () => {
  it('installs the polyfill when the engine has none', async () => {
    elementPrototype.scrollIntoViewIfNeeded = undefined;

    await loadPolyfills();

    expect(typeof elementPrototype.scrollIntoViewIfNeeded).toBe('function');
  });

  it('leaves a native implementation untouched', async () => {
    const native = (): void => undefined;

    elementPrototype.scrollIntoViewIfNeeded = native;

    await loadPolyfills();

    expect(elementPrototype.scrollIntoViewIfNeeded).toBe(native);
  });

  it('skips the whole block when Element is not a global', async () => {
    elementPrototype.scrollIntoViewIfNeeded = undefined;
    Reflect.deleteProperty(globalThis, 'Element');

    await expect(loadPolyfills()).resolves.toBeUndefined();

    expect(elementPrototype.scrollIntoViewIfNeeded).toBeUndefined();
  });
});

describe('polyfills — scrollIntoViewIfNeeded centering', () => {
  beforeEach(async () => {
    elementPrototype.scrollIntoViewIfNeeded = undefined;
    await loadPolyfills();
  });

  it('centres both axes when centerIfNeeded is omitted', () => {
    expect(measure(BOTH_AXES)).toStrictEqual({
      scrollTop: 348,
      scrollLeft: 441,
      scrollIntoViewCalls: [],
    });
  });

  it('centres both axes when centerIfNeeded is explicitly true', () => {
    expect(measure(BOTH_AXES, true)).toStrictEqual({
      scrollTop: 348,
      scrollLeft: 441,
      scrollIntoViewCalls: [],
    });
  });

  it('centres only the vertical axis when nothing overflows horizontally', () => {
    expect(measure(BELOW_VIEWPORT)).toStrictEqual({
      scrollTop: 28,
      scrollLeft: 0,
      scrollIntoViewCalls: [],
    });
  });

  it('centres only the vertical axis for an element above the viewport', () => {
    expect(measure(ABOVE_VIEWPORT)).toStrictEqual({
      scrollTop: -2,
      scrollLeft: 0,
      scrollIntoViewCalls: [],
    });
  });

  it('centres only the horizontal axis for an element left of the viewport', () => {
    expect(measure(LEFT_OF_VIEWPORT)).toStrictEqual({
      scrollTop: 0,
      scrollLeft: -9,
      scrollIntoViewCalls: [],
    });
  });

  it('centres only the horizontal axis for an element right of the viewport', () => {
    expect(measure(RIGHT_OF_VIEWPORT)).toStrictEqual({
      scrollTop: 0,
      scrollLeft: 26,
      scrollIntoViewCalls: [],
    });
  });
});

describe('polyfills — scrollIntoViewIfNeeded without centering', () => {
  beforeEach(async () => {
    elementPrototype.scrollIntoViewIfNeeded = undefined;
    await loadPolyfills();
  });

  it('delegates to scrollIntoView without aligning to the top', () => {
    expect(measure(BOTH_AXES, false)).toStrictEqual({
      scrollTop: 0,
      scrollLeft: 0,
      scrollIntoViewCalls: [ false ],
    });
  });

  it('aligns to the top only when the element overflows upward alone', () => {
    expect(measure(ABOVE_VIEWPORT, false)).toStrictEqual({
      scrollTop: 52,
      scrollLeft: 0,
      scrollIntoViewCalls: [ true ],
    });
  });

  it('does not align to the top when only the bottom overflows', () => {
    expect(measure(BELOW_VIEWPORT, false)).toStrictEqual({
      scrollTop: 0,
      scrollLeft: 0,
      scrollIntoViewCalls: [ false ],
    });
  });

  it('does not align to the top when only the left edge overflows', () => {
    expect(measure(LEFT_OF_VIEWPORT, false)).toStrictEqual({
      scrollTop: 0,
      scrollLeft: 50,
      scrollIntoViewCalls: [ false ],
    });
  });

  it('does not align to the top when only the right edge overflows', () => {
    expect(measure(RIGHT_OF_VIEWPORT, false)).toStrictEqual({
      scrollTop: 0,
      scrollLeft: 0,
      scrollIntoViewCalls: [ false ],
    });
  });
});

describe('polyfills — scrollIntoViewIfNeeded overflow boundaries', () => {
  beforeEach(async () => {
    elementPrototype.scrollIntoViewIfNeeded = undefined;
    await loadPolyfills();
  });

  it('treats an element flush with the top of the scroll port as in view', () => {
    expect(measure(TOP_EDGE, false)).toStrictEqual({
      scrollTop: 45,
      scrollLeft: 0,
      scrollIntoViewCalls: [],
    });
  });

  it('treats an element flush with the bottom of the scroll port as in view', () => {
    expect(measure(BOTTOM_EDGE, false)).toStrictEqual({
      scrollTop: 0,
      scrollLeft: 0,
      scrollIntoViewCalls: [],
    });
  });

  it('treats an element flush with the left of the scroll port as in view', () => {
    expect(measure(LEFT_EDGE, false)).toStrictEqual({
      scrollTop: 0,
      scrollLeft: 47,
      scrollIntoViewCalls: [],
    });
  });

  it('treats an element flush with the right of the scroll port as in view', () => {
    expect(measure(RIGHT_EDGE, false)).toStrictEqual({
      scrollTop: 0,
      scrollLeft: 0,
      scrollIntoViewCalls: [],
    });
  });

  it('does nothing for an element with no parent', async () => {
    // No getComputedStyle stub here on purpose: the real jsdom one throws for a
    // null element, so a mutant that drops the early return blows up.
    elementPrototype.scrollIntoViewIfNeeded = undefined;
    await loadPolyfills();

    const polyfilled = takeInstalledScrollIntoViewIfNeeded();
    const orphan: HTMLElement = document.createElement('div');

    expect(() => {
      polyfilled.call(orphan);
    }).not.toThrow();
  });
});

describe('polyfills — window-backed API guards', () => {
  it('installs every missing window API on a window that is not globalThis', async () => {
    const scheduled: Array<{ fn: () => void; delay: number | undefined }> = [];
    const cleared: unknown[] = [];
    const fakeWindow = makeFakeWindow(scheduled, cleared);
    const frames: number[] = [];

    mutableGlobal.window = fakeWindow;
    Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
    Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');

    await loadPolyfills();

    const windowRaf = fakeWindow.requestAnimationFrame as (callback: (time: number) => void) => number;
    const windowCaf = fakeWindow.cancelAnimationFrame as (handle: number) => void;

    expect(typeof windowRaf).toBe('function');
    expect(typeof windowCaf).toBe('function');
    expect(typeof fakeWindow.requestIdleCallback).toBe('function');
    expect(typeof fakeWindow.cancelIdleCallback).toBe('function');

    const frameHandle = windowRaf((time) => {
      frames.push(time);
    });

    expect(frameHandle).toBe(99);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.delay).toBe(16);

    scheduled[0]?.fn();

    expect(frames).toStrictEqual([ 42 ]);

    windowCaf(7);

    expect(cleared).toStrictEqual([ 7 ]);

    // The globalThis copies are bound wrappers, so identity — not `typeof` —
    // is what proves the two bridging blocks ran.
    expect(typeof mutableGlobal.requestAnimationFrame).toBe('function');
    expect(mutableGlobal.requestAnimationFrame).not.toBe(fakeWindow.requestAnimationFrame);
    expect(typeof mutableGlobal.cancelAnimationFrame).toBe('function');
    expect(mutableGlobal.cancelAnimationFrame).not.toBe(fakeWindow.cancelAnimationFrame);
  });

  it('leaves every already-present API alone', async () => {
    const scheduled: Array<{ fn: () => void; delay: number | undefined }> = [];
    const cleared: unknown[] = [];
    const nativeRaf = (): number => 1;
    const nativeCaf = (): void => undefined;
    const nativeRic = (): number => 2;
    const nativeCic = (): void => undefined;
    const globalRaf = (): number => 3;
    const globalCaf = (): void => undefined;
    const fakeWindow: FakeWindow = {
      ...makeFakeWindow(scheduled, cleared),
      requestAnimationFrame: nativeRaf,
      cancelAnimationFrame: nativeCaf,
      requestIdleCallback: nativeRic,
      cancelIdleCallback: nativeCic,
    };

    mutableGlobal.window = fakeWindow;
    mutableGlobal.requestAnimationFrame = globalRaf;
    mutableGlobal.cancelAnimationFrame = globalCaf;

    await loadPolyfills();

    expect(fakeWindow.requestAnimationFrame).toBe(nativeRaf);
    expect(fakeWindow.cancelAnimationFrame).toBe(nativeCaf);
    expect(fakeWindow.requestIdleCallback).toBe(nativeRic);
    expect(fakeWindow.cancelIdleCallback).toBe(nativeCic);
    expect(mutableGlobal.requestAnimationFrame).toBe(globalRaf);
    expect(mutableGlobal.cancelAnimationFrame).toBe(globalCaf);
    expect(scheduled).toStrictEqual([]);
    expect(cleared).toStrictEqual([]);
  });

  it('touches nothing when window is not defined', async () => {
    elementPrototype.scrollIntoViewIfNeeded = undefined;
    Reflect.deleteProperty(globalThis, 'window');
    // Load-bearing: without these deletions the globalThis-bridging guards
    // short-circuit on their second operand and a mutated first operand never
    // reaches the `window.…` dereference that proves it changed.
    Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
    Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
    Reflect.deleteProperty(globalThis, 'requestIdleCallback');
    Reflect.deleteProperty(globalThis, 'cancelIdleCallback');

    await expect(loadPolyfills()).resolves.toBeUndefined();

    expect(mutableGlobal.requestAnimationFrame).toBeUndefined();
    expect(mutableGlobal.cancelAnimationFrame).toBeUndefined();
    expect(mutableGlobal.requestIdleCallback).toBeUndefined();
    expect(mutableGlobal.cancelIdleCallback).toBeUndefined();
    // The Element block does not depend on window, so it still runs.
    expect(typeof elementPrototype.scrollIntoViewIfNeeded).toBe('function');
  });
});

describe('polyfills — requestIdleCallback', () => {
  let currentNow = 1000;
  let scheduled: Array<{ fn: () => void; delay: number | undefined }> = [];
  let cleared: unknown[] = [];
  let fakeWindow: FakeWindow;

  /**
   * Loads the module with `globalThis.setTimeout` / `clearTimeout` replaced, so
   * the handles the polyfill stores are ours.
   *
   * `setTimeout` is put back as soon as the module has evaluated: the module
   * binds it once at load time, and leaving a non-firing timer installed for
   * the rest of the test is a hazard for the runner, not for the polyfill.
   * `clearTimeout` has to stay, because `cancelIdleCallback` looks it up live.
   */
  const loadWithTimerStubs = async (handles: unknown[], fireSynchronously = false): Promise<void> => {
    let index = 0;

    scheduled = [];
    cleared = [];
    fakeWindow = makeFakeWindow(scheduled, cleared);
    mutableGlobal.window = fakeWindow;
    mutableGlobal.setTimeout = (handler: () => void, timeout?: number): unknown => {
      scheduled.push({ fn: handler,
        delay: timeout });
      const handle = handles[Math.min(index, handles.length - 1)];

      index += 1;

      if (fireSynchronously) {
        handler();
      }

      return handle;
    };
    mutableGlobal.clearTimeout = (handle: unknown): void => {
      cleared.push(handle);
    };

    await loadPolyfills();

    mutableGlobal.setTimeout = savedSetTimeout;
    vi.spyOn(Date, 'now').mockImplementation(() => currentNow);
  };

  const idleApi = (): {
    request: (callback: IdleRequestCallback) => number;
    cancel: (handle: number) => void;
  } => {
    const request = fakeWindow.requestIdleCallback as (callback: IdleRequestCallback) => number;
    const cancel = fakeWindow.cancelIdleCallback as (handle: number) => void;

    if (typeof request !== 'function' || typeof cancel !== 'function') {
      throw new Error('polyfills did not install the idle-callback API');
    }

    return { request,
      cancel };
  };

  beforeEach(() => {
    currentNow = 1000;
  });

  it('defers the callback and reports a shrinking deadline', async () => {
    await loadWithTimerStubs([ 5 ]);

    const deadlines: IdleDeadline[] = [];
    const handle = idleApi().request((deadline) => {
      deadlines.push(deadline);
    });

    expect(handle).toBe(5);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.delay).toBe(1);
    expect(deadlines).toHaveLength(0);

    currentNow = 1020;
    scheduled[0]?.fn();

    expect(deadlines).toHaveLength(1);

    const deadline = deadlines[0];

    if (deadline === undefined) {
      throw new Error('the idle callback was never invoked');
    }

    expect(deadline.didTimeout).toBe(false);
    expect(deadline.timeRemaining()).toBe(30);

    currentNow = 1100;

    expect(deadline.timeRemaining()).toBe(0);

    // Firing the timer removes the map entry, so cancelling afterwards must not
    // reach the native clearTimeout — only the unconditional pass-through runs.
    idleApi().cancel(handle);

    expect(cleared).toStrictEqual([ 5 ]);
  });

  it('cancels a pending callback exactly once', async () => {
    await loadWithTimerStubs([ 12 ]);

    const handle = idleApi().request(() => undefined);

    expect(handle).toBe(12);

    idleApi().cancel(handle);
    idleApi().cancel(handle);
    idleApi().cancel(999);

    expect(cleared).toStrictEqual([ 12, 12, 12, 999 ]);
  });

  it('falls back to a clock reading when the timer handle is unusable', async () => {
    await loadWithTimerStubs([ 7, 0, -3, {} ]);

    const { request } = idleApi();
    const handles: number[] = [];

    handles.push(request(() => undefined));
    currentNow = 2000;
    handles.push(request(() => undefined));
    currentNow = 3000;
    handles.push(request(() => undefined));
    currentNow = 4000;
    handles.push(request(() => undefined));

    expect(handles).toStrictEqual([ 7, 2000, 3000, 4000 ]);
  });

  it('deletes nothing when the timer fires before its handle is recorded', async () => {
    // A timer that runs its callback before `setTimeout` returns leaves the
    // handle unassigned, and the polyfill must not reach into the registry with
    // it. The registry is module-private, so the only way to watch is to patch
    // `Map.prototype.delete` for the one synchronous call.
    await loadWithTimerStubs([ 5 ], true);

    const { request } = idleApi();
    const deleteCalls: unknown[] = [];
    const realDelete = mapPrototype.delete;
    let callbackRuns = 0;

    mapPrototype.delete = function trackDelete(this: Map<unknown, unknown>, key: unknown): boolean {
      deleteCalls.push(key);

      return realDelete.call(this, key);
    };

    try {
      request(() => {
        callbackRuns += 1;
      });
    } finally {
      mapPrototype.delete = realDelete;
    }

    expect(deleteCalls).toStrictEqual([]);
    expect(callbackRuns).toBe(1);
  });
});

/*
 * The `typeof handle === 'number'` guard has no observable effect
 * through the module's own API: `handleRef.value` is either a number, where
 * both branches delete the same key, or `undefined`, where
 * `Map<number, TimeoutHandle>.delete(undefined)` returns false and mutates
 * nothing. "Deletes nothing when the timer fires before its handle is recorded"
 * pins it anyway by watching `Map.prototype.delete` itself for that one call.
 */
