import { describe, expect, it } from 'vitest';

import { isNativeCrossHostPaintTrusted } from '../../../../src/components/selection/cross-block-highlight';

describe('cross-block-highlight', () => {
  describe('isNativeCrossHostPaintTrusted', () => {
    const host = (): HTMLElement => document.createElement('div');

    it('trusts an engine that reports the selection reaching both hosts', () => {
      expect(isNativeCrossHostPaintTrusted(host(), host(), false)).toBe(true);
    });

    /**
     * WebKit reports anchor and focus clamped to the anchor host while
     * `getRangeAt(0)` still spans — and paints exactly what it reports.
     */
    it('distrusts an engine that reports both ends in one host', () => {
      const anchorHost = host();

      expect(isNativeCrossHostPaintTrusted(anchorHost, anchorHost, false)).toBe(false);
    });

    /**
     * Direction is not a signal: a backwards drag reports the anchor in the
     * LATER host, and its native paint is just as correct.
     */
    it('trusts a backwards drag, where the anchor host follows the focus host', () => {
      const first = host();
      const second = host();

      document.body.append(first, second);

      expect(isNativeCrossHostPaintTrusted(second, first, false)).toBe(true);
    });

    it('distrusts an engine caught clamping the range, whatever it now reports', () => {
      expect(isNativeCrossHostPaintTrusted(host(), host(), true)).toBe(false);
    });

    it('distrusts an engine reporting an end outside any editing host', () => {
      expect(isNativeCrossHostPaintTrusted(null, host(), false)).toBe(false);
      expect(isNativeCrossHostPaintTrusted(host(), null, false)).toBe(false);
    });
  });
});
