/**
 * A key that turns a list item or a toggle into text says so in the polite
 * live region, like Notion: "Converted to Text" (U095, U099, U144, toggle Backspace).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handleBackspace, handleEnter } from '../../../src/tools/list/list-keyboard';
import type { KeyboardContext } from '../../../src/tools/list/list-keyboard';
import { handleToggleBackspace } from '../../../src/tools/toggle/toggle-keyboard';
import type { ToggleKeyboardContext } from '../../../src/tools/toggle/toggle-keyboard';
import { announce } from '../../../src/components/utils/announcer';
import { Paragraph } from '../../../src/tools/paragraph';
import en from '../../../src/components/i18n/locales/en.json';
import type { API } from '../../../types';

vi.mock('../../../src/components/utils/announcer', () => ({ announce: vi.fn() }));

const messages: Record<string, string> = en;

const convertedBlock = (id: string): { id: string; holder: HTMLElement } => {
  const holder = document.createElement('div');
  const content = document.createElement('div');

  content.setAttribute('contenteditable', 'true');
  holder.appendChild(content);

  return { id, holder };
};

const makeApi = (convert: ReturnType<typeof vi.fn>): API => ({
  blocks: {
    getById: (id: string) => ({ id, name: 'list', parentId: null }),
    setBlockParent: vi.fn(),
    convert,
    update: vi.fn(),
  },
  caret: { setToBlock: vi.fn(), updateLastCaretAfterPosition: vi.fn() },
  i18n: {
    t: (key: string, vars?: Record<string, string>) => (messages[key] ?? key).replace(/\{(\w+)\}/g, (_m, name: string) => vars?.[name] ?? ''),
    has: (key: string) => key in messages,
  },
  notifier: { show: vi.fn() },
  tools: { getBlockTools: () => [{ name: 'paragraph', toolbox: [Paragraph.toolbox] }] },
} as unknown as API);

/** A content element in the document with a collapsed caret at its start. */
const contentWithCaretAtStart = (text: string): HTMLElement => {
  const content = document.createElement('div');

  content.contentEditable = 'true';
  content.textContent = text;
  document.body.appendChild(content);

  const range = document.createRange();

  range.setStart(content.firstChild ?? content, 0);
  range.collapse(true);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);

  return content;
};

const keyEvent = (): KeyboardEvent => ({
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
} as unknown as KeyboardEvent);

const listContext = (api: API, text: string, depth = 0): KeyboardContext => {
  const content = contentWithCaretAtStart(text);
  const element = document.createElement('div');

  element.appendChild(content);

  return {
    api,
    blockId: 'item',
    data: { text, style: 'unordered', depth },
    element,
    getContentElement: () => content,
    syncContentFromDOM: vi.fn(),
    getDepth: () => depth,
  };
};

describe('keys that turn a block into text announce it', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Enter on an empty top-level list item says Converted to Text', async () => {
    const convert = vi.fn().mockResolvedValue(convertedBlock('item'));

    await handleEnter(listContext(makeApi(convert), ''));

    expect(vi.mocked(announce)).toHaveBeenCalledWith('Converted to Text');
    expect(convert).toHaveBeenCalledWith('item', 'paragraph', { text: '' });
  });

  it('Backspace at the start of a top-level list item says Converted to Text', async () => {
    const convert = vi.fn().mockResolvedValue(convertedBlock('item'));

    await handleBackspace(listContext(makeApi(convert), 'two'), keyEvent());

    expect(vi.mocked(announce)).toHaveBeenCalledWith('Converted to Text');
    expect(convert).toHaveBeenCalledWith('item', 'paragraph', { text: 'two' });
  });

  it('says nothing when the conversion is refused', async () => {
    const convert = vi.fn().mockRejectedValue(new Error('being edited by someone else'));

    await handleBackspace(listContext(makeApi(convert), 'two'), keyEvent());

    expect(vi.mocked(announce)).not.toHaveBeenCalled();
  });

  it('Backspace at the start of an empty toggle says Converted to Text', async () => {
    const convert = vi.fn().mockResolvedValue(convertedBlock('tg'));
    const content = contentWithCaretAtStart('');
    const context: ToggleKeyboardContext = {
      api: makeApi(convert),
      blockId: 'tg',
      data: { text: '' },
      element: null,
      getContentElement: () => content,
      syncContentFromDOM: vi.fn(),
      isOpen: true,
      setOpen: vi.fn(),
    };

    await handleToggleBackspace(context, keyEvent());

    expect(vi.mocked(announce)).toHaveBeenCalledWith('Converted to Text');
    expect(convert).toHaveBeenCalledWith('tg', 'paragraph', { text: '' });
  });
});
