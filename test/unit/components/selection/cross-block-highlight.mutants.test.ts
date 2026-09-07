import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  isCrossBlockHighlightSupported,
  paintCrossBlockHighlight,
  clearCrossBlockHighlight,
  isNativeCrossHostPaintTrusted,
} from '../../../../src/components/selection/cross-block-highlight';

/** The registry key the ::highlight() rule in main.css targets. */
const HIGHLIGHT_NAME = 'blok-cross-block-selection';

interface Registry {
  set: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

interface Engine {
  registry: Registry;
  constructed: Range[][];
}

const originals = new Map<string, PropertyDescriptor | undefined>();

const defineGlobal = (name: string, value: unknown): void => {
  if (!originals.has(name)) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }

  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
};

const removeGlobal = (name: string): void => {
  if (!originals.has(name)) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }

  Reflect.deleteProperty(globalThis, name);
};

const restoreGlobals = (): void => {
  for (const [name, descriptor] of originals) {
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis, name);
    } else {
      Object.defineProperty(globalThis, name, descriptor);
    }
  }

  originals.clear();
};

/** An engine that supports custom highlights, with its registry recorded. */
const supportingEngine = (): Engine => {
  const registry: Registry = { set: vi.fn(), delete: vi.fn() };
  const constructed: Range[][] = [];

  defineGlobal('CSS', { highlights: registry });
  defineGlobal('Highlight', function Highlight(this: unknown, ...ranges: Range[]) {
    constructed.push(ranges);
  });

  return { registry, constructed };
};

const someRange = (): Range => {
  const host = document.createElement('div');

  host.textContent = 'text';
  document.body.appendChild(host);

  const range = document.createRange();

  range.selectNodeContents(host);

  return range;
};

describe('cross-block highlight mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    restoreGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('isCrossBlockHighlightSupported', () => {
    it('is true on an engine with a highlight registry and constructor', () => {
      supportingEngine();

      expect(isCrossBlockHighlightSupported()).toBe(true);
    });

    it('is false where CSS itself is missing', () => {
      removeGlobal('CSS');
      defineGlobal('Highlight', function Highlight() { /* present */ });

      expect(isCrossBlockHighlightSupported()).toBe(false);
    });

    it('is false where CSS carries no highlight registry', () => {
      defineGlobal('CSS', {});
      defineGlobal('Highlight', function Highlight() { /* present */ });

      expect(isCrossBlockHighlightSupported()).toBe(false);
    });

    it('is false where the Highlight constructor is missing', () => {
      defineGlobal('CSS', { highlights: { set: vi.fn(), delete: vi.fn() } });
      removeGlobal('Highlight');

      expect(isCrossBlockHighlightSupported()).toBe(false);
    });
  });

  describe('paintCrossBlockHighlight', () => {
    it('registers one highlight holding every sub-range, under the css rule name', () => {
      const engine = supportingEngine();
      const ranges = [someRange(), someRange()];

      paintCrossBlockHighlight('editor-a', ranges);

      expect(engine.registry.set).toHaveBeenCalledTimes(1);
      expect(engine.registry.set.mock.calls[0][0]).toBe(HIGHLIGHT_NAME);
      expect(engine.constructed).toHaveLength(1);
      expect(engine.constructed[0]).toStrictEqual(ranges);
    });

    it('paints nothing when there are no sub-ranges', () => {
      const engine = supportingEngine();

      paintCrossBlockHighlight('editor-a', []);

      expect(engine.registry.set).not.toHaveBeenCalled();
    });

    it('paints nothing on an engine that cannot hold a highlight', () => {
      const registry: Registry = { set: vi.fn(), delete: vi.fn() };

      defineGlobal('CSS', { highlights: registry });
      removeGlobal('Highlight');

      paintCrossBlockHighlight('editor-a', [someRange()]);

      expect(registry.set).not.toHaveBeenCalled();
    });
  });

  describe('clearCrossBlockHighlight', () => {
    it('removes the highlight the same editor painted', () => {
      const engine = supportingEngine();

      paintCrossBlockHighlight('editor-a', [someRange()]);
      clearCrossBlockHighlight('editor-a');

      expect(engine.registry.delete).toHaveBeenCalledTimes(1);
      expect(engine.registry.delete).toHaveBeenCalledWith(HIGHLIGHT_NAME);
    });

    it('leaves another editor\'s highlight alone', () => {
      const engine = supportingEngine();

      paintCrossBlockHighlight('editor-a', [someRange()]);
      clearCrossBlockHighlight('editor-b');

      expect(engine.registry.delete).not.toHaveBeenCalled();

      clearCrossBlockHighlight('editor-a');
    });

    it('forgets the owner once cleared, so a second clear is a no-op', () => {
      const engine = supportingEngine();

      paintCrossBlockHighlight('editor-a', [someRange()]);
      clearCrossBlockHighlight('editor-a');
      clearCrossBlockHighlight('editor-a');

      expect(engine.registry.delete).toHaveBeenCalledTimes(1);
    });

    it('clears nothing on an engine that cannot hold a highlight', () => {
      const engine = supportingEngine();

      paintCrossBlockHighlight('editor-a', [someRange()]);

      const registry: Registry = { set: vi.fn(), delete: vi.fn() };

      defineGlobal('CSS', { highlights: registry });
      removeGlobal('Highlight');

      clearCrossBlockHighlight('editor-a');

      expect(registry.delete).not.toHaveBeenCalled();
      expect(engine.registry.delete).not.toHaveBeenCalled();

      supportingEngine();
      clearCrossBlockHighlight('editor-a');
    });
  });

  describe('isNativeCrossHostPaintTrusted', () => {
    const hostA = (): HTMLElement => document.createElement('div');

    it('trusts an engine reporting two different hosts', () => {
      expect(isNativeCrossHostPaintTrusted(hostA(), hostA(), false)).toBe(true);
    });

    it('does not trust an engine caught clamping a spanning range', () => {
      expect(isNativeCrossHostPaintTrusted(hostA(), hostA(), true)).toBe(false);
    });

    it('does not trust an engine reporting both ends in one host', () => {
      const host = hostA();

      expect(isNativeCrossHostPaintTrusted(host, host, false)).toBe(false);
    });

    it('does not trust a selection with no anchor host', () => {
      expect(isNativeCrossHostPaintTrusted(null, hostA(), false)).toBe(false);
    });

    it('does not trust a selection with no focus host', () => {
      expect(isNativeCrossHostPaintTrusted(hostA(), null, false)).toBe(false);
    });
  });
});
