import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BlokConfig } from '../../types';
import type { Core } from '../../src/components/core';
import type { BlokModules } from '../../src/types-internal/blok-modules';

// Mock VERSION global variable
declare global {
  // eslint-disable-next-line no-var
  var VERSION: string;
}

// Define VERSION before importing blok
(global as { VERSION?: string }).VERSION = '2.31.0-test';

// Mock dependencies — must come before static import of Blok
vi.mock('../../src/components/utils/tooltip', () => ({
  destroy: vi.fn(),
}));

vi.mock('../../src/components/utils', async () => {
  const actual = await vi.importActual('../../src/components/utils');
  const defaultIsObject = (v: unknown): boolean => typeof v === 'object' && v !== null && !Array.isArray(v);
  const defaultIsFunction = (fn: unknown): boolean => typeof fn === 'function';

  return {
    ...actual,
    isObject: vi.fn().mockImplementation(defaultIsObject),
    isFunction: vi.fn().mockImplementation(defaultIsFunction),
  };
});

// Mock Core — isReady resolves immediately; moduleInstances satisfies exportAPI
vi.mock('../../src/components/core', () => {
  class MockCore {
    public configuration: Record<string, unknown> = {};
    public moduleInstances: Partial<BlokModules> = {
      API: {
        methods: {
          blocks: { clear: vi.fn(), render: vi.fn() },
          caret: { focus: vi.fn() },
          events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
          saver: { save: vi.fn() },
          rectangleSelection: {
            cancelActiveSelection: vi.fn(),
            isRectActivated: vi.fn(),
            clearSelection: vi.fn(),
            startSelection: vi.fn(),
            endSelection: vi.fn(),
          },
        },
      } as unknown as BlokModules['API'],
      EventsAPI: {
        methods: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
      } as unknown as BlokModules['EventsAPI'],
      Toolbar: { blockSettings: undefined, inlineToolbar: undefined } as unknown as BlokModules['Toolbar'],
      BlockSettings: {} as unknown as BlokModules['BlockSettings'],
      InlineToolbar: {} as unknown as BlokModules['InlineToolbar'],
      RectangleSelection: {
        cancelActiveSelection: vi.fn(),
        isRectActivated: vi.fn(),
        clearSelection: vi.fn(),
        startSelection: vi.fn(),
        endSelection: vi.fn(),
      } as unknown as BlokModules['RectangleSelection'],
    };

    public isReady: Promise<void> = Promise.resolve();
  }

  return { Core: MockCore };
});

vi.mock('@babel/register', () => ({}));
vi.mock('../../src/components/polyfills', () => ({}));

// Static import is fine after vi.mock calls due to Vitest's mock hoisting
import { Blok } from '../../src/blok';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a fake DOM element whose getBoundingClientRect().top returns the
 * given value. We don't attach it to the document — querySelector is mocked.
 */
function fakeEl(top: number): Element {
  const el = document.createElement('div');

  el.getBoundingClientRect = () =>
    ({ top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect);

  return el;
}

/**
 * Set window.location.hash via Object.defineProperty (jsdom blocks direct
 * assignment to window.location).
 */
function setHash(hash: string): void {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, hash },
    writable: true,
    configurable: true,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scroll-to-block', () => {
  let originalScrollTo: typeof window.scrollTo;
  let originalQuerySelector: typeof document.querySelector;

  beforeEach(() => {
    vi.clearAllMocks();

    originalScrollTo = window.scrollTo;
    originalQuerySelector = document.querySelector.bind(document);

    // Replace window.scrollTo with a spy
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

    // Reset hash to empty by default
    setHash('');

    // Reset scrollY to 0 (jsdom default, but be explicit)
    Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.scrollTo = originalScrollTo;
    document.querySelector = originalQuerySelector;
  });

  // -------------------------------------------------------------------------

  it('scrolls to the matching block when hash is present', async () => {
    setHash('#abc123XYZ0');

    const el = fakeEl(200);

    document.querySelector = vi.fn((selector: string) => {
      if (selector === '[data-blok-id="abc123XYZ0"]') {
        return el;
      }

      return originalQuerySelector(selector);
    }) as typeof document.querySelector;

    const editor = new Blok({} as BlokConfig);

    await editor.isReady;

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 200, behavior: 'smooth' });
  });

  // -------------------------------------------------------------------------

  it('applies topOffset when scrollToBlock.topOffset is configured', async () => {
    setHash('#abc123XYZ0');

    const el = fakeEl(200);

    document.querySelector = vi.fn((selector: string) => {
      if (selector === '[data-blok-id="abc123XYZ0"]') {
        return el;
      }

      return originalQuerySelector(selector);
    }) as typeof document.querySelector;

    const editor = new Blok({ scrollToBlock: { topOffset: 80 } } as BlokConfig);

    await editor.isReady;

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 120, behavior: 'smooth' });
  });

  // -------------------------------------------------------------------------

  it('does not scroll when hash is empty', async () => {
    setHash('');

    // Spy on window.location.hash getter — the implementation must read it
    const hashGetterSpy = vi.fn().mockReturnValue('');

    Object.defineProperty(window, 'location', {
      value: { ...window.location, get hash() { return hashGetterSpy(); } },
      writable: true,
      configurable: true,
    });

    const editor = new Blok({} as BlokConfig);

    await editor.isReady;

    // Implementation must have read window.location.hash
    expect(hashGetterSpy).toHaveBeenCalled();
    // …and must NOT have scrolled
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------

  it('does not scroll when hash does not match any block', async () => {
    setHash('#nonExistentId');

    const querySelectorSpy = vi.fn(() => null) as typeof document.querySelector;

    document.querySelector = querySelectorSpy;

    const editor = new Blok({} as BlokConfig);

    await editor.isReady;

    // Implementation must have queried for the block element
    expect(querySelectorSpy).toHaveBeenCalledWith('[data-blok-id="nonExistentId"]');
    // …but must NOT have scrolled because the element wasn't found
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------

  it('defaults topOffset to 0 when scrollToBlock is omitted', async () => {
    setHash('#someBlock');

    const el = fakeEl(300);

    document.querySelector = vi.fn((selector: string) => {
      if (selector === '[data-blok-id="someBlock"]') {
        return el;
      }

      return originalQuerySelector(selector);
    }) as typeof document.querySelector;

    // No scrollToBlock in config
    const editor = new Blok({} as BlokConfig);

    await editor.isReady;

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 300, behavior: 'smooth' });
  });
});
