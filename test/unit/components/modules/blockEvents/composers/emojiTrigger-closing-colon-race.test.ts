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
// A second file covers the INVERSE ghost that fixing the first one
// introduced: close() now hides the element on paths that used to no-op,
// but it never touched `pendingOpen`. Reopening the same span before a
// stale `pendingOpen` resolves used to reuse that stale promise (the whole
// point of `pendingOpen ??= ...` is to dedupe concurrent opens) instead of
// issuing a fresh open() — so nothing ever re-showed the element, yet the
// later renderMenu call still passed its token check and set
// `opened = true` and locked the scroll. An invisible menu that believes
// it's open, on a page the user can't scroll.
//
// Reproduces the exact usage the closing-colon feature invites: typing a
// whole shortcode fast enough that keystrokes land before EmojiPicker.open()
// resolves — realistic on first use, when the picker's own async work is a
// real delay. Uses a mocked EmojiPicker (not the real one) specifically so
// this test can hold open() pending and observe close()/the scroll-lock
// attribute directly and deterministically, rather than guessing at the
// real component's internal timing.

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
// flips it back. Each open() call gets its OWN resolver (pushed onto
// `pendingOpens`) so a test can control several overlapping opens
// independently — resolving them in whatever order it needs to.
let pickerHidden = true;
const pendingOpens: Array<() => void> = [];

const mockPickerOpen = vi.fn<() => Promise<void>>().mockImplementation(() => {
  pickerHidden = false;

  return new Promise<void>((resolve) => {
    pendingOpens.push(resolve);
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

/**
 * The invariant that would have caught both ghosts at once: whenever
 * `opened` is true the element must be visible AND the page must be locked;
 * whenever it's false the element must be hidden AND the lock released.
 * Checked as one bidirectional assertion rather than the individual fields
 * a fix could satisfy by accident on only one side.
 */
function assertOpenedInvariant(trigger: EmojiTrigger): void {
  expect(pickerHidden).toBe(!trigger.opened);
  expect(document.body.hasAttribute(SCROLL_LOCK_ATTR)).toBe(trigger.opened);
}

describe('EmojiTrigger — ghost picker when the closing colon bypasses an in-flight open()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pickerHidden = true;
    pendingOpens.length = 0;
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
    // held pending to simulate the real picker's own async work not having
    // finished yet.
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
    pendingOpens[0]?.();
    await openingCall;

    expect(trigger.opened).toBe(false);
    expect(mockPickerClose).toHaveBeenCalled();
    assertOpenedInvariant(trigger);
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

    pendingOpens[0]?.();
    await openingCall;

    expect(trigger.opened).toBe(false);
    expect(mockPickerClose).toHaveBeenCalled();
    assertOpenedInvariant(trigger);
  });

  it('issues a fresh open() — not a reuse of the stale pending one — when the same span reopens before the original open() resolves, ending visible with `opened` true', async () => {
    const block = createBlock(':f');

    document.body.appendChild(block.holder);
    setCaret(block, 2);

    const trigger = new EmojiTrigger(createBlokModules(block));

    // First open goes in flight, held pending.
    const firstOpeningCall = trigger.handleInput({ inputType: 'insertText', data: 'f', isComposing: false } as InputEvent);

    await vi.waitFor(() => {
      expect(mockPickerOpen).toHaveBeenCalledTimes(1);
    }, { timeout: 10000 });

    expect(pickerHidden).toBe(false);

    // A space breaks the span — close() runs and hides the element, while
    // the FIRST open() promise is still unresolved.
    const input = block.currentInput;

    if (input !== null && input !== undefined) {
      input.textContent = ':f ';
    }
    setCaret(block, 3);
    await trigger.handleInput({ inputType: 'insertText', data: ' ', isComposing: false } as InputEvent);

    expect(pickerHidden).toBe(true);
    expect(trigger.opened).toBe(false);

    // Reopen the SAME span position before the original open() resolves —
    // this is the case that used to reuse the stale pending promise via
    // `pendingOpen ??= ...` instead of issuing a fresh open().
    if (input !== null && input !== undefined) {
      input.textContent = ':f';
    }
    setCaret(block, 2);
    const secondOpeningCall = trigger.handleInput({ inputType: 'insertText', data: 'f', isComposing: false } as InputEvent);

    await vi.waitFor(() => {
      expect(mockPickerOpen).toHaveBeenCalledTimes(2);
    }, { timeout: 10000 });

    // A genuinely fresh open() was issued, so the element is visible again
    // already — this is the assertion that fails without the fix (only one
    // open() call total, the stale promise reused instead).
    expect(pickerHidden).toBe(false);

    // Resolve the orphaned first open(), then the real second one.
    pendingOpens[0]?.();
    await firstOpeningCall;

    pendingOpens[1]?.();
    await secondOpeningCall;

    expect(trigger.opened).toBe(true);
    assertOpenedInvariant(trigger);
  });
});
