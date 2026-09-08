import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getCaretOffsetWithin,
  setCaretToBlockContent,
  setCaretToBlockContentOffset,
} from '../../../../src/tools/list/caret-manager';
import type { API, BlockAPI, Caret } from '../../../../types';

/**
 * Every assertion here reads the COMPLETE caret state — anchor node identity AND
 * anchor offset — because several mutants restore the same visible position from
 * a different node (e.g. `<=` -> `<` moves a boundary caret from the end of one
 * text node to the start of the next).
 *
 * jsdom detail these tests lean on: `HTMLElement.focus()` on a contenteditable
 * element sets the document selection to `(element, 0)`. Both functions focus
 * BEFORE they build their range, so `(contentEl, 0)` is the "nothing happened"
 * state and can never be used on its own to prove a range was applied.
 */

/**
 * Creates a mock Caret API.
 */
const createMockCaret = (): Caret => ({
  setToFirstBlock: vi.fn(),
  setToLastBlock: vi.fn(),
  setToPreviousBlock: vi.fn(),
  setToNextBlock: vi.fn(),
  setToBlock: vi.fn(),
  focus: vi.fn(),
  updateLastCaretAfterPosition: vi.fn(),
});

/**
 * Creates a mock API exposing only the caret surface these helpers touch.
 */
const createMockAPI = (): API => ({
  blocks: {} as API['blocks'],
  caret: createMockCaret(),
  tools: {} as API['tools'],
  handlers: {} as API['handlers'],
  uploader: {} as API['uploader'],
  events: {} as API['events'],
  history: {} as API['history'],
  listeners: {} as API['listeners'],
  notifier: {} as API['notifier'],
  sanitizer: {} as API['sanitizer'],
  saver: {} as API['saver'],
  selection: {} as API['selection'],
  marks: {} as API['marks'],
  styles: {} as API['styles'],
  toolbar: {} as API['toolbar'],
  inlineToolbar: {} as API['inlineToolbar'],
  tooltip: {} as API['tooltip'],
  i18n: {} as API['i18n'],
  readOnly: {} as API['readOnly'],
  ui: {} as API['ui'],
  theme: {} as API['theme'],
  rectangleSelection: {} as API['rectangleSelection'],
  config: {},
});

/**
 * Creates a fully compliant BlockAPI around a holder element.
 */
const createMockBlock = (holder: HTMLElement): BlockAPI => ({
  id: 'test-block-id',
  name: 'list',
  config: {},
  holder,
  isEmpty: false,
  selected: false,
  focusable: true,
  stretched: false,
  parentId: null,
  preservedData: {},
  preservedTunes: {},
  call: vi.fn(),
  save: vi.fn().mockResolvedValue({}),
  validate: vi.fn().mockResolvedValue(true),
  dispatchChange: vi.fn(),
  getActiveToolboxEntry: vi.fn().mockResolvedValue(undefined),
  contentIds: [],
  getChildren: vi.fn().mockReturnValue([]),
  setParent: vi.fn(),
  insertChild: vi.fn().mockReturnValue(null),
  moveChild: vi.fn(),
});

/**
 * The defensive null/undefined-holder shape the implementation guards against
 * even though BlockAPI does not allow it.
 */
type PartialBlockWithHolder = Pick<BlockAPI, 'id' | 'name' | 'config'> & {
  holder: HTMLElement | null;
};

/**
 * Creates a block whose holder is null, for the defensive-guard tests.
 */
const createHolderlessBlock = (): BlockAPI => {
  const partial: PartialBlockWithHolder = {
    id: 'holderless-block',
    name: 'list',
    config: {},
    holder: null,
  };

  return partial as unknown as BlockAPI;
};

/**
 * Mounts a holder containing one contenteditable content element carrying
 * `children`, and returns the block wrapping it.
 */
const mountBlock = (children: Node[]): {
  block: BlockAPI;
  contentEl: HTMLElement;
} => {
  const holder = document.createElement('div');
  const contentEl = document.createElement('div');

  contentEl.setAttribute('contenteditable', 'true');
  contentEl.append(...children);
  holder.appendChild(contentEl);
  document.body.appendChild(holder);

  return { block: createMockBlock(holder), contentEl };
};

/**
 * Mounts a holder with NO contenteditable descendant, forcing the deferred
 * (requestAnimationFrame) fallback path.
 */
const mountBlockWithoutContent = (): BlockAPI => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);

  return createMockBlock(holder);
};

/**
 * Reads the live selection, failing the test rather than returning null so the
 * caller can assert on concrete values.
 */
const liveSelection = (): Selection => {
  const selection = window.getSelection();

  expect(selection).not.toBeNull();

  return selection as Selection;
};

