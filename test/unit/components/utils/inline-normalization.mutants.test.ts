import { describe, it, expect } from 'vitest';

import {
  normalizeInlineMarkupHtml,
  normalizeInlineMarkupIn,
} from '../../../../src/components/utils/inline-normalization';
import { MAX_NORMALIZATION_SWEEPS } from '../../../../src/shared/inline-normalization-policy';

const holder = (html: string): HTMLElement => {
  const root = document.createElement('div');

  root.innerHTML = html;

  return root;
};

/**
 * Seventeen survivors are equivalent, in five groups.
 *
 * The isCandidate guards (both operands, the early return in the redundant
 * filter and the filter before the merge pass) are an optimization only. The
 * policy re-rejects every non-mergeable tag on its own: decoratesNothing
 * answers false for a tag outside the decorative set, and duplicatesAncestor
 * and areInterchangeable both answer false for a tag outside the mergeable
 * one. Letting a paragraph through changes how much work is done, never what
 * is done. The stillPresent half is likewise always true where it is read —
 * both call sites run against a query taken after the previous pass finished.
 *
 * The whole html === '' || !html.includes('<') guard is the same shape one
 * level up. A string with no markup parses to a tree with no elements, so no
 * sweep can change it, so the function returns the caller's string verbatim
 * either way. That is why all six of its mutants survive: the guard saves a
 * parse, and the "return html unless something collapsed" line is what
 * actually keeps a string safe.
 *
 * The parent === null guard in unwrap never fires: unwrap only ever runs over
 * elements collected from a live query in the same statement, and unwrapping
 * an ancestor leaves its descendants attached to the ancestor's parent.
 *
 * The two sweep-cap mutants (remaining === 0 and remaining - 1) only matter
 * when the cap actually trips. A sweep reports true only when it removed at
 * least one element, and it removes every element it can see, so a second
 * sweep is needed only where a removal exposed a new one — and every fixture
 * here, the 1025-wrapper run included, converges in two. That the cap is
 * unreachable for ALL markup is argued, not measured.
 *
 * The textContent fallback and normalize?.() are dead by typing: textContent
 * is null only on a Document or a DocumentType, and every ParentNode inherits
 * normalize from Node.
 */
describe('inline normalization mutants', () => {
  describe('walking to the root', () => {
    // A fragment is a ParentNode but not an Element, so its children report a
    // null parentElement — the only shape that reaches the null guard.
    it('stops at a parent that is not an element', () => {
      const fragment = document.createDocumentFragment();

      fragment.append(holder('<b><i>x</i></b>').firstChild ?? document.createTextNode(''));

      expect(() => normalizeInlineMarkupIn(fragment)).not.toThrow();
    });

    it('does not count the root itself as an ancestor', () => {
      const root = document.createElement('b');

      root.innerHTML = '<b>x</b>';

      expect(normalizeInlineMarkupIn(root)).toBe(false);
      expect(root.innerHTML).toBe('<b>x</b>');
    });
  });

  describe('absorbing siblings', () => {
    it('reports no change for a lone wrapper', () => {
      const root = holder('<b>x</b>');

      expect(normalizeInlineMarkupIn(root)).toBe(false);
      expect(root.innerHTML).toBe('<b>x</b>');
    });

    it('reports no change for two wrappers that express different formatting', () => {
      const root = holder('<b>x</b><i>y</i>');

      expect(normalizeInlineMarkupIn(root)).toBe(false);
      expect(root.innerHTML).toBe('<b>x</b><i>y</i>');
    });

    it('merges a run of identical wrappers into one', () => {
      const root = holder('<b>a</b><b>b</b><b>c</b>');

      expect(normalizeInlineMarkupIn(root)).toBe(true);
      expect(root.innerHTML).toBe('<b>abc</b>');
    });

    // Without the recursive call each sweep only halves a run, so a run longer
    // than 2^MAX_NORMALIZATION_SWEEPS cannot finish inside the cap. This is the
    // shortest run that separates the two.
    it('finishes a run too long to halve within the sweep cap', () => {
      const root = document.createElement('div');
      const count = 2 ** MAX_NORMALIZATION_SWEEPS + 1;

      for (let index = 0; index < count; index += 1) {
        const wrapper = document.createElement('b');

        wrapper.textContent = 'x';
        root.appendChild(wrapper);
      }

      expect(normalizeInlineMarkupIn(root)).toBe(true);
      expect(root.children).toHaveLength(1);
    });
  });

  describe('joining the text back up', () => {
    it('leaves untouched text nodes separate', () => {
      const root = document.createElement('div');

      root.append(document.createTextNode('a'), document.createTextNode('b'));

      expect(normalizeInlineMarkupIn(root)).toBe(false);
      expect(root.childNodes).toHaveLength(2);
    });

    it('joins the text an unwrapped wrapper left adjacent', () => {
      const root = holder('a<b></b>b');

      expect(normalizeInlineMarkupIn(root)).toBe(true);
      expect(root.childNodes).toHaveLength(1);
      expect(root.textContent).toBe('ab');
    });
  });

  describe('the html entry point', () => {
    it('returns a string with nothing to collapse verbatim', () => {
      expect(normalizeInlineMarkupHtml('')).toBe('');
      expect(normalizeInlineMarkupHtml('plain text')).toBe('plain text');
    });

    // Re-serializing is lossy for anything that is not markup, so a string the
    // sweep did not change must come back byte for byte.
    it('never re-serializes a string it did not change', () => {
      expect(normalizeInlineMarkupHtml('if (a<b) { }')).toBe('if (a<b) { }');
      expect(normalizeInlineMarkupHtml('5 < 6 && 7 > 8')).toBe('5 < 6 && 7 > 8');
    });

    it('re-serializes only when something collapsed', () => {
      expect(normalizeInlineMarkupHtml('<b>a</b><b>b</b>')).toBe('<b>ab</b>');
    });
  });
});
