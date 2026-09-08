import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DATA_ATTR } from '../../../../../src/components/constants';
import {
  computeVisualContentOffset,
  resolveVisualContentWidth,
} from '../../../../../src/components/modules/toolbar/content-alignment';

/**
 * Mutation-coverage tests for `src/components/modules/toolbar/content-alignment.ts`.
 *
 * Equivalence proof for the mutant deliberately left alive:
 *
 * - L94 `styles.getPropertyValue(token).trim()` with the `.trim()` dropped. The
 *   only consumer is `parseFloat`, whose first step trims leading whitespace
 *   using the same WhiteSpace and LineTerminator set as `String.prototype.trim`,
 *   and which then reads a leading numeric prefix only — so trailing whitespace
 *   cannot reach the parse either. Every input yields the same number.
 */

const makeRect = (left: number, width: number): DOMRect => ({
  left,
  right: left + width,
  top: 0,
  bottom: 0,
  width,
  height: 0,
  x: left,
  y: 0,
  toJSON: () => ({}),
});

const holderElement = (stretched: boolean): HTMLElement => {
  const holder = document.createElement('div');

  if (stretched) {
    holder.setAttribute(DATA_ATTR.stretched, 'true');
  }

  return holder;
};

describe('content-alignment mutants', () => {
  const stubTokens = (tokens: Record<string, string>): void => {
    vi.spyOn(CSSStyleDeclaration.prototype, 'getPropertyValue').mockImplementation(
      (property: string): string => tokens[property] ?? ''
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    stubTokens({ '--max-width-content': '720px' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('computeVisualContentOffset', () => {
    it('uses the raw gap for a stretched block when no content-width token resolves', () => {
      stubTokens({});

      const offset = computeVisualContentOffset(holderElement(true), makeRect(120, 300), makeRect(0, 800));

      expect(offset).toBe(120);
    });

    it('uses the raw gap when the holder is exactly as wide as the content lane', () => {
      const offset = computeVisualContentOffset(holderElement(true), makeRect(40, 680), makeRect(0, 720));

      expect(offset).toBe(40);
    });

    it('centers against the public token when both content-width tokens resolve', () => {
      stubTokens({
        '--blok-content-max-width': '500px',
        '--max-width-content': '900px',
      });

      const offset = computeVisualContentOffset(holderElement(true), makeRect(0, 1000), makeRect(0, 1000));

      expect(offset).toBe(250);
    });

    it('rejects a zero-width token and falls back to the next one', () => {
      stubTokens({
        '--blok-content-max-width': '0px',
        '--max-width-content': '720px',
      });

      const offset = computeVisualContentOffset(holderElement(true), makeRect(0, 1000), makeRect(0, 1000));

      expect(offset).toBe(140);
    });
  });

  describe('resolveVisualContentWidth', () => {
    it('keeps the measured content width for a non-stretched block narrower than the lane', () => {
      const width = resolveVisualContentWidth(holderElement(false), makeRect(340, 300), makeRect(0, 1200));

      expect(width).toBe(300);
    });

    it('keeps the measured content width for a non-stretched block with no wrapper rect', () => {
      const width = resolveVisualContentWidth(holderElement(false), makeRect(340, 300), undefined);

      expect(width).toBe(300);
    });

    it('keeps the measured content width for a stretched block with no wrapper rect', () => {
      const width = resolveVisualContentWidth(holderElement(true), makeRect(0, 300), undefined);

      expect(width).toBe(300);
    });

    it('keeps the measured content width for a stretched block when no token resolves', () => {
      stubTokens({});

      const width = resolveVisualContentWidth(holderElement(true), makeRect(0, 300), makeRect(0, 800));

      expect(width).toBe(300);
    });

    it('keeps the measured content width when the holder matches the lane width exactly', () => {
      const width = resolveVisualContentWidth(holderElement(true), makeRect(0, 300), makeRect(0, 720));

      expect(width).toBe(300);
    });

    it('clamps to the public token when both content-width tokens resolve', () => {
      stubTokens({
        '--blok-content-max-width': '500px',
        '--max-width-content': '900px',
      });

      const width = resolveVisualContentWidth(holderElement(true), makeRect(0, 1000), makeRect(0, 1000));

      expect(width).toBe(500);
    });

    it('clamps to the fallback token when the public one is zero', () => {
      stubTokens({
        '--blok-content-max-width': '0px',
        '--max-width-content': '720px',
      });

      const width = resolveVisualContentWidth(holderElement(true), makeRect(0, 1000), makeRect(0, 1000));

      expect(width).toBe(720);
    });
  });
});
