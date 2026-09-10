import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  handleEnter,
  handleBackspace,
  handleOutdent,
  handleIndent,
  toggleChecklistChecked,
  type KeyboardContext,
} from '../../../../src/tools/list/list-keyboard';
import type { API } from '../../../../types';
import type { ListItemData } from '../../../../src/tools/list/types';
import type { ListDepthValidator } from '../../../../src/tools/list/depth-validator';

interface ApiFake {
  api: API;
  insert: ReturnType<typeof vi.fn>;
  splitBlock: ReturnType<typeof vi.fn>;
  convert: ReturnType<typeof vi.fn>;
  getBlockIndex: ReturnType<typeof vi.fn>;
  getCurrentBlockIndex: ReturnType<typeof vi.fn>;
  setToBlock: ReturnType<typeof vi.fn>;
}

/** A block whose holder carries a contenteditable, as the caret manager expects. */
const insertedBlock = (): { id: string; name: string; holder: HTMLElement } => {
  const holder = document.createElement('div');
  const content = document.createElement('div');

  content.contentEditable = 'true';
  holder.appendChild(content);
  document.body.appendChild(holder);

  return { id: 'inserted', name: 'list', holder };
};

const makeApi = ({ currentIndex = 3, indexOf = (): number | undefined => undefined } = {}): ApiFake => {
  const inserted = insertedBlock();
  const insert = vi.fn(() => inserted);
  const splitBlock = vi.fn(() => inserted);
  const convert = vi.fn(async () => inserted);
  const getBlockIndex = vi.fn(indexOf);
  const getCurrentBlockIndex = vi.fn(() => currentIndex);
  const setToBlock = vi.fn();

  return {
    api: {
      blocks: {
        insert,
        splitBlock,
        convert,
        getBlockIndex,
        getCurrentBlockIndex,
        getBlockByIndex: vi.fn(),
        getBlocksCount: vi.fn(() => 5),
        getById: vi.fn(() => null),
        setBlockParent: vi.fn(),
        update: vi.fn(async () => inserted),
      },
      caret: { setToBlock, updateLastCaretAfterPosition: vi.fn() },
    } as unknown as API,
    insert,
    splitBlock,
    convert,
    getBlockIndex,
    getCurrentBlockIndex,
    setToBlock,
  };
};

interface ContextFake {
  context: KeyboardContext;
  data: ListItemData;
  content: HTMLElement;
  element: HTMLElement;
  syncContentFromDOM: ReturnType<typeof vi.fn>;
}

interface ContextOptions {
  html?: string;
  blockId?: string;
  style?: ListItemData['style'];
  checked?: boolean;
  depth?: number;
}

const makeContext = (
  api: API,
  { html = 'hello world', blockId, style = 'unordered', checked, depth = 2 }: ContextOptions = {},
): ContextFake => {
  const element = document.createElement('div');
  const content = document.createElement('div');

  content.contentEditable = 'true';
  content.innerHTML = html;
  element.appendChild(content);
  document.body.appendChild(element);

  const data = { text: html, style, depth, ...(checked === undefined ? {} : { checked }) } as ListItemData;
  const syncContentFromDOM = vi.fn(() => {
    data.text = content.innerHTML;
  });

  return {
    context: {
      api,
      blockId,
      data,
      element,
      getContentElement: () => content,
      syncContentFromDOM,
      getDepth: () => depth,
    },
    data,
    content,
    element,
    syncContentFromDOM,
  };
};

const selectWithin = (node: Node, start: number, end: number): void => {
  const range = document.createRange();

  range.setStart(node, start);
  range.setEnd(node, end);

  const selection = window.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(range);
};

const caretIn = (content: HTMLElement, offset: number): void => {
  const text = content.firstChild;

  if (text === null) {
    throw new Error('fixture has no text node');
  }

  selectWithin(text, offset, offset);
};

