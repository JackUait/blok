// test/unit/components/modules/blockEvents/composers/emojiTrigger-closing-colon-race.test.ts
//
// Regression: EmojiPicker.open() makes its element visible synchronously,
// before its own promise settles, while EmojiTrigger only flips
// `opened = true` once its OWN async chain (pendingOpen + the render-token
// freshness check) resolves. `renderToken` is now bumped for EVERY
// keystroke, including ones that never reach renderMenu at all — the
// closing colon goes through commitOnClosingColon instead. If that keystroke
// arrives while an earlier open() is still in flight, it invalidates that
// in-flight renderMenu call's token check once it finally settles:
// renderMenu returns quietly without ever setting `opened = true`. If
// close() only runs its body when `opened` is already true, nothing ever
// hides the already-visible element or releases the page scroll lock it
// holds (see ScrollLocker, wired into renderMenu/close()) — a ghost picker
// on a page the user can no longer scroll.
//
// Reproduces the exact usage the closing-colon feature invites: typing a
// whole shortcode fast enough that the closing colon lands before the first
// EmojiPicker.open() resolves — realistic on first use, when the picker's
// own async work is a real delay. Uses a mocked EmojiPicker (not the real
// one) specifically so this test can hold open() pending and observe
// close()/the scroll-lock attribute directly and deterministically, rather
// than guessing at the real component's internal timing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmojiTrigger } from '../../../../../../src/components/modules/blockEvents/composers/emojiTrigger';
import { createBlock, createBlokModules, setCaret } from './emojiTrigger.fixture';

const MOCK_EMOJI_MART_DATA = {
  default: {
    categories: [{ id: 'nature', emojis: ['fire'] }],
    emojis: {
      fire: { id: 'fire', name: 'Fire', keywords: ['hot', 'flame'], skins: [{ native: '🔥', unified: '1f525' }], version: 1 },
    },
    aliases: {},
  },
};

vi.mock('@emoji-mart/data', () => MOCK_EMOJI_MART_DATA);

interface MockEmojiPickerOptions {
  onSelect: (native: string) => void;
  onRemove: () => void;
}

// Mirrors the real EmojiPicker's documented behaviour: open() flips
// visibility synchronously, before its returned promise settles; close()
// flips it back.
let pickerHidden = true;
let resolveOpen: (() => void) | null = null;

const mockPickerOpen = vi.fn<() => Promise<void>>().mockImplementation(() => {
  pickerHidden = false;

  return new Promise<void>((resolve) => {
    resolveOpen = resolve;
  });
});
const mockPickerClose = vi.fn<() => void>().mockImplementation(() => {
  pickerHidden = true;
});
const mockPickerSetQuery = vi.fn<(query: string) => void>();
const mockPickerElement = document.createElement('div');

vi.mock('../../../../../../src/tools/callout/emoji-picker', () => ({
  prefetchEmojiPickerData: vi.fn(),
  EmojiPicker: vi.fn(function emojiPickerMock(_options: MockEmojiPickerOptions) {
    return {
      open: mockPickerOpen,
      setQuery: mockPickerSetQuery,
      close: mockPickerClose,
      getElement: () => mockPickerElement,
      isOpen: () => !pickerHidden,
    };
  }),
}));

const SCROLL_LOCK_ATTR = 'data-blok-scroll-locked';

describe('EmojiTrigger — ghost picker when the closing colon bypasses an in-flight open()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pickerHidden = true;
    resolveOpen = null;
    document.body.removeAttribute(SCROLL_LOCK_ATTR);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.body.removeAttribute(SCROLL_LOCK_ATTR);
    vi.restoreAllMocks();
  });

  it('closes the picker and releases the scroll lock when the closing colon commits before the in-flight open() resolves', async () => {
    const block = createBlock(':f');

    document.body.appendChild(block.holder);
    setCaret(block, 2);

    const trigger = new EmojiTrigger(createBlokModules(block));

    // Opens a fresh trigger for ":f" — starts the (mocked) picker.open(),
    // held pending via `resolveOpen` to simulate the real picker's own async
    // work not having finished yet.
    const openingCall = trigger.handleInput({ inputType: 'insertText', data: 'f', isComposing: false } as InputEvent);

    await vi.waitFor(() => {
      expect(mockPickerOpen).toHaveBeenCalled();
    }, { timeout: 10000 });

    // The picker is already visible and the page already locked (real
    // behaviour), even though the composer's own `opened` flag has not
    // flipped true yet — its await is still pending.
    expect(pickerHidden).toBe(false);
    expect(trigger.opened).toBe(false);

    // The closing colon arrives WHILE that open() is still in flight — it
    // never calls renderMenu at all, going through commitOnClosingColon
    // instead. "f" matches nothing exactly in this fixture, so it should
    // just close the menu.
    const input = block.currentInput;

    if (input !== null && input !== undefined) {
      input.textContent = ':f:';
    }
    setCaret(block, 3);
    await trigger.handleInput({ inputType: 'insertText', data: ':', isComposing: false } as InputEvent);

    // Now let the original, now-superseded open() resolve.
    resolveOpen?.();
    await openingCall;

    expect(trigger.opened).toBe(false);
    // The regression: without a fix, close() no-ops while `opened` is still
    // false, so the already-visible mocked picker — and the page scroll
    // lock it holds — stay stuck forever. These are the assertions that
    // fail on the unfixed code.
    expect(mockPickerClose).toHaveBeenCalled();
    expect(pickerHidden).toBe(true);
    expect(document.body).not.toHaveAttribute(SCROLL_LOCK_ATTR);
  });

  it('closes the picker and releases the scroll lock when a span-breaking character arrives mid-open (not just the closing colon)', async () => {
    // Same class of bug, different trigger: a space breaks the span and
    // takes the synchronous `span === null -> this.close()` path, which
    // also bumps the render token (it runs after the token claim) without
    // ever going through renderMenu.
    const block = createBlock(':f');

    document.body.appendChild(block.holder);
    setCaret(block, 2);

    const trigger = new EmojiTrigger(createBlokModules(block));

    const openingCall = trigger.handleInput({ inputType: 'insertText', data: 'f', isComposing: false } as InputEvent);

    await vi.waitFor(() => {
      expect(mockPickerOpen).toHaveBeenCalled();
    }, { timeout: 10000 });

    expect(pickerHidden).toBe(false);

    const input = block.currentInput;

    if (input !== null && input !== undefined) {
      input.textContent = ':f ';
    }
    setCaret(block, 3);
    await trigger.handleInput({ inputType: 'insertText', data: ' ', isComposing: false } as InputEvent);

    resolveOpen?.();
    await openingCall;

    expect(trigger.opened).toBe(false);
    expect(mockPickerClose).toHaveBeenCalled();
    expect(pickerHidden).toBe(true);
    expect(document.body).not.toHaveAttribute(SCROLL_LOCK_ATTR);
  });
});
