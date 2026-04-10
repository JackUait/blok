import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BlokConfig } from '../../types';
import type { BlokModules } from '../../src/types-internal/blok-modules';

// Mock VERSION global variable
declare global {
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
  let mockScrollTo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    originalScrollTo = window.scrollTo;
    originalQuerySelector = document.querySelector.bind(document);

    // Replace window.scrollTo with a spy
    mockScrollTo = vi.fn();
    window.scrollTo = mockScrollTo as unknown as typeof window.scrollTo;

    // Reset document.querySelector to a default spy that returns null;
    // individual tests override this when they need a specific element returned.
    document.querySelector = vi.fn().mockReturnValue(null) as typeof document.querySelector;

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

  it('scrolls to the matching block when hash is present, accounting for scrollY', async () => {
    setHash('#abc123XYZ0');

    // Use a non-zero scrollY to verify the computation: top = rect.top + scrollY - topOffset
    Object.defineProperty(window, 'scrollY', { value: 100, writable: true, configurable: true });

    const el = fakeEl(200);

    document.querySelector = vi.fn((selector: string): Element | null => {
      if (selector === '[data-blok-id="abc123XYZ0"]') {
        return el;
      }

      return originalQuerySelector(selector);
    }) as typeof document.querySelector;

    const editor = new Blok({} as BlokConfig);

    await editor.isReady;

    // Expected: 200 (rect.top) + 100 (scrollY) - 0 (topOffset) = 300
    expect(mockScrollTo).toHaveBeenCalledWith({ top: 300, behavior: 'smooth' });
  });

  // -------------------------------------------------------------------------

  it('applies topOffset when scrollToBlock.topOffset is configured', async () => {
    setHash('#abc123XYZ0');

    const el = fakeEl(200);

    document.querySelector = vi.fn((selector: string): Element | null => {
      if (selector === '[data-blok-id="abc123XYZ0"]') {
        return el;
      }

      return originalQuerySelector(selector);
    }) as typeof document.querySelector;

    const editor = new Blok({ scrollToBlock: { topOffset: 80 } } as BlokConfig);

    await editor.isReady;

    // Expected: 200 (rect.top) + 0 (scrollY) - 80 (topOffset) = 120
    expect(mockScrollTo).toHaveBeenCalledWith({ top: 120, behavior: 'smooth' });
  });

  // -------------------------------------------------------------------------

  it('does not scroll when hash is empty', async () => {
    setHash('');

    const editor = new Blok({} as BlokConfig);

    await editor.isReady;

    // When hash is empty, querySelector must NOT be called and scrollTo must NOT be called
    expect(document.querySelector).not.toHaveBeenCalled();
    expect(mockScrollTo).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------

  it('does not scroll when hash does not match any block', async () => {
    setHash('#nonExistentId');

    // querySelector already returns null from the beforeEach default spy

    const editor = new Blok({} as BlokConfig);

    await editor.isReady;

    // Verify the editor initialised successfully (observable state)
    expect(editor).toBeDefined();
    // Implementation must have attempted a DOM lookup (behavioral contract: hash was present)
    expect(document.querySelector).toHaveBeenCalled();
    // …but scrollTo must NOT be called because the element wasn't found
    expect(mockScrollTo).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------

  it('defaults topOffset to 0 when scrollToBlock is omitted', async () => {
    setHash('#someBlock');

    const el = fakeEl(300);

    document.querySelector = vi.fn((selector: string): Element | null => {
      if (selector === '[data-blok-id="someBlock"]') {
        return el;
      }

      return originalQuerySelector(selector);
    }) as typeof document.querySelector;

    // No scrollToBlock in config
    const editor = new Blok({} as BlokConfig);

    await editor.isReady;

    // Expected: 300 (rect.top) + 0 (scrollY) - 0 (topOffset default) = 300
    expect(mockScrollTo).toHaveBeenCalledWith({ top: 300, behavior: 'smooth' });
  });
});
