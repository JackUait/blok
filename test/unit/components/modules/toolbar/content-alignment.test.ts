import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  computeVisualContentOffset,
  resolveVisualContentWidth,
} from '../../../../../src/components/modules/toolbar/content-alignment';
import { DATA_ATTR } from '../../../../../src/components/constants';

/**
 * Regression tests for the horizontal alignment logic used by the Toolbar.
 *
 * The core bug: when a block is stretched (e.g. the `database` tool calls
 * `block.stretched = true`), `[data-blok-element-content]` fills the holder's
 * full width and the naive `contentRect.left - holderRect.left` collapses to
 * zero — so the toolbar's plus button + drag handle snap to the holder's
 * far-left edge, hundreds of pixels away from the visible database content
 * that re-centers via internal CSS padding.
 *
 * These tests lock in the fix so it can never regress.
 */
describe('toolbar content-alignment helpers', () => {
  const ORIGINAL_GET_PROPERTY_VALUE = CSSStyleDeclaration.prototype.getPropertyValue;

  const makeRect = (left: number, width: number): DOMRect => {
    const right = left + width;

    return {
      left,
      right,
      top: 0,
      bottom: 0,
      width,
      height: 0,
      x: left,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };

  beforeEach(() => {
    /*
     * jsdom does not evaluate CSS custom properties. Patch `getPropertyValue`
     * to return a stable `--max-width-content` so the helpers exercise the
     * stretched branch end-to-end.
     */
    CSSStyleDeclaration.prototype.getPropertyValue = function patched(property: string): string {
      if (property === '--max-width-content') {
        return '720px';
      }

      return '';
    };
  });

  afterEach(() => {
    CSSStyleDeclaration.prototype.getPropertyValue = ORIGINAL_GET_PROPERTY_VALUE;
  });

  describe('computeVisualContentOffset', () => {
    it('returns 0 when wrapper rect is unavailable', () => {
      const holder = document.createElement('div');
      const contentRect = makeRect(0, 720);

      expect(computeVisualContentOffset(holder, contentRect, undefined)).toBe(0);
    });

    it('uses the literal gap between holder and content for non-stretched blocks', () => {
      const holder = document.createElement('div');
      const wrapperRect = makeRect(0, 1400);
      const contentRect = makeRect(340, 720);

      expect(computeVisualContentOffset(holder, contentRect, wrapperRect)).toBe(340);
    });

    it('clamps the gap to 0 when content extends past the holder on the left', () => {
      const holder = document.createElement('div');
      const wrapperRect = makeRect(100, 1200);
      const contentRect = makeRect(50, 720);

      expect(computeVisualContentOffset(holder, contentRect, wrapperRect)).toBe(0);
    });

    it('centers against --max-width-content when the block is stretched and wider than the content lane', () => {
      const holder = document.createElement('div');

      holder.setAttribute(DATA_ATTR.stretched, 'true');

      const wrapperRect = makeRect(0, 1400);
      /*
       * Mirrors the real database layout: content element fills the holder
       * (stretched) so raw contentRect.left === holderRect.left. Without the
       * fix the toolbar would snap to offset 0 and render at the far-left of
       * the editor.
       */
      const contentRect = makeRect(0, 1400);

      expect(computeVisualContentOffset(holder, contentRect, wrapperRect)).toBe(340);
    });

    it('falls back to the raw gap for stretched blocks that are narrower than --max-width-content', () => {
      const holder = document.createElement('div');

      holder.setAttribute(DATA_ATTR.stretched, 'true');

      /*
       * When the holder is narrower than the content lane (e.g. mobile or a
       * nested stretched block), the centered-lane formula would produce a
       * negative offset — fall back to the raw gap so the toolbar at least
       * hugs the holder's left edge.
       */
      const wrapperRect = makeRect(0, 500);
      const contentRect = makeRect(0, 500);

      expect(computeVisualContentOffset(holder, contentRect, wrapperRect)).toBe(0);
    });

    /*
     * Lock the centering math across representative holder widths so anyone
     * touching `computeVisualContentOffset` has to update these numbers
     * deliberately. Constant lane width = 720px (--max-width-content).
     */
    it.each([
      { holderWidth: 800, expected: 40 },
      { holderWidth: 1024, expected: 152 },
      { holderWidth: 1400, expected: 340 },
      { holderWidth: 1920, expected: 600 },
      { holderWidth: 2400, expected: 840 },
    ])(
      'stretched block in a $holderWidth px holder centers toolbar at offset $expected',
      ({ holderWidth, expected }) => {
        const holder = document.createElement('div');

        holder.setAttribute(DATA_ATTR.stretched, 'true');

        const wrapperRect = makeRect(0, holderWidth);
        const contentRect = makeRect(0, holderWidth);

        expect(computeVisualContentOffset(holder, contentRect, wrapperRect)).toBe(expected);
      }
    );

    it('ignores stretched attribute values other than literal "true"', () => {
      const holder = document.createElement('div');

      /*
       * The StyleManager writes `data-blok-stretched="true"` as a literal
       * string; the helper MUST NOT treat an empty attribute or any other
       * value as stretched (otherwise non-stretched blocks silently snap to
       * the content lane).
       */
      holder.setAttribute(DATA_ATTR.stretched, '');

      const wrapperRect = makeRect(0, 1400);
      const contentRect = makeRect(340, 720);

      expect(computeVisualContentOffset(holder, contentRect, wrapperRect)).toBe(340);
    });
  });

  describe('resolveVisualContentWidth', () => {
    it('returns contentRect.width for non-stretched blocks', () => {
      const holder = document.createElement('div');
      const wrapperRect = makeRect(0, 1400);
      const contentRect = makeRect(340, 720);

      expect(resolveVisualContentWidth(holder, contentRect, wrapperRect)).toBe(720);
    });

    it('clamps to --max-width-content for stretched blocks wider than the content lane', () => {
      const holder = document.createElement('div');

      holder.setAttribute(DATA_ATTR.stretched, 'true');

      const wrapperRect = makeRect(0, 1400);
      const contentRect = makeRect(0, 1400);

      expect(resolveVisualContentWidth(holder, contentRect, wrapperRect)).toBe(720);
    });

    it('falls back to contentRect.width for stretched blocks narrower than the content lane', () => {
      const holder = document.createElement('div');

      holder.setAttribute(DATA_ATTR.stretched, 'true');

      const wrapperRect = makeRect(0, 500);
      const contentRect = makeRect(0, 500);

      expect(resolveVisualContentWidth(holder, contentRect, wrapperRect)).toBe(500);
    });
  });
});
