/**
 * Unit tests for the centralized CSS Top Layer helper.
 *
 * The helper is the single source of truth for promoting/removing blok-owned
 * elements into the browser Top Layer via the HTML Popover API. Centralizing
 * this prevents the bug where new floating-UI elements get promoted but miss
 * the corresponding CSS reset for UA `[popover]` defaults (modal-dialog
 * positioning that pins the element to the bottom-right corner of the viewport).
 *
 * Every blok element promoted via this helper is tagged with the
 * `data-blok-top-layer` marker attribute so a single CSS rule can neutralize
 * the UA defaults for ALL current and future call sites.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isPromotedToTopLayer,
  promoteToTopLayer,
  removeFromTopLayer,
  supportsPopoverAPI,
  TOP_LAYER_MARKER_ATTR,
} from '../../../../src/components/utils/top-layer';

type PopoverAPIPolyfillState = {
  showCalls: HTMLElement[];
  hideCalls: HTMLElement[];
};

const installPopoverAPIPolyfill = (): PopoverAPIPolyfillState => {
  const state: PopoverAPIPolyfillState = {
    showCalls: [],
    hideCalls: [],
  };

  /**
   * jsdom 28 does not implement the HTML Popover API. Without a polyfill the
   * helper would short-circuit via the feature detect and we could not assert
   * the side effects of `showPopover()` / `hidePopover()`.
   */
  Object.defineProperty(HTMLElement.prototype, 'popover', {
    configurable: true,
    get(this: HTMLElement) {
      return this.getAttribute('popover');
    },
    set(this: HTMLElement, value: string | null) {
      if (value === null) {
        this.removeAttribute('popover');

        return;
      }

      this.setAttribute('popover', value);
    },
  });

  Object.defineProperty(HTMLElement.prototype, 'showPopover', {
    configurable: true,
    writable: true,
    value(this: HTMLElement) {
      state.showCalls.push(this);
    },
  });

  Object.defineProperty(HTMLElement.prototype, 'hidePopover', {
    configurable: true,
    writable: true,
    value(this: HTMLElement) {
      state.hideCalls.push(this);
    },
  });

  return state;
};

const uninstallPopoverAPIPolyfill = (): void => {
  /**
   * Each prop name is iterated explicitly to avoid the dynamic-delete lint
   * rule that triggers on `delete obj[computedKey]`.
   */
  if ('popover' in HTMLElement.prototype) {
    Reflect.deleteProperty(HTMLElement.prototype, 'popover');
  }
  if ('showPopover' in HTMLElement.prototype) {
    Reflect.deleteProperty(HTMLElement.prototype, 'showPopover');
  }
  if ('hidePopover' in HTMLElement.prototype) {
    Reflect.deleteProperty(HTMLElement.prototype, 'hidePopover');
  }
};

