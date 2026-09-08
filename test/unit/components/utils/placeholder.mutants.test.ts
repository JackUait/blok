import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  getPlaceholderClasses,
  isContentEmpty,
  setCaretToStart,
  setupPlaceholder,
  PLACEHOLDER_ACTIVE_CLASSES,
  PLACEHOLDER_CLASSES,
  PLACEHOLDER_FOCUS_ONLY_CLASSES,
} from '../../../../src/components/utils/placeholder';

const host = (html: string): HTMLElement => {
  const element = document.createElement('div');

  element.innerHTML = html;
  document.body.appendChild(element);

  return element;
};

/** Park the caret on a node of its own, so a mutant that fails to move it shows. */
const parkedElsewhere = (): HTMLElement => {
  const other = host('elsewhere');
  const range = document.createRange();
  const selection = window.getSelection();

  range.selectNodeContents(other);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);

  return other;
};

const anchor = (): { node: Node | null; offset: number } => {
  const selection = window.getSelection();

  return { node: selection?.anchorNode ?? null, offset: selection?.anchorOffset ?? -1 };
};

/**
 * One survivor is equivalent: blanking the 'always' case label. That case
 * carries no body of its own — it falls straight through to `default`, which
 * returns the same array — so no visibility string can tell the two apart.
 */
describe('placeholder mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  describe('reading emptiness', () => {
    it('treats whitespace and a lone break as empty', () => {
      expect(isContentEmpty(host('   '))).toBe(true);
      expect(isContentEmpty(host(' <br> '))).toBe(true);
      expect(isContentEmpty(host('x'))).toBe(false);
    });
  });

  describe('placing the caret', () => {
    it('moves it to the start of the element, dropping whatever was selected', () => {
      parkedElsewhere();

      const element = host('hello');

      setCaretToStart(element);

      expect(anchor()).toStrictEqual({ node: element, offset: 0 });
    });

    it('clears a lone break so the element reads as empty', () => {
      const element = host('<br>');

      setCaretToStart(element);

      expect(element.innerHTML).toBe('');
    });

    it('does nothing when there is no selection to move', () => {
      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      expect(() => setCaretToStart(host(''))).not.toThrow();
    });
  });

  describe('class lookup', () => {
    it('maps each visibility to its own array', () => {
      expect(getPlaceholderClasses('always')).toBe(PLACEHOLDER_CLASSES);
      expect(getPlaceholderClasses('always-active')).toBe(PLACEHOLDER_ACTIVE_CLASSES);
      expect(getPlaceholderClasses('focus')).toBe(PLACEHOLDER_FOCUS_ONLY_CLASSES);
    });
  });

  describe('setting a host up', () => {
    it('stamps an empty attribute when no placeholder was given', () => {
      const element = host('');

      setupPlaceholder(element);

      expect(element.getAttribute('data-placeholder')).toBe('');
      expect(element.getAttribute('data-blok-placeholder-visible')).toBe('always');
    });

    // ARIA role tokens are case-insensitive and may be padded, so the raw
    // attribute is not the thing to look up.
    it('mirrors the text onto aria for a padded role that supports it', () => {
      const element = host('');

      element.setAttribute('role', '  TextBox  ');
      setupPlaceholder(element, 'Type here');

      expect(element.getAttribute('aria-placeholder')).toBe('Type here');
    });

    it('leaves aria alone on a role that does not support the attribute', () => {
      const element = host('');

      element.setAttribute('role', 'generic');
      setupPlaceholder(element, 'Type here');

      expect(element.getAttribute('aria-placeholder')).toBeNull();
    });

    it('puts the caret at the start when an empty host takes focus', () => {
      parkedElsewhere();

      const element = host('');

      setupPlaceholder(element, 'Type here');
      element.dispatchEvent(new Event('focus'));

      expect(anchor()).toStrictEqual({ node: element, offset: 0 });
    });

    it('leaves the caret alone when the host already has content', () => {
      const parked = parkedElsewhere();
      const element = host('written');

      setupPlaceholder(element);
      element.dispatchEvent(new Event('focus'));

      expect(anchor().node).toBe(parked);
    });

    it('stops answering focus once torn down', () => {
      const parked = parkedElsewhere();
      const element = host('');
      const teardown = setupPlaceholder(element, 'Type here');

      teardown();
      element.dispatchEvent(new Event('focus'));

      expect(anchor().node).toBe(parked);
      expect(element.getAttribute('data-placeholder')).toBeNull();
      expect(element.getAttribute('data-blok-placeholder-visible')).toBeNull();
    });
  });
});
