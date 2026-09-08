/**
 * Mutation-targeted tests for src/components/utils/caret/focus.ts.
 *
 * Equivalence proofs for the mutants that stay alive on purpose:
 *
 * - `prepend = false` default (createAndFocusTextNode signature) -> `true`.
 *   The only call site that omits the argument is the `initialNode === null`
 *   branch, and `initialNode` is null exactly when `element.childNodes` is
 *   empty. On an empty parent `insertBefore(node, parent.firstChild)` is
 *   `insertBefore(node, null)`, which is `appendChild`. Same DOM either way.
 *
 * - `range.setEnd(...)` removed on lines 27, 97 and 173.
 *   Each of the three follows a `range.setStart(...)` with identical
 *   arguments on a range straight out of `document.createRange()`, whose
 *   boundaries are (document, 0). Per the DOM spec `setStart` moves the end to
 *   the new boundary point whenever that point is after the current end or
 *   lives in another root, and (document, 0) precedes every other position, so
 *   the range is already collapsed there. Confirmed in jsdom 29: after
 *   `setStart(textNode, 3)` the end reads (textNode, 3), attached or detached.
 *   The following `setEnd` is a no-op.
 *
 * - `if (initialNode === null)` -> `false`, and its body -> `{}`.
 *   Both make the empty-element branch fall through to the next guard.
 *   `findTextNode(null, ...)` returns null, so that guard fires and calls
 *   `createAndFocusTextNode(element, atStart)`. The parent is empty in this
 *   branch, so `atStart` cannot change the outcome (see the first proof), and
 *   both paths return right after.
 *
 * - `nodeToFocus.nodeType !== Node.TEXT_NODE` -> `false`.
 *   `findTextNode` returns either null or a node it has already checked with
 *   `nodeType === Node.TEXT_NODE`. A non-null, non-text result is unreachable,
 *   so the second operand of the `||` never decides anything.
 *
 * - `nodeToFocus.textContent?.length` -> `nodeToFocus.textContent.length`.
 *   The guard above it proves `nodeToFocus` is a Text node, and `textContent`
 *   is null only for Document, DocumentType and Notation nodes. The optional
 *   chain can never short-circuit here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Dom } from '../../../../../src/components/dom';
import { focus, setSelectionToElement } from '../../../../../src/components/utils/caret/focus';

const containerState: { element: HTMLElement | null } = { element: null };

/**
 * Returns the container every fixture is mounted into.
 */
const container = (): HTMLElement => {
  if (containerState.element === null) {
    throw new Error('Container is not mounted');
  }

  return containerState.element;
};

/**
 * Returns the document selection, failing loudly when the environment has none.
 */
const requireSelection = (): Selection => {
  const selection = window.getSelection();

  if (selection === null) {
    throw new Error('Environment has no selection');
  }

  return selection;
};

/**
 * Builds a contenteditable element, optionally seeded with one text node.
 * @param text - text content to put into the element
 */
const makeEditable = (text?: string): HTMLElement => {
  const element = document.createElement('div');

  // jsdom has no contentEditable IDL setter, and only the real attribute
  // makes the element focusable.
  element.setAttribute('contenteditable', 'true');

  if (text !== undefined) {
    element.appendChild(document.createTextNode(text));
  }

  container().appendChild(element);

  return element;
};

/**
 * Returns the element's first child, asserting it is a text node.
 * @param element - element to read from
 */
const firstText = (element: HTMLElement): Text => {
  const node = element.firstChild;

  if (!(node instanceof Text)) {
    throw new Error('Expected a leading text node');
  }

  return node;
};

/**
 * Reads the caret out of the document selection.
 */
const currentCaret = (): { node: Node | null; offset: number } => {
  const selection = window.getSelection();

  if (selection === null || selection.rangeCount === 0) {
    return {
      node: null,
      offset: 0,
    };
  }

  const range = selection.getRangeAt(0);

  return {
    node: range.startContainer,
    offset: range.startOffset,
  };
};

/**
 * Puts a collapsed caret at the start of the given node.
 * @param node - node to place the caret in
 */
const seedCaret = (node: Node): void => {
  const selection = requireSelection();
  const range = document.createRange();

  range.setStart(node, 0);
  selection.removeAllRanges();
  selection.addRange(range);
};