describe('Top Layer helper', () => {
  describe('TOP_LAYER_MARKER_ATTR', () => {
    it('exports a stable marker attribute name that the CSS reset rule targets', () => {
      /**
       * The CSS rule in src/styles/main.css depends on this exact attribute
       * name. If anyone renames the export, the CSS coverage test in
       * test/unit/styles/top-layer-css.test.ts will also fail and force a
       * coordinated update.
       */
      expect(TOP_LAYER_MARKER_ATTR).toBe('data-blok-top-layer');
    });
  });

  describe('without Popover API support', () => {
    beforeEach(() => {
      uninstallPopoverAPIPolyfill();
    });

    it('reports the API as unsupported', () => {
      expect(supportsPopoverAPI()).toBe(false);
    });

    it('promoteToTopLayer still tags the marker attribute so scoped CSS tokens resolve (returns false because popover cannot actually open)', () => {
      /**
       * The `[data-blok-top-layer]` scope in colors.css lets tokens like
       * `--blok-image-lightbox-backdrop` reach promoted elements appended to
       * document.body. That indirection must work even on browsers without
       * the Popover API, so the marker is set unconditionally; only the
       * `popover` attribute is gated on API support.
       */
      const el = document.createElement('div');

      const result = promoteToTopLayer(el);

      expect(result).toBe(false);
      expect(el.hasAttribute('popover')).toBe(false);
      expect(el.getAttribute(TOP_LAYER_MARKER_ATTR)).toBe('true');
    });

    it('removeFromTopLayer strips the marker even without Popover API support (cleans up after unsupported-path promote)', () => {
      const el = document.createElement('div');
      el.setAttribute(TOP_LAYER_MARKER_ATTR, 'true');

      expect(() => removeFromTopLayer(el)).not.toThrow();
      expect(el.hasAttribute('popover')).toBe(false);
      expect(el.hasAttribute(TOP_LAYER_MARKER_ATTR)).toBe(false);
    });
  });

  describe('with Popover API support', () => {
    let polyfillState: PopoverAPIPolyfillState;

    beforeEach(() => {
      polyfillState = installPopoverAPIPolyfill();
    });

    afterEach(() => {
      uninstallPopoverAPIPolyfill();
    });

    it('reports the API as supported', () => {
      expect(supportsPopoverAPI()).toBe(true);
    });

    describe('promoteToTopLayer', () => {
      it('sets popover="manual" so the element opts into manual UA show/hide control', () => {
        const el = document.createElement('div');

        promoteToTopLayer(el);

        expect(el.getAttribute('popover')).toBe('manual');
      });

      it('sets the marker attribute so the CSS reset rule applies', () => {
        const el = document.createElement('div');

        promoteToTopLayer(el);

        expect(el.getAttribute(TOP_LAYER_MARKER_ATTR)).toBe('true');
      });

      it('calls showPopover() exactly once on the element to promote it into the Top Layer', () => {
        const el = document.createElement('div');

        promoteToTopLayer(el);

        expect(polyfillState.showCalls).toEqual([el]);
      });

      it('returns true on success', () => {
        const el = document.createElement('div');

        expect(promoteToTopLayer(el)).toBe(true);
      });

      it('does not re-set popover="manual" when the attribute is already present (idempotent)', () => {
        const el = document.createElement('div');

        el.setAttribute('popover', 'manual');

        const setAttributeSpy = vi.spyOn(el, 'setAttribute');

        promoteToTopLayer(el);

        const popoverWrites = setAttributeSpy.mock.calls.filter(([name]) => name === 'popover');

        expect(popoverWrites).toHaveLength(0);
      });

      it('returns false and does NOT crash when showPopover() throws (e.g. element already open)', () => {
        const el = document.createElement('div');

        Object.defineProperty(el, 'showPopover', {
          configurable: true,
          value: () => {
            throw new Error('InvalidStateError');
          },
        });

        expect(promoteToTopLayer(el)).toBe(false);
      });
    });

    describe('removeFromTopLayer', () => {
      it('calls hidePopover() to demote the element from the Top Layer', () => {
        const el = document.createElement('div');

        promoteToTopLayer(el);

        polyfillState.hideCalls.length = 0;

        removeFromTopLayer(el);

        expect(polyfillState.hideCalls).toEqual([el]);
      });

      it('removes the popover attribute so UA `[popover]:not(:popover-open)` display:none no longer applies', () => {
        const el = document.createElement('div');

        promoteToTopLayer(el);
        removeFromTopLayer(el);

        expect(el.hasAttribute('popover')).toBe(false);
      });

      it('removes the marker attribute so the CSS reset no longer applies', () => {
        const el = document.createElement('div');

        promoteToTopLayer(el);
        removeFromTopLayer(el);

        expect(el.hasAttribute(TOP_LAYER_MARKER_ATTR)).toBe(false);
      });

      it('does not crash when called on an element that was never promoted', () => {
        const el = document.createElement('div');

        expect(() => removeFromTopLayer(el)).not.toThrow();
      });

      it('does not crash when hidePopover() throws (e.g. element not open)', () => {
        const el = document.createElement('div');

        promoteToTopLayer(el);

        Object.defineProperty(el, 'hidePopover', {
          configurable: true,
          value: () => {
            throw new Error('InvalidStateError');
          },
        });

        expect(() => removeFromTopLayer(el)).not.toThrow();
        expect(el.hasAttribute('popover')).toBe(false);
        expect(el.hasAttribute(TOP_LAYER_MARKER_ATTR)).toBe(false);
      });
    });

    describe('isPromotedToTopLayer', () => {
      it('returns false for a fresh element', () => {
        const el = document.createElement('div');

        expect(isPromotedToTopLayer(el)).toBe(false);
      });

      it('returns true after promoteToTopLayer', () => {
        const el = document.createElement('div');

        promoteToTopLayer(el);

        expect(isPromotedToTopLayer(el)).toBe(true);
      });

      it('returns false after removeFromTopLayer', () => {
        const el = document.createElement('div');

        promoteToTopLayer(el);
        removeFromTopLayer(el);

        expect(isPromotedToTopLayer(el)).toBe(false);
      });
    });
  });
});
