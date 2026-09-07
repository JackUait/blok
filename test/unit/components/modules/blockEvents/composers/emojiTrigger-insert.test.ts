import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmojiTrigger } from '../../../../../../src/components/modules/blockEvents/composers/emojiTrigger';
import { createBlock, createBlokModules, setCaret } from './emojiTrigger.fixture';
import type { ProcessedEmoji } from '../../../../../../src/components/utils/emoji/emoji-data';

/**
 * A real @emoji-mart/data package load is slow and, under concurrent test
 * runs, flaky (see emojiTrigger.test.ts's identical rationale). "fire" and
 * "raised_hand" cover every query these tests type, and raised_hand's six
 * skins let handleInput actually open the (mocked) menu for the skin-tone
 * tests — a search that matches nothing would close it before commit() runs,
 * which would make "closes the menu after committing" pass for the wrong
 * reason (already closed, not closed BY commit).
 */
const MOCK_EMOJI_MART_DATA = {
  default: {
    categories: [
      { id: 'nature', emojis: ['fire'] },
      { id: 'people', emojis: ['raised_hand'] },
    ],
    emojis: {
      fire: { id: 'fire', name: 'Fire', keywords: ['hot', 'flame'], skins: [{ native: '🔥', unified: '1f525' }], version: 1 },
      raised_hand: {
        id: 'raised_hand',
        name: 'Raised Hand',
        keywords: ['hand'],
        skins: [
          { native: '✋', unified: '270b' },
          { native: '✋🏻', unified: '270b-1f3fb' },
          { native: '✋🏼', unified: '270b-1f3fc' },
          { native: '✋🏽', unified: '270b-1f3fd' },
          { native: '✋🏾', unified: '270b-1f3fe' },
          { native: '✋🏿', unified: '270b-1f3ff' },
        ],
        version: 1,
      },
    },
    aliases: {},
  },
};

vi.mock('@emoji-mart/data', () => MOCK_EMOJI_MART_DATA);

interface MockEmojiPickerOptions {
  onSelect: (native: string) => void;
  onRemove: () => void;
  i18n: { t: (key: string) => string };
  locale: string;
  inline?: boolean;
}

/** Same stub strategy as emojiTrigger.test.ts: a real EmojiPicker needs window.matchMedia, which jsdom lacks. */
const mockPickerElement = document.createElement('div');
const mockPickerOpen = vi.fn<(anchor: HTMLElement, anchorRect?: DOMRect) => Promise<void>>().mockResolvedValue(undefined);
const mockPickerSetQuery = vi.fn<(query: string) => void>();
const mockPickerClose = vi.fn<() => void>();

vi.mock('../../../../../../src/tools/callout/emoji-picker', () => ({
  prefetchEmojiPickerData: vi.fn(),
  EmojiPicker: vi.fn(function emojiPickerMock(_options: MockEmojiPickerOptions) {
    return {
      open: mockPickerOpen,
      setQuery: mockPickerSetQuery,
      close: mockPickerClose,
      getElement: () => mockPickerElement,
      isOpen: () => true,
    };
  }),
}));

const FIRE: ProcessedEmoji = {
  id: 'fire', name: 'Fire', keywords: ['hot'], native: '🔥', skins: ['🔥'], category: 'nature',
};
const HAND: ProcessedEmoji = {
  id: 'raised_hand', name: 'Raised Hand', keywords: ['hand'], native: '✋',
  skins: ['✋', '✋🏻', '✋🏼', '✋🏽', '✋🏾', '✋🏿'], category: 'people',
};

describe('EmojiTrigger — insertion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPickerOpen.mockResolvedValue(undefined);
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('replaces the typed ":fi" with the emoji character', async () => {
    const block = createBlock(':fi');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput({ inputType: 'insertText', data: 'i', isComposing: false } as InputEvent);
    trigger.commit(FIRE);

    expect(block.currentInput?.textContent).toBe('🔥');
  });

  it('keeps the text before and after the span', async () => {
    const block = createBlock('a :fi b');

    document.body.appendChild(block.holder);
    setCaret(block, 5);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput({ inputType: 'insertText', data: 'i', isComposing: false } as InputEvent);
    trigger.commit(FIRE);

    expect(block.currentInput?.textContent).toBe('a 🔥 b');
  });

  it('leaves the caret directly after the inserted emoji', async () => {
    const block = createBlock('a :fi');

    document.body.appendChild(block.holder);
    setCaret(block, 5);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput({ inputType: 'insertText', data: 'i', isComposing: false } as InputEvent);
    trigger.commit(FIRE);

    const range = window.getSelection()?.getRangeAt(0);

    expect(range?.collapsed).toBe(true);
    expect(range?.startOffset).toBe('a 🔥'.length);
  });

  it('applies the saved skin tone', async () => {
    localStorage.setItem('blok-emoji-skin-tone', '3');

    const block = createBlock(':ha');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput({ inputType: 'insertText', data: 'a', isComposing: false } as InputEvent);
    trigger.commit(HAND);

    expect(block.currentInput?.textContent).toBe('✋🏽');
  });

  it('falls back to the default skin when the stored tone is out of range', async () => {
    localStorage.setItem('blok-emoji-skin-tone', '4');

    const block = createBlock(':fi');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput({ inputType: 'insertText', data: 'i', isComposing: false } as InputEvent);
    trigger.commit(FIRE);

    expect(block.currentInput?.textContent).toBe('🔥');
  });

  /**
   * Deviates from the task brief's literal `toHaveBeenCalledTimes(1)`: reading
   * UndoHistory.stopCapturing (src/components/modules/yjs/undo-history.ts)
   * shows it only forces the immediately NEXT change into a fresh undo entry.
   * A single call before the write isolates the emoji insert from the
   * keystrokes that opened the menu, but NOT from whatever the user types
   * right after committing — that merges forward into the same entry unless
   * stopCapturing runs again after the write too. markdownShortcuts.ts's
   * handleInlineMarkdown calls it on both sides for exactly this reason; this
   * test asserts both boundaries by snapshotting the text at each call.
   */
  it('stops Yjs capturing before AND after the DOM write, isolating the emoji on both sides', async () => {
    const block = createBlock(':fi');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const modules = createBlokModules(block);
    const trigger = new EmojiTrigger(modules);
    const textAtEachCall: Array<string | null> = [];

    vi.mocked(modules.YjsManager.stopCapturing).mockImplementation(() => {
      textAtEachCall.push(block.currentInput?.textContent ?? null);
    });

    await trigger.handleInput({ inputType: 'insertText', data: 'i', isComposing: false } as InputEvent);
    trigger.commit(FIRE);

    expect(textAtEachCall).toEqual([':fi', '🔥']);
  });

  it('closes the menu after committing', async () => {
    const block = createBlock(':fi');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput({ inputType: 'insertText', data: 'i', isComposing: false } as InputEvent);

    expect(trigger.opened).toBe(true);

    trigger.commit(FIRE);

    expect(trigger.opened).toBe(false);
  });
});