describe('caret/focus mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    containerState.element = document.createElement('div');
    document.body.appendChild(containerState.element);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
    containerState.element?.remove();
    containerState.element = null;
  });

  describe('focus', () => {
    it('lands at the start when atStart is omitted', () => {
      const element = makeEditable('Hello');

      focus(element);

      const caret = currentCaret();

      expect(caret.node).toBe(firstText(element));
      expect(caret.offset).toBe(0);
    });

    it('creates an empty text node for an empty element', () => {
      const element = makeEditable();

      focus(element, true);

      expect(element.childNodes.length).toBe(1);
      expect(element.textContent).toBe('');
    });

    it('appends the created text node after existing content when focusing at the end', () => {
      const element = makeEditable();
      const span = document.createElement('span');

      element.appendChild(span);

      focus(element, false);

      expect(element.childNodes.length).toBe(2);
      expect(element.firstChild).toBe(span);
      expect(element.lastChild).toBeInstanceOf(Text);
    });

    it('prepends the created text node before existing content when focusing at the start', () => {
      const element = makeEditable();
      const span = document.createElement('span');

      element.appendChild(span);

      focus(element, true);

      expect(element.childNodes.length).toBe(2);
      expect(element.firstChild).toBeInstanceOf(Text);
      expect(element.lastChild).toBe(span);
    });

    it('drops a caret that lives outside the element before creating a text node', () => {
      const other = makeEditable('outside');
      const element = makeEditable();

      seedCaret(firstText(other));

      focus(element, true);

      expect(currentCaret().node).toBe(element.firstChild);
    });

    it('focuses the element before placing the caret', () => {
      const element = makeEditable('Hello');

      expect(element).not.toHaveFocus();

      focus(element, true);

      expect(element).toHaveFocus();
    });

    it('gives up quietly when the platform reports no selection', () => {
      const element = makeEditable('Hello');

      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      expect(() => {
        focus(element, true);
      }).not.toThrow();
    });

    it('gives up quietly when the selection disappears after the new text node is inserted', () => {
      const realSelection = requireSelection();
      const element = makeEditable();

      // First read happens in focus(), the second inside createAndFocusTextNode.
      vi.spyOn(window, 'getSelection')
        .mockReturnValueOnce(realSelection)
        .mockReturnValue(null);

      expect(() => {
        focus(element, true);
      }).not.toThrow();

      expect(element.childNodes.length).toBe(1);
    });
  });

  describe('setSelectionToElement', () => {
    it('focuses the element before reading a fresh selection', () => {
      const element = makeEditable('Hello');

      expect(element).not.toHaveFocus();

      setSelectionToElement(element, requireSelection(), true);

      expect(element).toHaveFocus();
    });

    it('lands in the first deepest node when atFirstLine is true', () => {
      const element = makeEditable();

      element.innerHTML = '<span>AAA</span><span>BBB</span>';

      setSelectionToElement(element, requireSelection(), true);

      const caret = currentCaret();

      expect(caret.node?.textContent).toBe('AAA');
      expect(caret.offset).toBe(0);
    });

    it('lands at the end of the last deepest node when atFirstLine is false', () => {
      const element = makeEditable();

      element.innerHTML = '<span>AAA</span><span>BBB</span>';

      setSelectionToElement(element, requireSelection(), false);

      const caret = currentCaret();

      expect(caret.node?.textContent).toBe('BBB');
      expect(caret.offset).toBe(3);
    });

    it('replaces a caret that lives outside the element', () => {
      const other = makeEditable('outside');
      const element = makeEditable('Hello');

      seedCaret(firstText(other));

      setSelectionToElement(element, requireSelection(), true);

      expect(currentCaret().node).toBe(firstText(element));
    });

    it('leaves the caret alone when the fresh selection is unavailable', () => {
      const realSelection = requireSelection();
      const element = makeEditable('Hello');

      // Only the read inside setSelectionToElement is starved; the fallback
      // path would find a working selection again.
      vi.spyOn(window, 'getSelection')
        .mockReturnValueOnce(null)
        .mockReturnValue(realSelection);

      setSelectionToElement(element, realSelection, true);

      // jsdom parks the caret on the host element itself when a contenteditable
      // element is focused; reaching the text node would mean the guard let the
      // selection code run.
      expect(realSelection.anchorNode).toBe(element);
      expect(realSelection.anchorOffset).toBe(0);
    });

    it('leaves the caret alone when no deepest node is found', () => {
      const element = makeEditable('Hello');

      vi.spyOn(Dom, 'getDeepestNode').mockReturnValue(null);

      setSelectionToElement(element, requireSelection(), true);

      expect(currentCaret().node).toBe(element);
      expect(currentCaret().offset).toBe(0);
    });

    it('falls back to focus() when the offset is out of range for the target node', () => {
      const element = makeEditable();
      const input = document.createElement('input');

      // getDeepestNode does not skip native inputs, so the offset becomes the
      // input value length while the input itself has no child nodes.
      input.value = 'abc';
      element.appendChild(input);

      setSelectionToElement(element, requireSelection(), false);

      expect(element.lastChild).toBeInstanceOf(Text);
      expect(currentCaret().node).toBe(element.lastChild);
    });
  });
});
