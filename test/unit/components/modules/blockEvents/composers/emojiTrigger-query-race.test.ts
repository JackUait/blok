// test/unit/components/modules/blockEvents/composers/emojiTrigger-query-race.test.ts
//
// Reproduces a user-reported bug: typing a multi-character query fast can
// leave the picker showing a stale, wrong filter instead of the last-typed
// query. Uses the REAL EmojiPicker (not the mock emojiTrigger.test.ts uses)
// because the bug is about what actually renders in the DOM.
//
// A uniform delay for every overlapping dataset load (all keystrokes' loads
// resolving at the same moment) does NOT reproduce this: renderMenu's
// `await picker.open()` is always immediately followed, synchronously, by
// that same call's own `setQuery()` — so under symmetric timing the calls
// happen to settle in issue order and the last one still wins by luck. Real
// async work has no such guarantee (network/scheduler jitter routinely
// resolves an earlier-issued request after a later one), so this test gives
// the FIRST keystroke's dataset load a long delay and the later ones a
// short one — an entirely ordinary timing pattern, not a contrived one.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmojiTrigger } from '../../../../../../src/components/modules/blockEvents/composers/emojiTrigger';
import type { ProcessedEmoji } from '../../../../../../src/components/utils/emoji/emoji-data';
import type * as EmojiDataModule from '../../../../../../src/components/utils/emoji/emoji-data';
import { createBlock, createBlokModules, setCaret } from './emojiTrigger.fixture';

/**
 * "heart" matches every progressive query below ("l", "lo", "lov", "love")
 * — "love" is one of its keywords, a prefix of it for every truncation.
 * "lion" matches only "l" (its id starts with "l") and nothing longer, so
 * it is the tell: if the FIRST keystroke's stale "l" query ends up applied
 * last, "lion" reappears in the grid alongside "heart".
 */
const FIXTURE_EMOJIS: ProcessedEmoji[] = [
  { native: '❤️', skins: ['❤️'], id: 'heart', name: 'Red Heart', keywords: ['love'], category: 'symbols' },
  { native: '🦁', skins: ['🦁'], id: 'lion', name: 'Lion Face', keywords: ['animal'], category: 'nature' },
];

// The Nth call to the mocked loadEmojiData() resolves after DELAYS_MS[N]
// (0 once the array is exhausted). Index 0 is always the composer's
// fire-and-forget prefetch warm-up (see EmojiTrigger.handleInput's
// hasPrefetched call), not any keystroke's own await — index 1 is the
// first keystroke's own `await loadEmojiData()`. Modeling that first
// keystroke's dataset load as the slow one, resolving after the later
// keystrokes', since nothing in real async scheduling guarantees issue
// order survives.
const DELAYS_MS = [0, 50, 0, 0];
let callIndex = 0;

vi.mock('../../../../../../src/components/utils/emoji/emoji-data', async (importOriginal) => {
  const actual = await importOriginal<typeof EmojiDataModule>();

  return {
    ...actual,
    loadEmojiData: vi.fn(() => new Promise<ProcessedEmoji[]>((resolve) => {
      const delay = DELAYS_MS[callIndex] ?? 0;

      callIndex += 1;
      setTimeout(() => resolve(FIXTURE_EMOJIS), delay);
    })),
  };
});

describe('EmojiTrigger — overlapping keystrokes whose dataset loads resolve out of order', () => {
  beforeEach(() => {
    callIndex = 0;

    // resolveTheme() (real EmojiPicker) calls matchMedia — jsdom lacks it.
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('renders the last-typed query filtered, not a stale earlier one', async () => {
    const block = createBlock(':');

    document.body.appendChild(block.holder);

    const trigger = new EmojiTrigger(createBlokModules(block));
    const input = block.currentInput;

    if (input === undefined) {
      throw new Error('block has no currentInput');
    }

    // Simulate typing ":l", ":lo", ":lov", ":love" back-to-back, each
    // keystroke firing before any of the previous handleInput calls have
    // resolved — every one of these starts its own dataset load.
    const pending = ['l', 'lo', 'lov', 'love'].map((query) => {
      input.textContent = `:${query}`;
      setCaret(block, query.length + 1);

      return trigger.handleInput({
        inputType: 'insertText',
        data: query.at(-1),
        isComposing: false,
      } as InputEvent);
    });

    await Promise.all(pending);

    const pickerElement = document.querySelector('[data-blok-testid="emoji-menu"]');

    if (pickerElement === null) {
      throw new Error('picker element never rendered');
    }

    const natives = Array.from(pickerElement.querySelectorAll('[data-emoji-native]'))
      .map((btn) => btn.getAttribute('data-emoji-native'));

    // Filtered to "love": only the heart. Not [🦁, ❤️] — the stale "l" filter.
    expect(natives).toEqual(['❤️']);

    trigger.close();
  });
});
