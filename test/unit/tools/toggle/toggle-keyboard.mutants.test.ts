import type { Mock } from 'vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { API } from '../../../../types';
import type { ToggleKeyboardContext } from '../../../../src/tools/toggle/toggle-keyboard';
import {
  handleToggleBackspace,
  handleToggleEnter,
  splitContentAtRange,
} from '../../../../src/tools/toggle/toggle-keyboard';

/**
 * Mutation coverage for src/tools/toggle/toggle-keyboard.ts.
 *
 * Every mutant recorded live on this file is killed here; no equivalent
 * mutants remain, so there are no equivalence proofs to record.
 *
 * Two constraints shape the tests:
 * - jsdom drops a Range whose root is not the document, so every case that
 *   needs `selection.rangeCount > 0` builds its range inside a body-attached
 *   element. The direct `splitContentAtRange` cases hand the Range over
 *   themselves and therefore may use detached nodes.
 * - Each guard in `handleToggleBackspace` is only observable when the guards
 *   after it would NOT also return, so every backspace case pins caret state,
 *   content element and `data.text` explicitly instead of leaning on defaults.
 */
const mocks = vi.hoisted(() => ({
  isCaretAtStartOfInput: vi.fn<(input: HTMLElement) => boolean>(),
}));

vi.mock('../../../../src/components/utils/caret', () => ({
  isCaretAtStartOfInput: mocks.isCaretAtStartOfInput,
}));

interface BlockRef {
  id: string;
}

interface ApiHarness {
  api: API;
  splitBlock: Mock<(id: string, before: { text: string }, tool: string, after: { text: string }, index: number) => void>;
  convert: Mock<(id: string, tool: string, data: { text: string }) => Promise<void>>;
  insertInsideParent: Mock<(parentId: string, index: number) => BlockRef>;
  setToBlock: Mock<(id: string, position: string) => void>;
}

const createApi = (options: { blockIndex?: number; currentBlockIndex?: number } = {}): ApiHarness => {
  const splitBlock = vi.fn<(id: string, before: { text: string }, tool: string, after: { text: string }, index: number) => void>();
  const convert = vi.fn<(id: string, tool: string, data: { text: string }) => Promise<void>>(async () => undefined);
  const insertInsideParent = vi.fn<(parentId: string, index: number) => BlockRef>(() => ({ id: 'new-block' }));
  const setToBlock = vi.fn<(id: string, position: string) => void>();
  const getBlockIndex = vi.fn<(id: string) => number | undefined>(() => options.blockIndex ?? 0);
  const getCurrentBlockIndex = vi.fn<() => number>(() => options.currentBlockIndex ?? 0);
  const getChildren = vi.fn<(parentId: string) => BlockRef[]>(() => []);

  const api = {
    blocks: {
      splitBlock,
      convert,
      getBlockIndex,
      getCurrentBlockIndex,
      insertInsideParent,
      getChildren,
    },
    caret: { setToBlock },
  } as unknown as API;

  return { api, splitBlock, convert, insertInsideParent, setToBlock };
};

const createContext = (
  harness: ApiHarness,
  overrides: Partial<ToggleKeyboardContext> = {}
): ToggleKeyboardContext => ({
  api: harness.api,
  blockId: 'block-1',
  data: { text: '' },
  element: document.createElement('div'),
  getContentElement: () => null,
  syncContentFromDOM: vi.fn(),
  isOpen: false,
  setOpen: vi.fn(),
  ...overrides,
});

const attached: HTMLElement[] = [];

const attach = (text: string): HTMLElement => {
  const element = document.createElement('div');

  element.setAttribute('contenteditable', 'true');
  element.textContent = text;
  document.body.appendChild(element);
  attached.push(element);

  return element;
};

const firstChildOf = (element: HTMLElement): Node => {
  const node = element.firstChild;

  if (node === null) {
    throw new Error('expected a child node');
  }

  return node;
};

const collapseCaretAt = (node: Node, offset: number): void => {
  const range = document.createRange();

  range.setStart(node, offset);
  range.collapse(true);

  const selection = window.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(range);
};

