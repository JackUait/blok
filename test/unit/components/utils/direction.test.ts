import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getElementDirection,
  inlineStartOffset,
  logicalArrow,
  scrollFromInlineStart,
} from '../../../../src/components/utils/direction';

const mount = (dir: 'ltr' | 'rtl' | null): HTMLElement => {
  const host = document.createElement('div');

  if (dir !== null) {
    host.setAttribute('dir', dir);
  }

  const child = document.createElement('p');

  host.appendChild(child);
  document.body.appendChild(host);

  return child;
};

describe('direction utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('getElementDirection', () => {
    it('reads the inherited direction of an element', () => {
      expect(getElementDirection(mount('rtl'))).toBe('rtl');
      expect(getElementDirection(mount('ltr'))).toBe('ltr');
    });

    it('lets a nearer dir override the editor', () => {
      const inner = mount('rtl');

      inner.setAttribute('dir', 'ltr');

      expect(getElementDirection(inner)).toBe('ltr');
    });

    it('falls back to ltr for a missing element', () => {
      expect(getElementDirection(null)).toBe('ltr');
      expect(getElementDirection(undefined)).toBe('ltr');
    });
  });

  describe('logicalArrow', () => {
    it('maps ArrowRight to forward and ArrowLeft to backward in LTR', () => {
      expect(logicalArrow('ArrowRight', 'ltr')).toBe('forward');
      expect(logicalArrow('ArrowLeft', 'ltr')).toBe('backward');
    });

    it('swaps the horizontal arrows in RTL', () => {
      expect(logicalArrow('ArrowRight', 'rtl')).toBe('backward');
      expect(logicalArrow('ArrowLeft', 'rtl')).toBe('forward');
    });

    it('ignores keys that are not horizontal arrows', () => {
      expect(logicalArrow('ArrowUp', 'rtl')).toBeNull();
      expect(logicalArrow('Enter', 'ltr')).toBeNull();
    });
  });

  describe('inlineStartOffset', () => {
    const rect = { left: 100, right: 400 };

    it('measures from the left edge in LTR', () => {
      expect(inlineStartOffset(130, rect, 'ltr')).toBe(30);
    });

    it('measures from the right edge in RTL', () => {
      expect(inlineStartOffset(370, rect, 'rtl')).toBe(30);
    });
  });

  describe('scrollFromInlineStart', () => {
    const scroller = (scrollLeft: number): HTMLElement => {
      const element = document.createElement('div');

      Object.defineProperty(element, 'scrollLeft', { value: scrollLeft, configurable: true });

      return element;
    };

    it('returns scrollLeft unchanged in LTR', () => {
      expect(scrollFromInlineStart(scroller(40), 'ltr')).toBe(40);
    });

    // Browsers report RTL scrollLeft as 0 at the start and negative toward the end.
    it('returns a non-negative distance from the start in RTL', () => {
      expect(scrollFromInlineStart(scroller(-40), 'rtl')).toBe(40);
      expect(scrollFromInlineStart(scroller(0), 'rtl')).toBe(0);
    });
  });
});
