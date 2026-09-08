import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { API } from '../../../../types';
import type { HeaderToggleKeyboardContext } from '../../../../src/tools/header/header-toggle-keyboard';

import {
  handleHeaderToggleBackspace,
  handleHeaderToggleEnter,
} from '../../../../src/tools/header/header-toggle-keyboard';

interface BlockRef {
  id: string;
}

interface ApiMocks {
  api: API;
  splitBlock: Mock<(...args: unknown[]) => void>;
  insert: Mock<(...args: unknown[]) => BlockRef>;
  insertInsideParent: Mock<(...args: unknown[]) => BlockRef>;
  setToBlock: Mock<(...args: unknown[]) => void>;
  convert: Mock<(...args: unknown[]) => Promise<BlockRef>>;
  getBlockIndex: Mock<(blockId: string) => number>;
  getCurrentBlockIndex: Mock<() => number>;
  getChildren: Mock<(parentId: string) => BlockRef[]>;
}

/**
 * `getBlockIndex` and `getCurrentBlockIndex` MUST return different numbers:
 * the `??` between them collapses to the same value otherwise, and the
 * `?? -> &&` mutant on that line becomes unobservable.
 */
const createApiMocks = (blockIndex = 3, currentIndex = 9): ApiMocks => {
  const splitBlock: Mock<(...args: unknown[]) => void> = vi.fn();
  const insert: Mock<(...args: unknown[]) => BlockRef> = vi.fn(() => ({ id: 'inserted-paragraph' }));
  const insertInsideParent: Mock<(...args: unknown[]) => BlockRef> = vi.fn(() => ({ id: 'inserted-child' }));
  const setToBlock: Mock<(...args: unknown[]) => void> = vi.fn();
  const convert: Mock<(...args: unknown[]) => Promise<BlockRef>> = vi.fn(() => Promise.resolve({ id: 'converted' }));
  const getBlockIndex: Mock<(blockId: string) => number> = vi.fn(() => blockIndex);
  const getCurrentBlockIndex: Mock<() => number> = vi.fn(() => currentIndex);
  const getChildren: Mock<(parentId: string) => BlockRef[]> = vi.fn(() => []);

  const api = {
    blocks: {
      splitBlock,
      insert,
      insertInsideParent,
      convert,
      getBlockIndex,
      getCurrentBlockIndex,
      getChildren,
    },
    caret: { setToBlock },
  } as unknown as API;

  return {
    api,
    splitBlock,
    insert,
    insertInsideParent,
    setToBlock,
    convert,
    getBlockIndex,
    getCurrentBlockIndex,
    getChildren,
  };
};

interface ContextParts {
  context: HeaderToggleKeyboardContext;
  syncContentFromDOM: Mock<() => void>;
  getContentElement: Mock<() => HTMLElement | null>;
  getText: Mock<() => string>;
}

interface ContextOptions {
  api: API;
  blockId: string | undefined;
  contentEl: HTMLElement | null;
  text: string;
  isOpen: boolean;
  currentLevel: number;
}

const createContext = (options: ContextOptions): ContextParts => {
  const syncContentFromDOM: Mock<() => void> = vi.fn();
  const getContentElement: Mock<() => HTMLElement | null> = vi.fn(() => options.contentEl);
  const getText: Mock<() => string> = vi.fn(() => options.text);

  return {
    syncContentFromDOM,
    getContentElement,
    getText,
    context: {
      api: options.api,
      blockId: options.blockId,
      getText,
      getContentElement,
      syncContentFromDOM,
      isOpen: options.isOpen,
      currentLevel: options.currentLevel,
    },
  };
};

const mounted: HTMLElement[] = [];

const mountEditable = (text: string): HTMLElement => {
  const element: HTMLElement = document.createElement('div');

  element.setAttribute('contenteditable', 'true');

  if (text !== '') {
    element.textContent = text;
  }

  document.body.appendChild(element);
  mounted.push(element);

  return element;
};

const firstTextNode = (element: HTMLElement): ChildNode => {
  const node = element.firstChild;

  if (node === null) {
    throw new Error('expected the mounted element to carry a text node');
  }

  return node;
};

/** Selection is document-global, so every test re-seeds it from scratch. */
const collapseSelectionAt = (node: Node, offset: number): void => {
  const range = document.createRange();

  range.setStart(node, offset);
  range.collapse(true);

  const selection = window.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(range);
};

/**
 * Runs a handler and returns whatever it threw.
 *
 * Several guards can only be probed with an argument the unguarded code cannot
 * survive (a null content element). Capturing the rejection turns that into a
 * named assertion failure instead of a bare crash the sweep cannot attribute.
 */
const capture = async (run: Promise<void>): Promise<unknown[]> => {
  const errors: unknown[] = [];

  await run.catch((error: unknown) => {
    errors.push(error);
  });

  return errors;
};