describe('toggle-keyboard mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.getSelection()?.removeAllRanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();

    while (attached.length > 0) {
      attached.pop()?.remove();
    }
  });

  describe('handleToggleEnter guards', () => {
    it('does nothing when blockId is undefined even with a live caret', async () => {
      const harness = createApi();
      const element = attach('hello');

      collapseCaretAt(firstChildOf(element), 2);

      const context = createContext(harness, {
        blockId: undefined,
        getContentElement: () => element,
      });

      await handleToggleEnter(context);

      expect(context.syncContentFromDOM).toHaveBeenCalledOnce();
      expect(harness.splitBlock).not.toHaveBeenCalled();
      expect(harness.insertInsideParent).not.toHaveBeenCalled();
      expect(harness.setToBlock).not.toHaveBeenCalled();
    });

    it('does nothing when the content element is missing but a range exists', async () => {
      const harness = createApi();
      const element = attach('hello');

      collapseCaretAt(firstChildOf(element), 2);

      const context = createContext(harness, { getContentElement: () => null });

      await expect(handleToggleEnter(context)).resolves.toBeUndefined();

      expect(harness.splitBlock).not.toHaveBeenCalled();
      expect(harness.insertInsideParent).not.toHaveBeenCalled();
    });

    it('does nothing when the selection holds no range', async () => {
      const harness = createApi();
      const element = attach('hello');

      window.getSelection()?.removeAllRanges();

      const context = createContext(harness, { getContentElement: () => element });

      await expect(handleToggleEnter(context)).resolves.toBeUndefined();

      expect(harness.splitBlock).not.toHaveBeenCalled();
      expect(harness.insertInsideParent).not.toHaveBeenCalled();
    });
  });

  describe('handleToggleEnter split index', () => {
    it('splits after the block own index, not after the current block index', async () => {
      const harness = createApi({ blockIndex: 3, currentBlockIndex: 40 });
      const element = attach('hello');

      collapseCaretAt(firstChildOf(element), 2);

      const context = createContext(harness, { getContentElement: () => element });

      await handleToggleEnter(context);

      expect(harness.splitBlock).toHaveBeenCalledWith(
        'block-1',
        { text: 'he' },
        'toggle',
        { text: 'llo' },
        4
      );
      expect(context.data.text).toBe('he');
    });
  });

  describe('handleToggleEnter child-vs-split branch', () => {
    it('splits when the toggle is closed and the caret is at the end', async () => {
      const harness = createApi();
      const element = attach('');

      collapseCaretAt(element, 0);

      const context = createContext(harness, {
        getContentElement: () => element,
        isOpen: false,
      });

      await handleToggleEnter(context);

      expect(harness.splitBlock).toHaveBeenCalledOnce();
      expect(harness.insertInsideParent).not.toHaveBeenCalled();
    });

    it('splits when the toggle is open but content follows the caret', async () => {
      const harness = createApi();
      const element = attach('hello');

      collapseCaretAt(firstChildOf(element), 2);

      const context = createContext(harness, {
        getContentElement: () => element,
        isOpen: true,
      });

      await handleToggleEnter(context);

      expect(harness.splitBlock).toHaveBeenCalledOnce();
      expect(harness.insertInsideParent).not.toHaveBeenCalled();
    });
  });

  describe('handleToggleBackspace guards', () => {
    it('does not convert when the content element is missing and the block is empty', async () => {
      const harness = createApi();

      mocks.isCaretAtStartOfInput.mockReturnValue(true);

      const context = createContext(harness, {
        data: { text: '' },
        getContentElement: () => null,
      });
      const event = new KeyboardEvent('keydown', { key: 'Backspace' });
      const preventDefault = vi.spyOn(event, 'preventDefault');

      await handleToggleBackspace(context, event);

      expect(harness.convert).not.toHaveBeenCalled();
      expect(preventDefault).not.toHaveBeenCalled();
    });

    it('does not convert an empty block when the caret is away from the start', async () => {
      const harness = createApi();
      const element = attach('');

      mocks.isCaretAtStartOfInput.mockReturnValue(false);

      const context = createContext(harness, {
        data: { text: '' },
        getContentElement: () => element,
      });
      const event = new KeyboardEvent('keydown', { key: 'Backspace' });
      const preventDefault = vi.spyOn(event, 'preventDefault');

      await handleToggleBackspace(context, event);

      expect(harness.convert).not.toHaveBeenCalled();
      expect(preventDefault).not.toHaveBeenCalled();
    });

    it('does not convert when the caret is at the start but the block has text', async () => {
      const harness = createApi();
      const element = attach('hello');

      mocks.isCaretAtStartOfInput.mockReturnValue(true);

      const context = createContext(harness, {
        data: { text: 'hello' },
        getContentElement: () => element,
      });
      const event = new KeyboardEvent('keydown', { key: 'Backspace' });
      const preventDefault = vi.spyOn(event, 'preventDefault');

      await handleToggleBackspace(context, event);

      expect(harness.convert).not.toHaveBeenCalled();
      expect(preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('splitContentAtRange', () => {
    it('returns two empty halves for an element with no children', () => {
      const element = document.createElement('div');

      const result = splitContentAtRange(element, document.createRange());

      expect(result.beforeContent).toBe('');
      expect(result.afterContent).toBe('');
    });

    it('keeps the text before the caret in beforeContent', () => {
      const element = document.createElement('div');

      element.textContent = 'hello';

      const range = document.createRange();

      range.setStart(firstChildOf(element), 2);
      range.collapse(true);

      const result = splitContentAtRange(element, range);

      expect(result.beforeContent).toBe('he');
      expect(result.afterContent).toBe('llo');
    });
  });
});