describe('list-keyboard mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
  });

  describe('Enter on a block with no id', () => {
    it('splits the item in place and inserts the tail as a new list item', async () => {
      const fake = makeApi({ currentIndex: 3 });
      const { context, data, content } = makeContext(fake.api, { html: 'hello world' });

      caretIn(content, 5);
      await handleEnter(context);

      expect(fake.splitBlock).not.toHaveBeenCalled();
      expect(fake.insert).toHaveBeenCalledTimes(1);

      const [tool, payload, tunes, index, needToFocus] = fake.insert.mock.calls[0];

      expect(tool).toBe('list');
      expect(payload).toStrictEqual({ text: ' world', style: 'unordered', depth: 2 });
      expect(tunes).toBeUndefined();
      expect(index).toBe(4);
      expect(needToFocus).toBe(true);
      expect(content.innerHTML).toBe('hello');
      expect(data.text).toBe('hello');
    });

    it('starts a split to-do unchecked, however the original was', async () => {
      const fake = makeApi();
      const { context, content } = makeContext(fake.api, {
        html: 'hello world',
        style: 'checklist',
        checked: true,
      });

      caretIn(content, 5);
      await handleEnter(context);

      expect(fake.insert.mock.calls[0][1]).toStrictEqual({
        text: ' world',
        style: 'checklist',
        checked: false,
        depth: 2,
      });
    });

    it('carries no checked flag for a plain list', async () => {
      const fake = makeApi();
      const { context, content } = makeContext(fake.api, { html: 'hello world', style: 'ordered' });

      caretIn(content, 5);
      await handleEnter(context);

      expect(fake.insert.mock.calls[0][1]).toStrictEqual({ text: ' world', style: 'ordered', depth: 2 });
    });

    it('inserts straight after the current block', async () => {
      const fake = makeApi({ currentIndex: 7 });
      const { context, content } = makeContext(fake.api, { html: 'hello world' });

      caretIn(content, 5);
      await handleEnter(context);

      expect(fake.insert.mock.calls[0][3]).toBe(8);
    });
  });

  describe('Enter on a block with an id', () => {
    it('splits atomically through the blocks api, so undo stays correct', async () => {
      const fake = makeApi({ currentIndex: 1, indexOf: () => 6 });
      const { context, data, content } = makeContext(fake.api, { html: 'hello world', blockId: 'b1' });

      caretIn(content, 5);
      await handleEnter(context);

      expect(fake.insert).not.toHaveBeenCalled();
      expect(fake.splitBlock).toHaveBeenCalledTimes(1);

      const [id, head, tool, tail, index] = fake.splitBlock.mock.calls[0];

      expect(id).toBe('b1');
      expect(head).toStrictEqual({ text: 'hello' });
      expect(tool).toBe('list');
      expect(tail).toStrictEqual({ text: ' world', style: 'unordered', depth: 2 });
      expect(index).toBe(7);
      expect(data.text).toBe('hello');
    });

    it('falls back to the current index when the id is unknown', async () => {
      const fake = makeApi({ currentIndex: 1, indexOf: () => undefined });
      const { context, content } = makeContext(fake.api, { html: 'hello world', blockId: 'ghost' });

      caretIn(content, 5);
      await handleEnter(context);

      expect(fake.splitBlock.mock.calls[0][4]).toBe(2);
    });
  });

  describe('Enter on an empty item at root level', () => {
    it('converts the item to a paragraph', async () => {
      const fake = makeApi();
      const { context } = makeContext(fake.api, { html: '', blockId: 'b1', depth: 0 });
      const content = context.getContentElement();
      const range = document.createRange();

      if (content !== null) {
        range.setStart(content, 0);
        range.collapse(true);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }

      await handleEnter(context);

      expect(fake.convert).toHaveBeenCalledWith('b1', 'paragraph', { text: '' });
      expect(fake.splitBlock).not.toHaveBeenCalled();
    });

    it('treats a lone line break as empty', async () => {
      const fake = makeApi();
      const { context } = makeContext(fake.api, { html: '<br>', blockId: 'b1', depth: 0 });
      const content = context.getContentElement();
      const range = document.createRange();

      if (content !== null) {
        range.setStart(content, 0);
        range.collapse(true);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }

      await handleEnter(context);

      expect(fake.convert).toHaveBeenCalledWith('b1', 'paragraph', { text: '' });
    });

    it('does nothing at root level when there is no block id', async () => {
      const fake = makeApi();
      const { context } = makeContext(fake.api, { html: '', depth: 0 });
      const content = context.getContentElement();
      const range = document.createRange();

      if (content !== null) {
        range.setStart(content, 0);
        range.collapse(true);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }

      await handleEnter(context);

      expect(fake.convert).not.toHaveBeenCalled();
      expect(fake.insert).not.toHaveBeenCalled();
    });
  });

  describe('Backspace over a whole selected item', () => {
    const backspace = (): KeyboardEvent => new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true });

    it('empties the item itself rather than letting the browser merge blocks', async () => {
      const fake = makeApi();
      const { context, data, content } = makeContext(fake.api, { html: 'hello', blockId: 'b1' });
      const text = content.firstChild;

      if (text === null) {
        throw new Error('fixture has no text node');
      }

      selectWithin(text, 0, 5);

      const event = backspace();

      await handleBackspace(context, event);

      expect(content.innerHTML).toBe('');
      expect(data.text).toBe('');
      expect(event.defaultPrevented).toBe(true);
    });

    it('leaves the caret at the start of the emptied item', async () => {
      const fake = makeApi();
      const { context, content } = makeContext(fake.api, { html: 'hello', blockId: 'b1' });
      const text = content.firstChild;

      if (text === null) {
        throw new Error('fixture has no text node');
      }

      selectWithin(text, 0, 5);
      await handleBackspace(context, backspace());

      const selection = window.getSelection();

      expect(selection?.rangeCount).toBe(1);
      expect(selection?.getRangeAt(0).collapsed).toBe(true);
      expect(selection?.getRangeAt(0).startContainer).toBe(content);
      expect(selection?.getRangeAt(0).startOffset).toBe(0);
    });

    it('syncs the item content from the DOM before deleting anything', async () => {
      const fake = makeApi();
      const fixture = makeContext(fake.api, { html: 'hello', blockId: 'b1' });
      const text = fixture.content.firstChild;

      if (text === null) {
        throw new Error('fixture has no text node');
      }

      selectWithin(text, 0, 5);
      await handleBackspace(fixture.context, backspace());

      expect(fixture.syncContentFromDOM).toHaveBeenCalledTimes(1);
    });

    it('leaves a partial selection to the browser', async () => {
      const fake = makeApi();
      const { context, content } = makeContext(fake.api, { html: 'hello world', blockId: 'b1' });
      const text = content.firstChild;

      if (text === null) {
        throw new Error('fixture has no text node');
      }

      selectWithin(text, 0, 5);

      const event = backspace();

      await handleBackspace(context, event);

      expect(content.innerHTML).toBe('hello world');
      expect(event.defaultPrevented).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Structural nesting, flat depth, cascade and checklist toggles
  // -------------------------------------------------------------------------

  interface BlockStub {
    id: string;
    name: string;
    parentId: string | null;
    holder: HTMLElement;
  }

  /**
   * A block record with a real DOM holder. The contenteditable is set as an
   * ATTRIBUTE: jsdom does not reflect the `contentEditable` property, and the
   * caret manager finds the content element by attribute selector.
   */
  const makeBlockStub = (
    id: string,
    options: { name?: string; parentId?: string | null; html?: string } = {},
  ): BlockStub => {
    const holder = document.createElement('div');
    const content = document.createElement('div');

    content.setAttribute('contenteditable', 'true');
    content.innerHTML = options.html ?? 'tail';
    holder.appendChild(content);
    document.body.appendChild(holder);

    return { id, name: options.name ?? 'list', parentId: options.parentId ?? null, holder };
  };

  const contentOf = (block: BlockStub): HTMLElement => {
    const element = block.holder.querySelector('[contenteditable="true"]');

    if (!(element instanceof HTMLElement)) {
      throw new Error('block fixture has no content element');
    }

    return element;
  };

  /** Character offset of the live caret inside the block's content element. */
  const caretOffsetIn = (block: BlockStub): number => {
    const selection = window.getSelection();

    if (selection === null || selection.rangeCount === 0) {
      throw new Error('no caret was set on the block');
    }

    const range = selection.getRangeAt(0);
    const preCaret = document.createRange();

    preCaret.selectNodeContents(contentOf(block));
    preCaret.setEnd(range.startContainer, range.startOffset);

    return preCaret.toString().length;
  };

  const makeDepthValidator = (
    blockDepths: Record<string, number>,
    maxDepths: Record<number, number> = {},
  ): ListDepthValidator => ({
    getBlockDepth: (block: { id?: string } | undefined) => {
      const id = block?.id ?? '';

      return blockDepths[id] ?? 0;
    },
    getMaxAllowedDepth: (index: number) => maxDepths[index] ?? 1,
  } as unknown as ListDepthValidator);

  interface Stage {
    api: API;
    store: Record<string, BlockStub>;
    indexStore: Record<number, BlockStub>;
    updated: Array<[string, unknown]>;
    parents: Array<[string, string | null]>;
    inserted: BlockStub;
    insert: ReturnType<typeof vi.fn>;
    splitBlock: ReturnType<typeof vi.fn>;
    convert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    getById: ReturnType<typeof vi.fn>;
    getBlockByIndex: ReturnType<typeof vi.fn>;
    getBlockIndex: ReturnType<typeof vi.fn>;
    getCurrentBlockIndex: ReturnType<typeof vi.fn>;
  }

  const makeStage = (options: { currentIndex?: number; blocksCount?: number } = {}): Stage => {
    const inserted = makeBlockStub('inserted');
    const store: Record<string, BlockStub> = {};
    const indexStore: Record<number, BlockStub> = {};
    const updated: Array<[string, unknown]> = [];
    const parents: Array<[string, string | null]> = [];

    const insert = vi.fn(() => inserted);
    const splitBlock = vi.fn(() => inserted);
    const convert = vi.fn(async () => inserted);
    const update = vi.fn(async (id: string, payload: unknown) => {
      updated.push([id, payload]);

      return store[id] ?? inserted;
    });
    const getById = vi.fn((id: string) => store[id] ?? null);
    const getBlockByIndex = vi.fn((position: number) => indexStore[position]);
    const getBlockIndex = vi.fn((_id: string): number | undefined => undefined);
    const getCurrentBlockIndex = vi.fn(() => options.currentIndex ?? 3);

    const api = {
      blocks: {
        insert,
        splitBlock,
        convert,
        update,
        getById,
        getBlockByIndex,
        getBlockIndex,
        getCurrentBlockIndex,
        getBlocksCount: vi.fn(() => options.blocksCount ?? 5),
        setBlockParent: vi.fn((id: string, parentId: string | null) => {
          parents.push([id, parentId]);
        }),
      },
      caret: { setToBlock: vi.fn(), updateLastCaretAfterPosition: vi.fn() },
    } as unknown as API;

    return {
      api,
      store,
      indexStore,
      updated,
      parents,
      inserted,
      insert,
      splitBlock,
      convert,
      update,
      getById,
      getBlockByIndex,
      getBlockIndex,
      getCurrentBlockIndex,
    };
  };

  interface DeepContext {
    context: KeyboardContext;
    data: ListItemData;
    content: HTMLElement;
    element: HTMLElement;
    syncContentFromDOM: ReturnType<typeof vi.fn>;
  }

  const makeDeepContext = (
    api: API,
    options: {
      html?: string;
      blockId?: string;
      style?: ListItemData['style'];
      checked?: boolean;
      depth?: number;
      element?: HTMLElement | null;
    } = {},
  ): DeepContext => {
    const html = options.html ?? 'hello world';
    const element = document.createElement('div');
    const content = document.createElement('div');

    content.setAttribute('contenteditable', 'true');
    content.innerHTML = html;
    element.appendChild(content);
    document.body.appendChild(element);

    const depth = options.depth ?? 2;
    const data = {
      text: html,
      style: options.style ?? 'unordered',
      depth,
      ...(options.checked === undefined ? {} : { checked: options.checked }),
    } as ListItemData;
    const syncContentFromDOM = vi.fn(() => {
      data.text = content.innerHTML;
    });

    return {
      context: {
        api,
        blockId: options.blockId,
        data,
        element: options.element === undefined ? element : options.element,
        getContentElement: () => content,
        syncContentFromDOM,
        getDepth: () => depth,
      },
      data,
      content,
      element,
      syncContentFromDOM,
    };
  };

  const backspaceEvent = (): KeyboardEvent =>
    new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true });

  describe('handleEnter — guards', () => {
    it('returns without reading the selection when the window has none', async () => {
      const stage = makeStage();
      const fixture = makeDeepContext(stage.api);
      const selectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(null);

      await expect(handleEnter(fixture.context)).resolves.toBeUndefined();

      expect(stage.insert).not.toHaveBeenCalled();
      expect(stage.splitBlock).not.toHaveBeenCalled();
      selectionSpy.mockRestore();
    });

    it('returns when the item has no element', async () => {
      const stage = makeStage();
      const fixture = makeDeepContext(stage.api, { element: null });

      await expect(handleEnter(fixture.context)).resolves.toBeUndefined();

      expect(stage.insert).not.toHaveBeenCalled();
      expect(stage.splitBlock).not.toHaveBeenCalled();
    });

    it('returns when the item has no content element', async () => {
      const stage = makeStage();
      const fixture = makeDeepContext(stage.api);

      await expect(handleEnter({ ...fixture.context, getContentElement: () => null })).resolves.toBeUndefined();

      expect(stage.insert).not.toHaveBeenCalled();
    });

    it('treats whitespace-only content as an empty item', async () => {
      const stage = makeStage();
      const fixture = makeDeepContext(stage.api, { html: '   ', blockId: 'b1', depth: 0 });

      caretIn(fixture.content, 1);
      await handleEnter(fixture.context);

      expect(stage.splitBlock).not.toHaveBeenCalled();
      expect(stage.convert).toHaveBeenCalledWith('b1', 'paragraph', { text: '' });
    });

    it('lands the caret at the start of the newly inserted item', async () => {
      const stage = makeStage();
      const fixture = makeDeepContext(stage.api);

      caretIn(fixture.content, 5);
      await handleEnter(fixture.context);

      expect(caretOffsetIn(stage.inserted)).toBe(0);
    });

    it('lands the caret at the start of the split tail', async () => {
      const stage = makeStage();
      const fixture = makeDeepContext(stage.api, { blockId: 'b1' });

      caretIn(fixture.content, 5);
      await handleEnter(fixture.context);

      expect(caretOffsetIn(stage.inserted)).toBe(0);
    });

    it('lands the caret at the start of the converted paragraph', async () => {
      const stage = makeStage();
      const fixture = makeDeepContext(stage.api, { html: '', blockId: 'b1', depth: 0 });

      await handleEnter(fixture.context);

      expect(stage.convert).toHaveBeenCalledWith('b1', 'paragraph', { text: '' });
      expect(caretOffsetIn(stage.inserted)).toBe(0);
    });

    it('does not look up a block for an undefined item id', async () => {
      const stage = makeStage();
      const fixture = makeDeepContext(stage.api, { html: '', depth: 0 });

      await handleEnter(fixture.context);

      expect(stage.getById).not.toHaveBeenCalled();
      expect(stage.convert).not.toHaveBeenCalled();
    });

    it('stops at a top-level item without a second lookup', async () => {
      const stage = makeStage();

      stage.store['b1'] = makeBlockStub('b1', { parentId: null });
      const fixture = makeDeepContext(stage.api, { html: '', blockId: 'b1', depth: 0 });

      await handleEnter(fixture.context);

      expect(stage.getById).toHaveBeenCalledTimes(1);
      expect(stage.convert).toHaveBeenCalledWith('b1', 'paragraph', { text: '' });
    });

    it('treats a non-list parent as no structural nesting', async () => {
      const stage = makeStage();

      stage.store['b1'] = makeBlockStub('b1', { parentId: 'p1' });
      stage.store['p1'] = makeBlockStub('p1', { name: 'paragraph' });
      const fixture = makeDeepContext(stage.api, { html: '', blockId: 'b1', depth: 0 });

      await handleEnter(fixture.context);

      expect(stage.parents).toStrictEqual([]);
      expect(stage.convert).toHaveBeenCalledWith('b1', 'paragraph', { text: '' });
    });

    it('treats a missing parent block as no structural nesting', async () => {
      const stage = makeStage();

      stage.store['b1'] = makeBlockStub('b1', { parentId: 'p1' });
      const fixture = makeDeepContext(stage.api, { html: '', blockId: 'b1', depth: 0 });

      await handleEnter(fixture.context);

      expect(stage.convert).toHaveBeenCalledWith('b1', 'paragraph', { text: '' });
    });

    it('reparents a nested item to its grandparent and leaves the caret on it', async () => {
      const stage = makeStage();
      const nested = makeBlockStub('b1', { parentId: 'p1', html: 'moved' });

      stage.store['b1'] = nested;
      stage.store['p1'] = makeBlockStub('p1', { parentId: 'g1' });
      const fixture = makeDeepContext(stage.api, { html: '', blockId: 'b1', depth: 0 });

      await handleEnter(fixture.context);

      expect(stage.parents).toStrictEqual([['b1', 'g1']]);
      expect(stage.convert).not.toHaveBeenCalled();
      expect(caretOffsetIn(nested)).toBe('moved'.length);
    });

    it('falls back to a null grandparent when the parent vanishes between lookups', async () => {
      const stage = makeStage();
      const nested = makeBlockStub('b1', { parentId: 'p1', html: 'moved' });
      let parentLookups = 0;

      stage.store['b1'] = nested;
      stage.getById.mockImplementation((id: string) => {
        if (id === 'p1') {
          parentLookups += 1;

          return parentLookups === 1 ? { id: 'p1', name: 'list', parentId: 'g1', holder: document.createElement('div') } : null;
        }

        return stage.store[id] ?? null;
      });
      const fixture = makeDeepContext(stage.api, { html: '', blockId: 'b1', depth: 0 });

      await expect(handleEnter(fixture.context)).resolves.toBeUndefined();

      expect(stage.parents).toStrictEqual([['b1', null]]);
    });

    it('leaves the caret alone when the reparented item cannot be found', async () => {
      const stage = makeStage();
      let itemLookups = 0;

      stage.store['b1'] = makeBlockStub('b1', { parentId: 'p1' });
      stage.store['p1'] = makeBlockStub('p1', { parentId: 'g1' });
      stage.getById.mockImplementation((id: string) => {
        if (id === 'b1') {
          itemLookups += 1;

          return itemLookups === 1 ? stage.store['b1'] : null;
        }

        return stage.store[id] ?? null;
      });
      const fixture = makeDeepContext(stage.api, { html: '', blockId: 'b1', depth: 0 });

      await expect(handleEnter(fixture.context)).resolves.toBeUndefined();

      expect(stage.parents).toStrictEqual([['b1', 'g1']]);
    });
  });

  describe('handleBackspace — guards and root level', () => {
    it('returns without reading the selection when the window has none', async () => {
      const stage = makeStage();
      const fixture = makeDeepContext(stage.api, { blockId: 'b1' });
      const selectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(null);

      await expect(handleBackspace(fixture.context, backspaceEvent())).resolves.toBeUndefined();

      expect(fixture.syncContentFromDOM).not.toHaveBeenCalled();
      selectionSpy.mockRestore();
    });

    it('returns when the item has no element', async () => {
      const stage = makeStage();
      const fixture = makeDeepContext(stage.api, { blockId: 'b1', element: null });

      caretIn(fixture.content, 0);
      await expect(handleBackspace(fixture.context, backspaceEvent())).resolves.toBeUndefined();

      expect(fixture.syncContentFromDOM).not.toHaveBeenCalled();
    });

    it('returns when the item has no content element', async () => {
      const stage = makeStage();
      const fixture = makeDeepContext(stage.api, { blockId: 'b1' });

      caretIn(fixture.content, 0);
      await expect(
        handleBackspace({ ...fixture.context, getContentElement: () => null }, backspaceEvent()),
      ).resolves.toBeUndefined();

      expect(fixture.syncContentFromDOM).not.toHaveBeenCalled();
    });

    it('replaces the selection so the caret is a fresh collapsed range', async () => {
      const stage = makeStage();
      const fixture = makeDeepContext(stage.api, { html: 'hello', blockId: 'b1' });

      // The selection is anchored on the holder, so emptying the item's content
      // cannot invalidate it: a stale range would still be readable afterwards.
      selectWithin(fixture.element, 0, 1);
      const event = backspaceEvent();

      await handleBackspace(fixture.context, event);

      const selection = window.getSelection();

      expect(event.defaultPrevented).toBe(true);
      expect(selection?.rangeCount).toBe(1);
      expect(selection?.getRangeAt(0).collapsed).toBe(true);
      expect(selection?.getRangeAt(0).startContainer).toBe(fixture.content);
      expect(selection?.getRangeAt(0).startOffset).toBe(0);
    });

    it('converts a top-level item to a paragraph, keeping its text', async () => {
      const stage = makeStage();
      const fixture = makeDeepContext(stage.api, { html: 'hello world', blockId: 'b1', depth: 0 });

      caretIn(fixture.content, 0);
      const event = backspaceEvent();

      await handleBackspace(fixture.context, event);

      expect(event.defaultPrevented).toBe(true);
      expect(stage.convert).toHaveBeenCalledWith('b1', 'paragraph', { text: 'hello world' });
      expect(caretOffsetIn(stage.inserted)).toBe(0);
    });

    it('leaves a caret that is not at the start to the browser', async () => {
      const stage = makeStage();
      const fixture = makeDeepContext(stage.api, { html: 'hello world', blockId: 'b1', depth: 0 });

      caretIn(fixture.content, 5);
      const event = backspaceEvent();

      await handleBackspace(fixture.context, event);

      expect(event.defaultPrevented).toBe(false);
      expect(stage.convert).not.toHaveBeenCalled();
    });

    it('does nothing at root level when the item has no block id', async () => {
      const stage = makeStage();
      const fixture = makeDeepContext(stage.api, { html: 'hello world', depth: 0 });

      caretIn(fixture.content, 0);
      await handleBackspace(fixture.context, backspaceEvent());

      expect(stage.convert).not.toHaveBeenCalled();
      expect(stage.update).not.toHaveBeenCalled();
      expect(stage.insert).not.toHaveBeenCalled();
    });

    it('outdents instead of converting when the item is nested', async () => {
      const stage = makeStage();

      stage.store['b1'] = makeBlockStub('b1', { parentId: null, html: 'hello world' });
      const fixture = makeDeepContext(stage.api, { html: 'hello world', blockId: 'b1', depth: 2 });

      caretIn(fixture.content, 0);
      await handleBackspace(fixture.context, backspaceEvent(), makeDepthValidator({ b1: 2 }));

      expect(stage.updated).toStrictEqual([['b1', { text: 'hello world', style: 'unordered', depth: 1 }]]);
      expect(stage.convert).not.toHaveBeenCalled();
      expect(caretOffsetIn(stage.store['b1'])).toBe(0);
    });

    it('reparents to the grandparent instead of outdenting flat depth', async () => {
      const stage = makeStage();
      const nested = makeBlockStub('b1', { parentId: 'p1', html: 'hello world' });

      stage.store['b1'] = nested;
      stage.store['p1'] = makeBlockStub('p1', { parentId: 'g1' });
      const fixture = makeDeepContext(stage.api, { html: 'hello world', blockId: 'b1', depth: 2 });

      caretIn(fixture.content, 0);
      await handleBackspace(fixture.context, backspaceEvent());

      expect(stage.parents).toStrictEqual([['b1', 'g1']]);
      expect(stage.updated).toStrictEqual([]);
      expect(stage.convert).not.toHaveBeenCalled();
      expect(caretOffsetIn(nested)).toBe(0);
    });

    it('falls back to a null grandparent when the parent vanishes between lookups', async () => {
      const stage = makeStage();
      let parentLookups = 0;

      stage.store['b1'] = makeBlockStub('b1', { parentId: 'p1', html: 'hello world' });
      stage.getById.mockImplementation((id: string) => {
        if (id === 'p1') {
          parentLookups += 1;

          return parentLookups === 1
            ? { id: 'p1', name: 'list', parentId: 'g1', holder: document.createElement('div') }
            : null;
        }

        return stage.store[id] ?? null;
      });
      const fixture = makeDeepContext(stage.api, { html: 'hello world', blockId: 'b1', depth: 2 });

      caretIn(fixture.content, 0);
      await expect(handleBackspace(fixture.context, backspaceEvent())).resolves.toBeUndefined();

      expect(stage.parents).toStrictEqual([['b1', null]]);
    });

    it('leaves the caret alone when the reparented item cannot be found', async () => {
      const stage = makeStage();
      let itemLookups = 0;

      stage.store['b1'] = makeBlockStub('b1', { parentId: 'p1', html: 'hello world' });
      stage.store['p1'] = makeBlockStub('p1', { parentId: 'g1' });
      stage.getById.mockImplementation((id: string) => {
        if (id === 'b1') {
          itemLookups += 1;

          return itemLookups === 1 ? stage.store['b1'] : null;
        }

        return stage.store[id] ?? null;
      });
      const fixture = makeDeepContext(stage.api, { html: 'hello world', blockId: 'b1', depth: 2 });

      caretIn(fixture.content, 0);
      await expect(handleBackspace(fixture.context, backspaceEvent())).resolves.toBeUndefined();

      expect(stage.parents).toStrictEqual([['b1', 'g1']]);
    });

    const modifierBackspace = async (
      modifiers: KeyboardEventInit,
    ): Promise<{ stage: Stage; event: KeyboardEvent }> => {
      const stage = makeStage();
      const fixture = makeDeepContext(stage.api, { html: 'hello world', blockId: 'b1', depth: 0 });

      caretIn(fixture.content, 0);
      const event = new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true, ...modifiers });

      await handleBackspace(fixture.context, event);

      return { stage, event };
    };

    it('leaves a meta-held Backspace to the browser', async () => {
      const { stage, event } = await modifierBackspace({ metaKey: true });

      expect(event.defaultPrevented).toBe(true);
      expect(stage.convert).not.toHaveBeenCalled();
      expect(stage.updated).toStrictEqual([]);
    });

    it('leaves a ctrl-held Backspace to the browser', async () => {
      const { stage, event } = await modifierBackspace({ ctrlKey: true });

      expect(event.defaultPrevented).toBe(true);
      expect(stage.convert).not.toHaveBeenCalled();
      expect(stage.updated).toStrictEqual([]);
    });

    it('leaves an alt-held Backspace to the browser', async () => {
      const { stage, event } = await modifierBackspace({ altKey: true });

      expect(event.defaultPrevented).toBe(true);
      expect(stage.convert).not.toHaveBeenCalled();
      expect(stage.updated).toStrictEqual([]);
    });
  });

  describe('handleOutdent', () => {
    it('does not cascade when no depth validator is given', async () => {
      const stage = makeStage();

      stage.store['b1'] = makeBlockStub('b1', { parentId: null, html: 'hello' });
      stage.indexStore[4] = makeBlockStub('d4', { html: 'child' });
      const fixture = makeDeepContext(stage.api, { html: 'hello', blockId: 'b1', depth: 2 });

      caretIn(fixture.content, 0);
      await expect(handleOutdent(fixture.context)).resolves.toBeUndefined();

      expect(stage.updated).toStrictEqual([['b1', { text: 'hello', style: 'unordered', depth: 1 }]]);
      expect(fixture.syncContentFromDOM).toHaveBeenCalledTimes(1);
    });

    it('puts the caret at the end when there is no caret to restore', async () => {
      const stage = makeStage();

      stage.store['b1'] = makeBlockStub('b1', { parentId: null, html: 'hello' });
      const fixture = makeDeepContext(stage.api, { html: 'hello', blockId: 'b1', depth: 2 });

      window.getSelection()?.removeAllRanges();
      await handleOutdent(fixture.context);

      expect(caretOffsetIn(stage.store['b1'])).toBe('hello'.length);
    });

    it('writes the empty id when the item has no block id', async () => {
      const stage = makeStage();
      const fixture = makeDeepContext(stage.api, { html: 'hello', depth: 2 });

      caretIn(fixture.content, 0);
      await handleOutdent(fixture.context);

      expect(stage.updated.map((entry) => entry[0])).toStrictEqual(['']);
    });

    it('stops the cascade at a non-list block', async () => {
      const stage = makeStage({ currentIndex: 1 });

      stage.getBlockIndex.mockReturnValue(1);
      stage.store['b1'] = makeBlockStub('b1', { parentId: null, html: 'hello' });
      stage.indexStore[2] = makeBlockStub('p2', { name: 'paragraph', html: 'para' });
      stage.indexStore[3] = makeBlockStub('d3', { html: 'child' });
      const fixture = makeDeepContext(stage.api, { html: 'hello', blockId: 'b1', depth: 2 });

      caretIn(fixture.content, 0);
      await handleOutdent(fixture.context, makeDepthValidator({ b1: 2, p2: 3, d3: 3 }));

      expect(stage.updated.map((entry) => entry[0])).toStrictEqual(['b1']);
    });

    it('stops the cascade at the block count boundary', async () => {
      const stage = makeStage({ currentIndex: 1, blocksCount: 3 });

      stage.getBlockIndex.mockReturnValue(1);
      stage.store['b1'] = makeBlockStub('b1', { parentId: null, html: 'hello' });
      stage.indexStore[2] = makeBlockStub('d2', { html: 'child' });
      // index === blocksCount: a block appended after the count was read.
      stage.indexStore[3] = makeBlockStub('d3', { html: 'appended' });
      const fixture = makeDeepContext(stage.api, { html: 'hello', blockId: 'b1', depth: 2 });

      caretIn(fixture.content, 0);
      await handleOutdent(fixture.context, makeDepthValidator({ b1: 2, d2: 3, d3: 3 }));

      expect(stage.updated.map((entry) => entry[0])).toStrictEqual(['b1', 'd2']);
    });

    it('cascades from the current index when the item index is unknown', async () => {
      const stage = makeStage({ currentIndex: 1 });

      stage.getBlockIndex.mockReturnValue(undefined);
      stage.store['b1'] = makeBlockStub('b1', { parentId: null, html: 'hello' });
      stage.indexStore[2] = makeBlockStub('d2', { html: 'child' });
      const fixture = makeDeepContext(stage.api, { html: 'hello', blockId: 'b1', depth: 2 });

      caretIn(fixture.content, 0);
      await handleOutdent(fixture.context, makeDepthValidator({ b1: 2, d2: 3 }));

      expect(stage.updated.map((entry) => entry[0])).toStrictEqual(['b1', 'd2']);
    });
  });

  describe('handleIndent', () => {
    it('does nothing when the item has no preceding block', async () => {
      const stage = makeStage({ currentIndex: 0 });

      stage.getBlockIndex.mockReturnValue(0);
      stage.indexStore[-1] = makeBlockStub('prev', { html: 'prev' });
      const fixture = makeDeepContext(stage.api, { html: 'hello', blockId: 'b1', depth: 1 });

      await handleIndent(fixture.context, makeDepthValidator({}, { 0: 3 }));

      expect(stage.update).not.toHaveBeenCalled();
    });

    it('does nothing when the preceding block is not a list item', async () => {
      const stage = makeStage({ currentIndex: 2 });

      stage.getBlockIndex.mockReturnValue(2);
      stage.indexStore[1] = makeBlockStub('prev', { name: 'paragraph', html: 'prev' });
      const fixture = makeDeepContext(stage.api, { html: 'hello', blockId: 'b1', depth: 1 });

      await handleIndent(fixture.context, makeDepthValidator({}, { 2: 3 }));

      expect(stage.update).not.toHaveBeenCalled();
    });

    it('does nothing when the item is already at the deepest allowed level', async () => {
      const stage = makeStage({ currentIndex: 2 });

      stage.getBlockIndex.mockReturnValue(2);
      stage.indexStore[1] = makeBlockStub('prev', { html: 'prev' });
      const fixture = makeDeepContext(stage.api, { html: 'hello', blockId: 'b1', depth: 2 });

      await handleIndent(fixture.context, makeDepthValidator({}, { 2: 2 }));

      expect(stage.update).not.toHaveBeenCalled();
    });

    it('indents one level, cascades to descendants and restores the caret', async () => {
      const stage = makeStage({ currentIndex: 0, blocksCount: 12 });

      stage.getBlockIndex.mockReturnValue(6);
      stage.store['b1'] = makeBlockStub('b1', { html: 'hello' });
      stage.indexStore[5] = makeBlockStub('prev', { html: 'prev' });
      stage.indexStore[7] = makeBlockStub('d3', { html: 'child' });
      stage.indexStore[8] = makeBlockStub('d4', { html: 'sibling' });
      const fixture = makeDeepContext(stage.api, { html: 'hello', blockId: 'b1', depth: 1 });

      caretIn(fixture.content, 3);
      await handleIndent(fixture.context, makeDepthValidator({ b1: 1, d3: 2, d4: 0 }, { 6: 3 }));

      expect(stage.updated).toStrictEqual([
        ['b1', { text: 'hello', style: 'unordered', depth: 2 }],
        ['d3', { depth: 3 }],
      ]);
      expect(fixture.syncContentFromDOM).toHaveBeenCalledTimes(1);
      expect(caretOffsetIn(stage.store['b1'])).toBe(3);
    });

    it('resolves the index through the current index when the item index is unknown', async () => {
      const stage = makeStage({ currentIndex: 2 });

      stage.getBlockIndex.mockReturnValue(undefined);
      stage.store['b1'] = makeBlockStub('b1', { html: 'hello' });
      stage.indexStore[1] = makeBlockStub('prev', { html: 'prev' });
      const fixture = makeDeepContext(stage.api, { html: 'hello', blockId: 'b1', depth: 1 });

      await handleIndent(fixture.context, makeDepthValidator({}, { 2: 3 }));

      expect(stage.updated.map((entry) => entry[0])).toStrictEqual(['b1']);
    });

    it('stops the cascade at a non-list block', async () => {
      const stage = makeStage({ currentIndex: 2 });

      stage.getBlockIndex.mockReturnValue(2);
      stage.store['b1'] = makeBlockStub('b1', { html: 'hello' });
      stage.indexStore[1] = makeBlockStub('prev', { html: 'prev' });
      stage.indexStore[3] = makeBlockStub('p3', { name: 'paragraph', html: 'para' });
      stage.indexStore[4] = makeBlockStub('d4', { html: 'child' });
      const fixture = makeDeepContext(stage.api, { html: 'hello', blockId: 'b1', depth: 1 });

      await handleIndent(fixture.context, makeDepthValidator({ b1: 1, p3: 2, d4: 2 }, { 2: 3 }));

      expect(stage.updated.map((entry) => entry[0])).toStrictEqual(['b1']);
    });

    it('stops the cascade at the block count boundary', async () => {
      const stage = makeStage({ currentIndex: 2, blocksCount: 3 });

      stage.getBlockIndex.mockReturnValue(2);
      stage.store['b1'] = makeBlockStub('b1', { html: 'hello' });
      stage.indexStore[1] = makeBlockStub('prev', { html: 'prev' });
      stage.indexStore[3] = makeBlockStub('d3', { html: 'appended' });
      const fixture = makeDeepContext(stage.api, { html: 'hello', blockId: 'b1', depth: 1 });

      await handleIndent(fixture.context, makeDepthValidator({ b1: 1, d3: 2 }, { 2: 3 }));

      expect(stage.updated.map((entry) => entry[0])).toStrictEqual(['b1']);
    });

    it('cascades from the current index when the item index is unknown', async () => {
      const stage = makeStage({ currentIndex: 2 });

      stage.getBlockIndex.mockReturnValue(undefined);
      stage.store['b1'] = makeBlockStub('b1', { html: 'hello' });
      stage.indexStore[1] = makeBlockStub('prev', { html: 'prev' });
      stage.indexStore[3] = makeBlockStub('d3', { html: 'child' });
      const fixture = makeDeepContext(stage.api, { html: 'hello', blockId: 'b1', depth: 1 });

      await handleIndent(fixture.context, makeDepthValidator({ b1: 1, d3: 2 }, { 2: 3 }));

      expect(stage.updated.map((entry) => entry[0])).toStrictEqual(['b1', 'd3']);
    });

    it('puts the caret at the end when there is no caret to restore', async () => {
      const stage = makeStage({ currentIndex: 2 });

      stage.getBlockIndex.mockReturnValue(2);
      stage.store['b1'] = makeBlockStub('b1', { html: 'hello' });
      stage.indexStore[1] = makeBlockStub('prev', { html: 'prev' });
      const fixture = makeDeepContext(stage.api, { html: 'hello', blockId: 'b1', depth: 1 });

      window.getSelection()?.removeAllRanges();
      await handleIndent(fixture.context, makeDepthValidator({}, { 2: 3 }));

      expect(caretOffsetIn(stage.store['b1'])).toBe('hello'.length);
    });

    it('writes the empty id when the item has no block id', async () => {
      const stage = makeStage({ currentIndex: 2 });

      // A block index that is NOT the current index, so the two sources of the
      // index cannot stand in for each other.
      stage.getBlockIndex.mockReturnValue(6);
      stage.indexStore[1] = makeBlockStub('prev', { html: 'prev' });
      const fixture = makeDeepContext(stage.api, { html: 'hello', depth: 1 });

      await handleIndent(fixture.context, makeDepthValidator({}, { 2: 3 }));

      expect(stage.updated.map((entry) => entry[0])).toStrictEqual(['']);
    });
  });

  describe('toggleChecklistChecked', () => {
    it('flips the flag, the DOM state and persists it', async () => {
      const stage = makeStage();
      const fixture = makeDeepContext(stage.api, { style: 'checklist', checked: false, blockId: 'b1' });

      await expect(toggleChecklistChecked(fixture.context)).resolves.toBe(true);

      expect(fixture.data.checked).toBe(true);
      expect(fixture.content.getAttribute('data-checked')).toBe('true');
      expect(stage.updated).toStrictEqual([
        ['b1', { text: 'hello world', style: 'checklist', depth: 2, checked: true }],
      ]);
    });

    it('does not throw when the item has no element', async () => {
      const stage = makeStage();
      const fixture = makeDeepContext(stage.api, {
        style: 'checklist',
        checked: false,
        blockId: 'b1',
        element: null,
      });

      await expect(toggleChecklistChecked(fixture.context)).resolves.toBe(true);

      expect(fixture.content.getAttribute('data-checked')).toBe('true');
    });

    it('does not persist when the item has no block id', async () => {
      const stage = makeStage();
      const fixture = makeDeepContext(stage.api, { style: 'checklist', checked: false });

      await expect(toggleChecklistChecked(fixture.context)).resolves.toBe(true);

      expect(fixture.data.checked).toBe(true);
      expect(stage.update).not.toHaveBeenCalled();
    });

    it('leaves a plain list item alone', async () => {
      const stage = makeStage();
      const fixture = makeDeepContext(stage.api, { style: 'unordered', blockId: 'b1' });

      await expect(toggleChecklistChecked(fixture.context)).resolves.toBe(false);

      expect(stage.update).not.toHaveBeenCalled();
      expect(fixture.content.getAttribute('data-checked')).toBe(null);
    });
  });
});
