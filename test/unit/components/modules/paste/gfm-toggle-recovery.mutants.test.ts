import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { recoverGfmToggles } from '../../../../../src/components/modules/paste/gfm-toggle-recovery';

/**
 * Mutant-directed cases for `recoverGfmToggles`. Each one pins a decision the
 * behavioural suite reaches but never observes, so a mutation of that decision
 * changes the returned string.
 *
 * Five mutants in this module are provably equivalent and are deliberately not
 * chased:
 *
 * 1. `node.textContent ?? ''` default (the `''` operand). The predicate only
 *    runs for nodes that already passed `nodeType === Node.TEXT_NODE`, and a
 *    Text node's `textContent` is its `data` — a string, never null. The `??`
 *    right-hand side is unreachable, so replacing it cannot change anything.
 * 2. `li === null` in `toggleFromList`. The line above returns unless
 *    `ul.children.length === 1`, and one element child means
 *    `firstElementChild` is that element. The comparison is always false, so
 *    forcing it to false is a no-op.
 * 3-5. The `children.length < 2` and `title === undefined` operands of the
 *    title guard, and the `||` joining them. `title` is undefined only when
 *    `children.length === 0`, which the length operand already catches; the
 *    only divergence left is `children.length === 1` with a `<p>` first child,
 *    where the mutant walks on with an empty `body` and the non-list-body check
 *    (`![].some(...)` is true) returns null on the very next line. Output is
 *    identical for every input.
 *
 * Source note, reported not fixed: the cheap gate is `/<ul[\s>]/i`, which does
 * not match a self-closing `<ul/>` even though the HTML parser still builds a
 * real `<ul>` from it. Such a clipboard is never recovered. The first test pins
 * the gate as the thing that decides; a future widening of the regex is
 * expected to change it.
 */

/** The single-item GFM shape, ready to be dropped into different wrappers. */
const TOGGLE_ITEM = '<li><p>title</p><p>body</p></li>';
const RECOVERED = '<details open=""><summary>title</summary><p>body</p></details>';

describe('recoverGfmToggles — mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('the cheap <ul> gate', () => {
    it('leaves a self-closing <ul/> alone even though it parses into a real list', () => {
      // The parser turns `<ul/>` into `<ul>`, so the shape below WOULD qualify;
      // only the regex gate keeps it out.
      const input = `<ul/>${TOGGLE_ITEM}</ul>`;

      expect(recoverGfmToggles(input)).toBe(input);
    });

    it('still recovers a toggle whose <ul> carries attributes', () => {
      // `<ul ` is matched by a whitespace class, not by a non-whitespace one.
      const input = `<ul class='x'>${TOGGLE_ITEM}</ul>`;

      expect(recoverGfmToggles(input)).toBe(RECOVERED);
    });
  });

  describe('the returned string when nothing is recovered', () => {
    it('returns the caller string, not the re-serialized parse', () => {
      // Single quotes come back as single quotes: re-serializing would normalize
      // them to double quotes and hand the paste pipeline a rewritten payload.
      const input = "<ul class='x'><li>a</li></ul>";

      expect(recoverGfmToggles(input)).toBe(input);
    });
  });

  describe('a list is a toggle only when it has exactly one item', () => {
    it('does not convert a multi-item list whose first item is toggle-shaped', () => {
      const input = `<ul>${TOGGLE_ITEM}<li>second</li></ul>`;

      expect(recoverGfmToggles(input)).toBe(input);
    });
  });

  describe('the lone child has to be an <li>', () => {
    it('does not convert a <ul> holding one toggle-shaped <div>', () => {
      const input = '<ul><div><p>title</p><p>body</p></div></ul>';

      expect(recoverGfmToggles(input)).toBe(input);
    });
  });

  describe('inline text inside the item', () => {
    it('does not convert an item that mixes stray text between its blocks', () => {
      const input = '<ul><li><p>title</p>stray<p>body</p></li></ul>';

      expect(recoverGfmToggles(input)).toBe(input);
    });

    it('converts an item whose only loose text is the whitespace between blocks', () => {
      // Serializers indent their markup; treating that whitespace as a label
      // would refuse every pretty-printed toggle.
      const input = '<ul><li><p>title</p> <p>body</p></li></ul>';

      expect(recoverGfmToggles(input)).toBe(RECOVERED);
    });
  });

  describe('the body needs one non-list block, not only non-list blocks', () => {
    it('converts an item whose body mixes a paragraph and a nested list', () => {
      const input = '<ul><li><p>title</p><p>body</p><ul><li>x</li></ul></li></ul>';

      expect(recoverGfmToggles(input)).toBe(
        '<details open=""><summary>title</summary><p>body</p><ul><li>x</li></ul></details>'
      );
    });
  });
});
