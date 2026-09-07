// test/unit/components/modules/blockEvents/composers/emojiTrigger-scroll-lock.test.ts
//
// The inline picker is anchored to the caret's on-screen position, so a page
// scroll while it's open drags the picker away from the text that opened it.
// EmojiTrigger locks the page (via ScrollLocker, reference-counted — see
// src/components/utils/scroll-locker.ts) for the menu's whole open lifetime.
//
// `this.opened` has exactly one write site that sets it true (renderMenu)
// and exactly one that sets it false (close()) — every close path in the
// composer, including insertNative's commit paths, routes through close().
// That means one lock()/unlock() pair at those two sites covers every path
// below by construction; each test still exercises the real trigger to
// prove that funnel actually holds for that concrete scenario, and the
// pairing tests prove no path double-locks without a matching unlock.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmojiTrigger } from '../../../../../../src/components/modules/blockEvents/composers/emojiTrigger';
import { ScrollLocker } from '../../../../../../src/components/utils/scroll-locker';
import type { Block } from '../../../../../../src/components/block';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';
import { createBlock, createBlokModules, setCaret } from './emojiTrigger.fixture';

/**
 * Small fixed dataset — same rationale as emojiTrigger.test.ts: the real
 * @emoji-mart/data package is ~415KB and loading it for real is slow/flaky
 * under concurrent runs. "fire" and "grinning" cover every query below.
 */