describe('Header toggle keyboard — mutant coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.getSelection()?.removeAllRanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();

    while (mounted.length > 0) {
      mounted.pop()?.remove();
    }

    window.getSelection()?.removeAllRanges();
  });

  describe('handleHeaderToggleEnter', () => {
    it('splits a heading mid-caret into two toggle headings at the same level', async () => {
      const mocks = createApiMocks(3, 9);
      const contentEl = mountEditable('Heading text');
      const parts = createContext({
        api: mocks.api,
        blockId: 'block-1',
        contentEl,
        text: 'Heading text',
        isOpen: false,
        currentLevel: 2,
      });

      collapseSelectionAt(firstTextNode(contentEl), 4);

      const errors = await capture(handleHeaderToggleEnter(parts.context));

      expect(mocks.splitBlock.mock.calls).toStrictEqual([[
        'block-1',
        { text: 'Head',
          level: 2,
          isToggleable: true },
        'header',
        { text: 'ing text',
          level: 2,
          isToggleable: true },
        4,
      ]]);
      expect(errors).toStrictEqual([]);
      expect(parts.syncContentFromDOM.mock.calls).toStrictEqual([[]]);
      expect(mocks.insert.mock.calls).toStrictEqual([]);
      expect(mocks.insertInsideParent.mock.calls).toStrictEqual([]);
      expect(mocks.setToBlock.mock.calls).toStrictEqual([]);
    });

    it('splits instead of adding a child when an open heading has text after the caret', async () => {
      const mocks = createApiMocks(3, 9);
      const contentEl = mountEditable('Heading text');
      const parts = createContext({
        api: mocks.api,
        blockId: 'block-1',
        contentEl,
        text: 'Heading text',
        isOpen: true,
        currentLevel: 2,
      });

      collapseSelectionAt(firstTextNode(contentEl), 4);

      const errors = await capture(handleHeaderToggleEnter(parts.context));

      expect(mocks.insertInsideParent.mock.calls).toStrictEqual([]);
      expect(mocks.splitBlock.mock.calls).toStrictEqual([[
        'block-1',
        { text: 'Head',
          level: 2,
          isToggleable: true },
        'header',
        { text: 'ing text',
          level: 2,
          isToggleable: true },
        4,
      ]]);
      expect(errors).toStrictEqual([]);
      expect(mocks.setToBlock.mock.calls).toStrictEqual([]);
    });

    it('stops before reading the DOM when the block id is undefined', async () => {
      const mocks = createApiMocks(3, 9);
      const contentEl = mountEditable('Heading text');
      const parts = createContext({
        api: mocks.api,
        blockId: undefined,
        contentEl,
        text: 'Heading text',
        isOpen: false,
        currentLevel: 2,
      });

      collapseSelectionAt(firstTextNode(contentEl), 12);

      const errors = await capture(handleHeaderToggleEnter(parts.context));

      expect(parts.getContentElement.mock.calls).toStrictEqual([]);
      expect(mocks.getBlockIndex.mock.calls).toStrictEqual([]);
      expect(mocks.insert.mock.calls).toStrictEqual([]);
      expect(mocks.insertInsideParent.mock.calls).toStrictEqual([]);
      expect(mocks.splitBlock.mock.calls).toStrictEqual([]);
      expect(mocks.setToBlock.mock.calls).toStrictEqual([]);
      expect(errors).toStrictEqual([]);
      expect(parts.syncContentFromDOM.mock.calls).toStrictEqual([[]]);
    });

    it('stops when there is no content element even though the selection has a range', async () => {
      const mocks = createApiMocks(3, 9);
      const elsewhere = mountEditable('Heading text');
      const parts = createContext({
        api: mocks.api,
        blockId: 'block-1',
        contentEl: null,
        text: 'Heading text',
        isOpen: false,
        currentLevel: 2,
      });

      collapseSelectionAt(firstTextNode(elsewhere), 4);
      expect(window.getSelection()?.rangeCount).toBe(1);

      const errors = await capture(handleHeaderToggleEnter(parts.context));

      expect(errors).toStrictEqual([]);
      expect(mocks.getBlockIndex.mock.calls).toStrictEqual([]);
      expect(mocks.insert.mock.calls).toStrictEqual([]);
      expect(mocks.insertInsideParent.mock.calls).toStrictEqual([]);
      expect(mocks.splitBlock.mock.calls).toStrictEqual([]);
      expect(mocks.setToBlock.mock.calls).toStrictEqual([]);
    });

    it('stops when the selection holds no range even though the content element exists', async () => {
      const mocks = createApiMocks(3, 9);
      const contentEl = mountEditable('Heading text');
      const parts = createContext({
        api: mocks.api,
        blockId: 'block-1',
        contentEl,
        text: 'Heading text',
        isOpen: false,
        currentLevel: 2,
      });

      window.getSelection()?.removeAllRanges();
      expect(window.getSelection()?.rangeCount).toBe(0);

      const errors = await capture(handleHeaderToggleEnter(parts.context));

      expect(errors).toStrictEqual([]);
      expect(mocks.getBlockIndex.mock.calls).toStrictEqual([]);
      expect(mocks.insert.mock.calls).toStrictEqual([]);
      expect(mocks.insertInsideParent.mock.calls).toStrictEqual([]);
      expect(mocks.splitBlock.mock.calls).toStrictEqual([]);
      expect(mocks.setToBlock.mock.calls).toStrictEqual([]);
    });
  });

  describe('handleHeaderToggleBackspace', () => {
    it('converts an empty toggle heading back to a plain heading at the same level', async () => {
      const mocks = createApiMocks(3, 9);
      const contentEl = mountEditable('');
      const parts = createContext({
        api: mocks.api,
        blockId: 'block-1',
        contentEl,
        text: '',
        isOpen: true,
        currentLevel: 3,
      });
      const event = new KeyboardEvent('keydown', {
        key: 'Backspace',
        cancelable: true,
      });

      collapseSelectionAt(contentEl, 0);

      const errors = await capture(handleHeaderToggleBackspace(parts.context, event));

      expect(mocks.convert.mock.calls).toStrictEqual([[
        'block-1',
        'header',
        { text: '',
          level: 3 },
      ]]);
      expect(event.defaultPrevented).toBe(true);
      expect(errors).toStrictEqual([]);
      expect(parts.syncContentFromDOM.mock.calls).toStrictEqual([[]]);
    });

    it('stops before reading the DOM when the block id is undefined', async () => {
      const mocks = createApiMocks(3, 9);
      const contentEl = mountEditable('');
      const parts = createContext({
        api: mocks.api,
        blockId: undefined,
        contentEl,
        text: '',
        isOpen: true,
        currentLevel: 3,
      });
      const event = new KeyboardEvent('keydown', {
        key: 'Backspace',
        cancelable: true,
      });

      collapseSelectionAt(contentEl, 0);

      const errors = await capture(handleHeaderToggleBackspace(parts.context, event));

      expect(parts.getContentElement.mock.calls).toStrictEqual([]);
      expect(mocks.convert.mock.calls).toStrictEqual([]);
      expect(event.defaultPrevented).toBe(false);
      expect(errors).toStrictEqual([]);
      expect(parts.syncContentFromDOM.mock.calls).toStrictEqual([[]]);
    });

    it('stops when there is no content element', async () => {
      const mocks = createApiMocks(3, 9);
      const parts = createContext({
        api: mocks.api,
        blockId: 'block-1',
        contentEl: null,
        text: '',
        isOpen: true,
        currentLevel: 3,
      });
      const event = new KeyboardEvent('keydown', {
        key: 'Backspace',
        cancelable: true,
      });

      const errors = await capture(handleHeaderToggleBackspace(parts.context, event));

      expect(mocks.convert.mock.calls).toStrictEqual([]);
      expect(event.defaultPrevented).toBe(false);
      expect(parts.getText.mock.calls).toStrictEqual([]);
      expect(errors).toStrictEqual([]);
    });

    it('leaves Backspace alone when the caret is not at the start of the heading', async () => {
      const mocks = createApiMocks(3, 9);
      const contentEl = mountEditable('Heading');
      // `getText` is deliberately decoupled from the element's own text: an empty
      // getText is the only way to reach the caret guard without the later
      // non-empty-text guard also stopping the handler.
      const parts = createContext({
        api: mocks.api,
        blockId: 'block-1',
        contentEl,
        text: '',
        isOpen: true,
        currentLevel: 3,
      });
      const event = new KeyboardEvent('keydown', {
        key: 'Backspace',
        cancelable: true,
      });

      collapseSelectionAt(firstTextNode(contentEl), 7);

      const errors = await capture(handleHeaderToggleBackspace(parts.context, event));

      expect(mocks.convert.mock.calls).toStrictEqual([]);
      expect(event.defaultPrevented).toBe(false);
      expect(errors).toStrictEqual([]);
    });

    it('leaves Backspace alone when the heading still has text', async () => {
      const mocks = createApiMocks(3, 9);
      const contentEl = mountEditable('Heading');
      const parts = createContext({
        api: mocks.api,
        blockId: 'block-1',
        contentEl,
        text: 'Heading',
        isOpen: true,
        currentLevel: 3,
      });
      const event = new KeyboardEvent('keydown', {
        key: 'Backspace',
        cancelable: true,
      });

      collapseSelectionAt(firstTextNode(contentEl), 0);

      const errors = await capture(handleHeaderToggleBackspace(parts.context, event));

      expect(mocks.convert.mock.calls).toStrictEqual([]);
      expect(event.defaultPrevented).toBe(false);
      expect(parts.getText.mock.calls).toStrictEqual([[]]);
      expect(errors).toStrictEqual([]);
    });
  });
});
