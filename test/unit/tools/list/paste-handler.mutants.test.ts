import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  detectStyleFromPastedContent,
  extractPastedContent,
  extractDepthFromPastedContent,
} from '../../../../src/tools/list/paste-handler';

/**
 * Mutant-directed cover for the list paste handler.
 *
 * Standard used while triaging: a mutant is equivalent only when NO reachable
 * input distinguishes it from the original, faulted DOM objects included.
 *
 * One mutant is left alive, and it is equivalent:
 *
 * - line 197, `domNestingDepth > 0` widened to `>= 0`. The guarded branch
 *   returns `domNestingDepth`; falling past it returns the literal 0. The count
 *   it comes from is an ancestor tally minus one, so the value is an integer of
 *   at least -1, and the two conditions disagree on exactly one value of it —
 *   zero — where the guarded branch returns 0 and the fallthrough returns 0.
 *   No input can tell the two apart.
 */
describe('list paste handler — mutant cover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('data-list-style stamp', () => {
    it('reads an unordered stamp off a detached item', () => {
      const li = document.createElement('li');

      li.setAttribute('data-list-style', 'unordered');

      expect(detectStyleFromPastedContent(li, 'ordered')).toBe('unordered');
    });
  });

  describe('inline list-style-type', () => {
    it('accepts whitespace before the colon', () => {
      const li = document.createElement('li');

      li.setAttribute('style', 'list-style-type : decimal');

      expect(detectStyleFromPastedContent(li, 'unordered')).toBe('ordered');
    });

    it('accepts no whitespace after the colon', () => {
      const li = document.createElement('li');

      li.setAttribute('style', 'list-style-type:decimal');

      expect(detectStyleFromPastedContent(li, 'unordered')).toBe('ordered');
    });

    it('trims the captured value before matching it', () => {
      const li = document.createElement('li');

      // The declaration is padded, so the capture keeps a trailing space.
      li.setAttribute('style', 'list-style-type: decimal ;');

      expect(detectStyleFromPastedContent(li, 'unordered')).toBe('ordered');
    });

    it('falls back when the style attribute carries no list-style-type', () => {
      const li = document.createElement('li');

      li.setAttribute('style', 'color: red');

      expect(detectStyleFromPastedContent(li, 'checklist')).toBe('checklist');
    });

    it('falls back on a list-style-type it does not recognise', () => {
      const li = document.createElement('li');

      li.setAttribute('style', 'list-style-type: foo');

      expect(detectStyleFromPastedContent(li, 'ordered')).toBe('ordered');
    });
  });

  describe('checkbox detection', () => {
    it('treats a bare checkbox input as a checklist item', () => {
      const input = document.createElement('input');

      input.type = 'checkbox';

      expect(detectStyleFromPastedContent(input, 'unordered')).toBe('checklist');
    });

    it('leaves a bare text input alone', () => {
      const input = document.createElement('input');

      input.type = 'text';

      expect(detectStyleFromPastedContent(input, 'unordered')).toBe('unordered');
    });

    it('ignores a checkbox-looking type on an element that is not an input', () => {
      // HTMLLIElement reflects the obsolete `type` attribute, so an <li> can
      // report `type === 'checkbox'` while being nothing of the sort.
      const li = document.createElement('li');

      li.setAttribute('type', 'checkbox');

      expect(li.type).toBe('checkbox');
      expect(detectStyleFromPastedContent(li, 'unordered')).toBe('unordered');
    });

    it('reads a checkbox out of a detached item with no list ancestor', () => {
      const li = document.createElement('li');
      const checkbox = document.createElement('input');

      checkbox.type = 'checkbox';
      li.appendChild(checkbox);

      expect(detectStyleFromPastedContent(li, 'unordered')).toBe('checklist');
    });
  });

  describe('extractPastedContent', () => {
    it('trims the text left behind after the checkbox is stripped', () => {
      const li = document.createElement('li');

      li.innerHTML = '<input type="checkbox"> Task';

      expect(extractPastedContent(li).text).toBe('Task');
    });
  });

  describe('extractDepthFromPastedContent', () => {
    it('counts nesting up the ancestor chain when aria-level is absent', () => {
      // The sibling-nested shape: the inner <ul> is a child of the outer <ul>,
      // not of an <li>. It puts two list elements next to each other in the
      // ancestor chain, which is what separates a running total from any
      // sign-alternating one.
      const outer = document.createElement('ul');
      const first = document.createElement('li');
      const inner = document.createElement('ul');
      const target = document.createElement('li');

      first.textContent = 'Root item';
      target.textContent = 'Nested item';
      inner.appendChild(target);
      outer.appendChild(first);
      outer.appendChild(inner);

      expect(extractDepthFromPastedContent(target)).toBe(1);
    });
  });
});
