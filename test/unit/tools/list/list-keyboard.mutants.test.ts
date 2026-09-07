import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  handleEnter,
  handleBackspace,
  type KeyboardContext,
} from '../../../../src/tools/list/list-keyboard';
import type { API } from '../../../../types';
import type { ListItemData } from '../../../../src/tools/list/types';

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
});