describe('caret-manager mutants', () => {
  let mockAPI: API;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockAPI = createMockAPI();
    // Emptying body leaves a collapsed range anchored at <body>, so tests that
    // need "no selection" or a known one must clear it explicitly.
    window.getSelection()?.removeAllRanges();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    window.getSelection()?.removeAllRanges();
  });

  describe('setCaretToBlockContent', () => {
    it('anchors an end caret after the last child of the content element', () => {
      const { block, contentEl } = mountBlock([document.createTextNode('Test content')]);

      expect(contentEl.childNodes).toHaveLength(1);

      setCaretToBlockContent(mockAPI, block, 'end');

      const selection = liveSelection();

      // (contentEl, 1) is selectNodeContents + collapse-to-end. Collapsing to the
      // START, taking the 'start' branch, or dropping removeAllRanges (which makes
      // addRange a no-op over the range focus() left behind) all read (contentEl, 0).
      expect(selection.anchorNode).toBe(contentEl);
      expect(selection.anchorOffset).toBe(1);
      expect(selection.isCollapsed).toBe(true);
      expect(selection.rangeCount).toBe(1);
      expect(mockAPI.caret.updateLastCaretAfterPosition).toHaveBeenCalledOnce();
    });

    it('anchors a start caret at offset 0 of the content element', () => {
      const { block, contentEl } = mountBlock([document.createTextNode('Test content')]);

      setCaretToBlockContent(mockAPI, block, 'start');

      const selection = liveSelection();

      // Do not "strengthen" this by dropping the node check: focus() alone also
      // produces (contentEl, 0). It works because every mutant it targets lands
      // somewhere else — (contentEl, 1) for the end branch, or the document node
      // when setStart is skipped and the untouched fresh range is installed.
      expect(selection.anchorNode).toBe(contentEl);
      expect(selection.anchorOffset).toBe(0);
      expect(selection.isCollapsed).toBe(true);
    });

    it('leaves the caret alone and skips the undo snapshot when there is no selection', () => {
      const { block } = mountBlock([document.createTextNode('Test content')]);

      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      expect(() => setCaretToBlockContent(mockAPI, block, 'end')).not.toThrow();
      expect(mockAPI.caret.updateLastCaretAfterPosition).not.toHaveBeenCalled();
    });

    it("defers to setToBlock with the default 'end' position when no content element exists", () => {
      const block = mountBlockWithoutContent();

      setCaretToBlockContent(mockAPI, block);

      expect(mockAPI.caret.setToBlock).not.toHaveBeenCalled();

      vi.runAllTimers();

      expect(mockAPI.caret.setToBlock).toHaveBeenCalledWith(block, 'end');
    });
  });

  describe('getCaretOffsetWithin', () => {
    /**
     * Builds PREFIX / target / SUFFIX siblings so a measurement that forgets to
     * start at the content element picks up the preceding text.
     */
    const mountNeighbours = (): { target: HTMLElement; after: HTMLElement } => {
      const before = document.createElement('div');
      const target = document.createElement('div');
      const after = document.createElement('div');

      before.textContent = 'PREFIX';
      target.textContent = 'Hello world';
      after.textContent = 'XY';
      document.body.append(before, target, after);

      return { target, after };
    };

    /**
     * Collapses the live selection inside the first text node of `host`.
     */
    const collapseInto = (host: HTMLElement, offset: number): void => {
      const textNode = host.firstChild;

      expect(textNode).not.toBeNull();

      const range = document.createRange();

      range.setStart(textNode as Text, offset);
      range.collapse(true);

      const selection = liveSelection();

      selection.removeAllRanges();
      selection.addRange(range);
    };

    it('measures the offset from the start of the content element, not the document', () => {
      const { target } = mountNeighbours();

      collapseInto(target, 3);

      // Without selectNodeContents the pre-range starts at the document and the
      // answer becomes 9 ("PREFIXHel").
      expect(getCaretOffsetWithin(target)).toBe(3);
    });

    it('returns null when the caret sits outside the content element', () => {
      const { target, after } = mountNeighbours();

      collapseInto(after, 2);

      expect(getCaretOffsetWithin(target)).toBeNull();
    });

    it('returns null for a missing content element while a selection is live', () => {
      const { target } = mountNeighbours();

      collapseInto(target, 3);

      let result: number | null | undefined;

      expect(() => {
        result = getCaretOffsetWithin(null);
      }).not.toThrow();

      expect(result).toBeNull();
    });
  });

  describe('setCaretToBlockContentOffset', () => {
    it('focuses the content element and anchors the caret at the requested offset', () => {
      const { block, contentEl } = mountBlock([document.createTextNode('Test content')]);

      setCaretToBlockContentOffset(mockAPI, block, 4);

      const selection = liveSelection();

      expect(contentEl).toHaveFocus();
      expect(selection.anchorNode).toBe(contentEl.firstChild);
      expect(selection.anchorOffset).toBe(4);
      expect(selection.isCollapsed).toBe(true);
      expect(mockAPI.caret.updateLastCaretAfterPosition).toHaveBeenCalledOnce();
    });

    it('leaves the caret alone and skips the undo snapshot when there is no selection', () => {
      const { block } = mountBlock([document.createTextNode('Test content')]);

      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      expect(() => setCaretToBlockContentOffset(mockAPI, block, 4)).not.toThrow();
      expect(mockAPI.caret.updateLastCaretAfterPosition).not.toHaveBeenCalled();
    });

    it('does nothing at all when the block has no holder', () => {
      const block = createHolderlessBlock();

      expect(() => {
        setCaretToBlockContentOffset(mockAPI, block, 2);
        vi.runAllTimers();
      }).not.toThrow();

      expect(mockAPI.caret.setToBlock).not.toHaveBeenCalled();
      expect(mockAPI.caret.updateLastCaretAfterPosition).not.toHaveBeenCalled();
    });

    it('does not position synchronously when the holder has no content element', () => {
      const block = mountBlockWithoutContent();

      setCaretToBlockContentOffset(mockAPI, block, 2);

      expect(mockAPI.caret.setToBlock).not.toHaveBeenCalled();
      expect(mockAPI.caret.updateLastCaretAfterPosition).not.toHaveBeenCalled();
    });

    it("falls back to setToBlock at the end on the next frame when the holder has no content element", () => {
      const block = mountBlockWithoutContent();

      setCaretToBlockContentOffset(mockAPI, block, 2);

      expect(() => vi.runAllTimers()).not.toThrow();

      expect(mockAPI.caret.setToBlock).toHaveBeenCalledWith(block, 'end');
      expect(mockAPI.caret.updateLastCaretAfterPosition).toHaveBeenCalledOnce();
    });

    describe('offset resolution across several text nodes', () => {
      /**
       * Mounts a content element holding TWO sibling text nodes, "abc" + "de".
       * A single text node makes the walk trivially correct, so the multi-node
       * shape is what separates the walker mutants.
       */
      const mountSplitText = (): {
        block: BlockAPI;
        contentEl: HTMLElement;
        first: Text;
        second: Text;
      } => {
        const first = document.createTextNode('abc');
        const second = document.createTextNode('de');
        const { block, contentEl } = mountBlock([first, second]);

        return { block, contentEl, first, second };
      };

      it('keeps a boundary offset on the text node that ends there', () => {
        const { block, first } = mountSplitText();

        setCaretToBlockContentOffset(mockAPI, block, 3);

        const selection = liveSelection();

        // `remaining <= length` -> `remaining < length` restores the same visible
        // position from the NEXT node, at (second, 0). Only the node identity
        // separates the two.
        expect(selection.anchorNode).toBe(first);
        expect(selection.anchorOffset).toBe(3);
      });

      it('walks into the second text node for an offset past the first', () => {
        const { block, second } = mountSplitText();

        expect(() => setCaretToBlockContentOffset(mockAPI, block, 4)).not.toThrow();

        const selection = liveSelection();

        expect(selection.anchorNode).toBe(second);
        expect(selection.anchorOffset).toBe(1);
      });

      it('clamps an over-long offset to the end of the last text node', () => {
        const { block, second } = mountSplitText();

        expect(() => setCaretToBlockContentOffset(mockAPI, block, 99)).not.toThrow();

        const selection = liveSelection();

        expect(selection.anchorNode).toBe(second);
        expect(selection.anchorOffset).toBe(2);
      });

      it('anchors on the content element itself when it holds no text nodes', () => {
        const { block, contentEl } = mountBlock([document.createElement('br')]);

        expect(() => setCaretToBlockContentOffset(mockAPI, block, 0)).not.toThrow();

        const selection = liveSelection();

        // The mutants this targets all throw (setStart with an undefined node),
        // so the not.toThrow above carries the kill: (contentEl, 0) is also what
        // focus() leaves behind and cannot prove anything on its own.
        expect(selection.anchorNode).toBe(contentEl);
        expect(selection.anchorOffset).toBe(0);
      });
    });
  });
});

/*
 * Proven-equivalent mutants — no test can observe them:
 *
 * 1. `range.collapse(true)` -> `collapse(false)` on line 50 and line 182.
 *    Both sit directly after `range.setStart(...)` on a range from
 *    `document.createRange()`, whose start and end are (document, 0). The DOM
 *    "set the start of a range" steps set the END to the new boundary point
 *    whenever that point is after the current end OR in a different root — and
 *    both hold for every node reachable here (an attached element, an attached
 *    text node, and a detached one were each measured in jsdom). The range is
 *    therefore already collapsed, so collapse(true) and collapse(false) pick the
 *    same boundary point. The calls are redundant in real browsers too.
 *
 * 2. `lastText.textContent?.length` -> `lastText.textContent.length` (line 130)
 *    and `current.textContent?.length` -> `current.textContent.length` (line 135).
 *    Both operands come from `collectTextNodes`, which only returns nodes whose
 *    `nodeType === Node.TEXT_NODE`, and `Text.textContent` is defined as the
 *    node's data — a string, never null. The `?.` can never short-circuit, and
 *    the `?? 0` fallback the mutation leaves in place is unreachable either way.
 *    The one path where the operand could be undefined (an empty text-node list)
 *    is already fenced off by `lastText !== undefined`.
 */
