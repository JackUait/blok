import { describe, it, expect } from 'vitest';

import { recoverGfmToggles } from '../../../../../src/components/modules/paste/gfm-toggle-recovery';

/**
 * Normalize HTML for structural comparison: strip the insignificant whitespace
 * the GFM serializer leaves between block tags so assertions read on structure,
 * not formatting.
 */
function normalize(html: string): string {
  return html.replace(/>\s+</g, '><').trim();
}

describe('recoverGfmToggles', () => {
  describe('recovers a GFM single-item toggle into <details>', () => {
    it('rewrites the real Notion/buildin toggle shape', () => {
      // Exact structure captured from a real Notion clipboard
      // (test/fixtures/notion/demo-page.clipboard.html): a collapsed toggle's
      // lossy GFM twin is a single-item list — title <p> + body <p>.
      const input = '<ul><li><p>toggle list</p><p>test</p></li></ul>';

      const output = normalize(recoverGfmToggles(input));

      expect(output).toBe('<details open=""><summary>toggle list</summary><p>test</p></details>');
    });

    it('keeps multiple body blocks and preserves inline markup in the title', () => {
      const input =
        '<ul><li><p><strong>Heading</strong></p><p>line one</p><blockquote>quote</blockquote></li></ul>';

      const output = normalize(recoverGfmToggles(input));

      expect(output).toBe(
        '<details open=""><summary><strong>Heading</strong></summary><p>line one</p><blockquote>quote</blockquote></details>'
      );
    });

    it('treats a heading body block as toggle content', () => {
      const input = '<ul><li><p>title</p><h3>section</h3></li></ul>';

      const output = normalize(recoverGfmToggles(input));

      expect(output).toBe('<details open=""><summary>title</summary><h3>section</h3></details>');
    });
  });

  describe('leaves genuine bullet lists untouched (no false positives)', () => {
    it('does not touch a multi-item list, even when an item has multiple paragraphs', () => {
      // Real Notion bullets with multi-paragraph items are always multi-item
      // (see demo-page.clipboard.html lines 30-45).
      const input =
        '<ul><li><p>[ ] asdsa</p></li><li><p>asdasd</p></li><li><p>adasd</p><p>asdasd</p></li></ul>';

      const output = recoverGfmToggles(input);

      expect(output).toBe(input);
    });

    it('does not touch a single tight bullet with inline text', () => {
      const input = '<ul><li>just a bullet</li></ul>';

      expect(recoverGfmToggles(input)).toBe(input);
    });

    it('does not touch a single-paragraph bullet (no body)', () => {
      const input = '<ul><li><p>only a label</p></li></ul>';

      expect(recoverGfmToggles(input)).toBe(input);
    });

    it('does not touch an empty bullet item', () => {
      const input = '<ul><li></li></ul>';

      expect(recoverGfmToggles(input)).toBe(input);
    });

    it('does not convert a list-only body (bullet with a sub-list) into a toggle', () => {
      // A <li> whose body is purely a nested list is an ordinary bullet with
      // sub-items, not a toggle's revealed content.
      const input = '<ul><li><p>parent</p><ul><li>child</li></ul></li></ul>';

      expect(recoverGfmToggles(input)).toBe(input);
    });

    it('does not touch an <li> whose first child is not a <p> title', () => {
      const input = '<ul><li><h3>heading first</h3><p>body</p></li></ul>';

      expect(recoverGfmToggles(input)).toBe(input);
    });

    it('does not touch a single <li> mixing inline text and blocks', () => {
      const input = '<ul><li>label<p>body</p></li></ul>';

      expect(recoverGfmToggles(input)).toBe(input);
    });
  });

  describe('passes through unrelated input', () => {
    it('returns plain HTML with no <ul> unchanged', () => {
      const input = '<p>hello</p><h2>world</h2>';

      expect(recoverGfmToggles(input)).toBe(input);
    });

    it('returns an empty string unchanged', () => {
      expect(recoverGfmToggles('')).toBe('');
    });

    it('does not touch ordered lists', () => {
      const input = '<ol><li><p>one</p><p>two</p></li></ol>';

      expect(recoverGfmToggles(input)).toBe(input);
    });
  });

  describe('recovers a toggle nested among sibling content', () => {
    it('rewrites only the single-item toggle list, leaving surrounding blocks intact', () => {
      const input =
        '<p>before</p><ul><li><p>toggle list</p><p>test</p></li></ul><ul><li>a</li><li>b</li></ul>';

      const output = normalize(recoverGfmToggles(input));

      expect(output).toBe(
        '<p>before</p><details open=""><summary>toggle list</summary><p>test</p></details><ul><li>a</li><li>b</li></ul>'
      );
    });
  });
});