const MOCK_EMOJI_MART_DATA = {
  default: {
    categories: [{ id: 'people', emojis: ['fire', 'grinning'] }],
    emojis: {
      fire: { id: 'fire', name: 'Fire', keywords: ['hot', 'flame'], skins: [{ native: '🔥', unified: '1f525' }], version: 1 },
      grinning: { id: 'grinning', name: 'Grinning Face', keywords: ['happy'], skins: [{ native: '😀', unified: '1f600' }], version: 1 },
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

/** Stable across the file, matching emojiTrigger.test.ts's stub strategy — a real EmojiPicker needs window.matchMedia, which jsdom lacks. */
const mockPickerElement = document.createElement('div');
const mockPickerConstructor = vi.fn<(options: MockEmojiPickerOptions) => void>();
const mockPickerOpen = vi.fn<(anchor: HTMLElement, anchorRect?: DOMRect) => Promise<void>>().mockResolvedValue(undefined);
const mockPickerSetQuery = vi.fn<(query: string) => void>();
const mockPickerClose = vi.fn<() => void>();

vi.mock('../../../../../../src/tools/callout/emoji-picker', () => ({
  prefetchEmojiPickerData: vi.fn(),
  EmojiPicker: vi.fn(function emojiPickerMock(options: MockEmojiPickerOptions) {
    mockPickerConstructor(options);

    return {
      open: mockPickerOpen,
      setQuery: mockPickerSetQuery,
      close: mockPickerClose,
      getElement: () => mockPickerElement,
      isOpen: () => true,
    };
  }),
}));

const SCROLL_LOCK_ATTR = 'data-blok-scroll-locked';

const createInputEvent = (options: Partial<InputEvent> = {}): InputEvent => ({
  inputType: 'insertText',
  data: 'i',
  isComposing: false,
  ...options,
} as InputEvent);

/** Renders one grid result button on the mocked picker's element, so Enter/Tab has something to commit. */
function renderResultButton(native: string): HTMLButtonElement {
  const btn = document.createElement('button');

  btn.setAttribute('data-emoji-native', native);
  mockPickerElement.appendChild(btn);

  return btn;
}

/** Opens the menu on `text` (caret defaults to the end) and returns the trigger for further interaction. */
async function openMenu(
  text: string,
  options: { caret?: number; renderButton?: string } = {}
): Promise<{ trigger: EmojiTrigger; block: Block; modules: BlokModules }> {
  const block = createBlock(text);

  document.body.appendChild(block.holder);
  setCaret(block, options.caret ?? text.length);

  const modules = createBlokModules(block);
  const trigger = new EmojiTrigger(modules);

  if (options.renderButton !== undefined) {
    renderResultButton(options.renderButton);
  }

  await trigger.handleInput(createInputEvent());

  return { trigger, block, modules };
}

describe('EmojiTrigger — page scroll lock', () => {
  let currentTrigger: EmojiTrigger | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPickerOpen.mockResolvedValue(undefined);
    mockPickerElement.innerHTML = '';
    document.body.removeAttribute(SCROLL_LOCK_ATTR);
  });

  afterEach(() => {
    // Safety net: any test that ends without explicitly closing would leak
    // the document-level selectionchange listener AND the scroll lock onto
    // every later test in this file.
    currentTrigger?.close();
    currentTrigger = undefined;
    mockPickerElement.innerHTML = '';
    document.body.innerHTML = '';
    document.body.removeAttribute(SCROLL_LOCK_ATTR);
    vi.restoreAllMocks();
  });

  it('locks the page while the menu is open', async () => {
    const { trigger } = await openMenu(':fi');

    currentTrigger = trigger;

    expect(document.body).toHaveAttribute(SCROLL_LOCK_ATTR, 'true');
  });

  it('never locks the page for a colon typed in ordinary prose with no menu open', async () => {
    const block = createBlock('10:30');

    document.body.appendChild(block.holder);
    setCaret(block, 5);

    const trigger = new EmojiTrigger(createBlokModules(block));

    currentTrigger = trigger;

    await trigger.handleInput(createInputEvent({ data: '0' }));

    expect(trigger.opened).toBe(false);
    expect(document.body).not.toHaveAttribute(SCROLL_LOCK_ATTR);
  });

  it("locks only document.body — the picker's own element is untouched", async () => {
    const { trigger } = await openMenu(':fi');

    currentTrigger = trigger;

    expect(mockPickerElement.style.overflow).toBe('');
    expect(mockPickerElement.hasAttribute(SCROLL_LOCK_ATTR)).toBe(false);
  });

  describe('releases the lock on every path that closes the menu', () => {
    it('Escape', async () => {
      const { trigger } = await openMenu(':fi');

      currentTrigger = trigger;

      const handled = trigger.handleKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(handled).toBe(true);
      expect(trigger.opened).toBe(false);
      expect(document.body).not.toHaveAttribute(SCROLL_LOCK_ATTR);
    });

    it('a whitespace character typed into the query', async () => {
      const { trigger, block } = await openMenu(':fi');

      currentTrigger = trigger;

      if (block.currentInput !== null && block.currentInput !== undefined) {
        block.currentInput.textContent = ':fi ';
      }
      setCaret(block, 4);
      await trigger.handleInput(createInputEvent({ data: ' ' }));

      expect(trigger.opened).toBe(false);
      expect(document.body).not.toHaveAttribute(SCROLL_LOCK_ATTR);
    });

    it('the trigger span disappearing — backspacing away the leading colon', async () => {
      const { trigger, block } = await openMenu(':fi');

      currentTrigger = trigger;

      if (block.currentInput !== null && block.currentInput !== undefined) {
        block.currentInput.textContent = 'fi';
      }
      setCaret(block, 2);
      await trigger.handleInput(createInputEvent({ inputType: 'deleteContentBackward', data: null }));

      expect(trigger.opened).toBe(false);
      expect(document.body).not.toHaveAttribute(SCROLL_LOCK_ATTR);
    });

    it('the query matching nothing', async () => {
      const block = createBlock(':zzzzzz');

      document.body.appendChild(block.holder);
      setCaret(block, 7);

      const trigger = new EmojiTrigger(createBlokModules(block));

      currentTrigger = trigger;

      await trigger.handleInput(createInputEvent({ data: 'z' }));

      expect(trigger.opened).toBe(false);
      expect(document.body).not.toHaveAttribute(SCROLL_LOCK_ATTR);
    });

    it('the caret moving out of the span, within the same block', async () => {
      const { trigger, block } = await openMenu(':fi elsewhere');

      currentTrigger = trigger;

      setCaret(block, 10);
      document.dispatchEvent(new Event('selectionchange'));

      expect(trigger.opened).toBe(false);
      expect(document.body).not.toHaveAttribute(SCROLL_LOCK_ATTR);
    });

    it('the current block changing', async () => {
      const { trigger, modules } = await openMenu(':fi');
      const otherBlock = createBlock('somewhere else');

      currentTrigger = trigger;
      document.body.appendChild(otherBlock.holder);

      // Selection stays inside the ORIGINAL block's input; BlockManager now
      // reports a different current block — that's what a block switch
      // looks like from EmojiTrigger's side (see handleSelectionChange,
      // which re-resolves `input` from BlockManager.currentBlock on every
      // call rather than closing over the input it opened with).
      modules.BlockManager.currentBlock = otherBlock;
      document.dispatchEvent(new Event('selectionchange'));

      expect(trigger.opened).toBe(false);
      expect(document.body).not.toHaveAttribute(SCROLL_LOCK_ATTR);
    });

    it('committing the highlighted emoji via Enter', async () => {
      const { trigger } = await openMenu(':i', { caret: 2, renderButton: '🔥' });

      currentTrigger = trigger;

      const handled = trigger.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(handled).toBe(true);
      expect(trigger.opened).toBe(false);
      expect(document.body).not.toHaveAttribute(SCROLL_LOCK_ATTR);
    });

    it('committing the highlighted emoji via Tab', async () => {
      const { trigger } = await openMenu(':i', { caret: 2, renderButton: '🔥' });

      currentTrigger = trigger;

      const handled = trigger.handleKeydown(new KeyboardEvent('keydown', { key: 'Tab' }));

      expect(handled).toBe(true);
      expect(trigger.opened).toBe(false);
      expect(document.body).not.toHaveAttribute(SCROLL_LOCK_ATTR);
    });

    it("committing via a mouse click on a grid result — the picker's onSelect callback", async () => {
      const { trigger } = await openMenu(':fi');

      currentTrigger = trigger;

      const options = mockPickerConstructor.mock.calls[0]?.[0];

      if (options === undefined) {
        throw new Error('EmojiPicker was never constructed');
      }

      options.onSelect('🔥');

      expect(trigger.opened).toBe(false);
      expect(document.body).not.toHaveAttribute(SCROLL_LOCK_ATTR);
    });

    it('committing via the closing-colon shortcut on an exact match', async () => {
      const { trigger, block } = await openMenu(':fire', { caret: 5 });

      currentTrigger = trigger;

      if (block.currentInput !== null && block.currentInput !== undefined) {
        block.currentInput.textContent = ':fire:';
      }
      setCaret(block, 6);
      await trigger.handleInput(createInputEvent({ data: ':' }));

      expect(block.currentInput?.textContent).toBe('🔥');
      expect(trigger.opened).toBe(false);
      expect(document.body).not.toHaveAttribute(SCROLL_LOCK_ATTR);
    });

    it('a closing colon after a non-exact query — closes without committing', async () => {
      const { trigger, block } = await openMenu(':fi');

      currentTrigger = trigger;

      if (block.currentInput !== null && block.currentInput !== undefined) {
        block.currentInput.textContent = ':fi:';
      }
      setCaret(block, 4);
      await trigger.handleInput(createInputEvent({ data: ':' }));

      expect(block.currentInput?.textContent).toBe(':fi:');
      expect(trigger.opened).toBe(false);
      expect(document.body).not.toHaveAttribute(SCROLL_LOCK_ATTR);
    });

    it("the picker closing itself — the onRemove callback", async () => {
      const { trigger } = await openMenu(':fi');

      currentTrigger = trigger;

      const options = mockPickerConstructor.mock.calls[0]?.[0];

      if (options === undefined) {
        throw new Error('EmojiPicker was never constructed');
      }

      options.onRemove();

      expect(trigger.opened).toBe(false);
      expect(document.body).not.toHaveAttribute(SCROLL_LOCK_ATTR);
    });

    it('the composer being destroyed while the menu is open', async () => {
      const { trigger } = await openMenu(':fi');

      trigger.destroy();

      expect(document.body).not.toHaveAttribute(SCROLL_LOCK_ATTR);
    });
  });

  describe('pairing — the lock count returns to exactly zero', () => {
    it('a probe locker proves the count is back at zero after close', async () => {
      const { trigger } = await openMenu(':fi');

      trigger.close();

      expect(document.body).not.toHaveAttribute(SCROLL_LOCK_ATTR);

      // If the composer's own lock were still held (count > 0), this probe's
      // lock() would be a no-op DOM-wise (already locked) — the attribute
      // would already read 'true' above. Toggling it here from scratch
      // proves the count is exactly 0, not just still nonzero-but-hidden.
      const probe = new ScrollLocker();

      probe.lock();
      expect(document.body).toHaveAttribute(SCROLL_LOCK_ATTR, 'true');
      probe.unlock();
      expect(document.body).not.toHaveAttribute(SCROLL_LOCK_ATTR);
    });

    it('reopening after a close does not double-lock', async () => {
      const block = createBlock(':fi');

      document.body.appendChild(block.holder);
      setCaret(block, 3);

      const trigger = new EmojiTrigger(createBlokModules(block));

      currentTrigger = trigger;

      await trigger.handleInput(createInputEvent());
      expect(document.body).toHaveAttribute(SCROLL_LOCK_ATTR, 'true');

      trigger.close();
      expect(document.body).not.toHaveAttribute(SCROLL_LOCK_ATTR);

      // Re-trigger the same span from scratch.
      setCaret(block, 3);
      await trigger.handleInput(createInputEvent());
      expect(document.body).toHaveAttribute(SCROLL_LOCK_ATTR, 'true');

      trigger.close();
      expect(document.body).not.toHaveAttribute(SCROLL_LOCK_ATTR);

      const probe = new ScrollLocker();

      probe.lock();
      expect(document.body).toHaveAttribute(SCROLL_LOCK_ATTR, 'true');
      probe.unlock();
      expect(document.body).not.toHaveAttribute(SCROLL_LOCK_ATTR);
    });

    it('destroy() on a menu that was never opened does not affect the lock', () => {
      const block = createBlock(':fi');

      document.body.appendChild(block.holder);

      const trigger = new EmojiTrigger(createBlokModules(block));

      expect(() => trigger.destroy()).not.toThrow();
      expect(document.body).not.toHaveAttribute(SCROLL_LOCK_ATTR);
    });
  });
});
