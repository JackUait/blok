// test/unit/components/modules/blockEvents/composers/emojiTrigger-grid-highlight-real-picker.test.ts
//
// Regression coverage for a defect the mocked emojiTrigger.test.ts fixtures
// cannot see: the picker renders filtered results GROUPED BY CATEGORY, which
// reorders them relative to the flat ranked order whenever categories
// interleave across rank tiers. getHighlightedEmoji() must report whatever
// emoji is actually highlighted on screen, not `currentResults[index]` —
// those two orders diverge for a query like "fi" (real dataset: ranked
// order starts 🇫🇮 ✊ 🧑‍🚒 🐟, rendered order starts 🇫🇮 🏁 🇫🇯 ✊ — index 1
// already differs).
//
// Uses the REAL EmojiPicker and the REAL @emoji-mart/data package — not
// mocked — because the bug is specifically about what the rendered DOM
// shows for real, category-grouped data; a small hand-built fixture (tried
// first) never diverged the same way, and mocking @emoji-mart/data behind
// the real EmojiPicker's full dependency graph did not reliably intercept
// in this file regardless. The assertion itself never hardcodes which
// emoji lands where — only that the reported native matches the one the
// combobox host's aria-activedescendant actually points at — so it stays
// correct even if the dataset changes.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmojiTrigger } from '../../../../../../src/components/modules/blockEvents/composers/emojiTrigger';
import { createBlock, createBlokModules, setCaret } from './emojiTrigger.fixture';

describe('EmojiTrigger — highlighted emoji matches the rendered grid, not the ranked order', () => {
  beforeEach(() => {
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

  it('reports the emoji aria-activedescendant actually points at, after moving the highlight into a category-reordered position', async () => {
    const block = createBlock(':fi');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput({ inputType: 'insertText', data: 'i', isComposing: false } as InputEvent);

    trigger.handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }));

    const activeId = block.currentInput?.getAttribute('aria-activedescendant');

    if (activeId === null || activeId === undefined) {
      throw new Error('combobox host has no aria-activedescendant after ArrowRight');
    }

    const selectedButton = document.getElementById(activeId);

    if (selectedButton === null) {
      throw new Error(`no button found for aria-activedescendant="${activeId}"`);
    }

    const renderedNative = selectedButton.getAttribute('data-emoji-native');
    const reportedNative = trigger.getHighlightedEmoji()?.native ?? null;

    expect(reportedNative).toBe(renderedNative);

    trigger.close();
  });
});
