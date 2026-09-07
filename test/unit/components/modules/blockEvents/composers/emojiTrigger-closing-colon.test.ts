// test/unit/components/modules/blockEvents/composers/emojiTrigger-closing-colon.test.ts
//
// Typing the CLOSING colon commits immediately when the query is an exact
// shortcode match — ":fire:" becomes "🔥" without ever touching the menu.
// A closing colon after a non-exact query just closes the menu and leaves
// the literal text alone.
//
// Runs against the REAL @emoji-mart/data dataset (not mocked): an
// exact-shortcode assertion is only meaningful against the real ids, and a
// hand-built fixture would let the test assert whatever was assumed about
// them instead of what the dataset actually contains.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmojiTrigger } from '../../../../../../src/components/modules/blockEvents/composers/emojiTrigger';
import { createBlock, createBlokModules, setCaret } from './emojiTrigger.fixture';

const typeClosingColon = async (trigger: EmojiTrigger, block: ReturnType<typeof createBlock>, text: string): Promise<void> => {
  const input = block.currentInput;

  if (input !== null && input !== undefined) {
    input.textContent = text;
  }
  setCaret(block, text.length);
  await trigger.handleInput({ inputType: 'insertText', data: ':', isComposing: false } as InputEvent);
};

describe('EmojiTrigger — closing colon', () => {
  beforeEach(() => {
    vi.clearAllMocks();

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

  it('inserts on the closing colon when the query is an exact shortcode', async () => {
    const block = createBlock(':fire');

    document.body.appendChild(block.holder);
    setCaret(block, 5);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput({ inputType: 'insertText', data: 'e', isComposing: false } as InputEvent);
    await typeClosingColon(trigger, block, ':fire:');

    expect(block.currentInput?.textContent).toBe('🔥');
    expect(trigger.opened).toBe(false);
  });

  it('matches a keyword shortcode such as ":thumbsup:"', async () => {
    const block = createBlock(':thumbsup');

    document.body.appendChild(block.holder);
    setCaret(block, 9);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput({ inputType: 'insertText', data: 'p', isComposing: false } as InputEvent);
    await typeClosingColon(trigger, block, ':thumbsup:');

    expect(block.currentInput?.textContent).toBe('👍');
  });

  it('only closes the menu when the closing colon follows a non-exact query', async () => {
    const block = createBlock(':fir');

    document.body.appendChild(block.holder);
    setCaret(block, 4);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput({ inputType: 'insertText', data: 'r', isComposing: false } as InputEvent);
    await typeClosingColon(trigger, block, ':fir:');

    expect(block.currentInput?.textContent).toBe(':fir:');
    expect(trigger.opened).toBe(false);
  });

  it('treats a colon typed with no menu open as a plain character', async () => {
    const block = createBlock('hello');

    document.body.appendChild(block.holder);

    const trigger = new EmojiTrigger(createBlokModules(block));

    if (block.currentInput !== null && block.currentInput !== undefined) {
      block.currentInput.textContent = 'hello:';
    }
    setCaret(block, 6);

    await trigger.handleInput({ inputType: 'insertText', data: ':', isComposing: false } as InputEvent);

    expect(block.currentInput?.textContent).toBe('hello:');
    expect(trigger.opened).toBe(false);
  });

  // Regression for the uniqueness rule in commitOnClosingColon: mutating
  // `keywordMatches.length === 1` to `>= 1` would still pass every other
  // test in this file (":fire:" never reaches the keyword branch — the id
  // match wins first; ":thumbsup:" has exactly one keyword match either
  // way; ":fir:" has zero either way). "happy" is a real, non-hypothetical
  // case the rule exists for: no emoji's id is "happy", but 13 different
  // emoji (grinning, smiley, smile, grin, laughing, sweat_smile, joy, wink,
  // blush, yum, smiley_cat, joy_cat, rainbow) carry it as an exact keyword.
  it('closes without inserting for ":happy:" — thirteen emoji share it as an exact keyword, none as an id', async () => {
    const block = createBlock(':happy');

    document.body.appendChild(block.holder);
    setCaret(block, 6);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput({ inputType: 'insertText', data: 'y', isComposing: false } as InputEvent);
    await typeClosingColon(trigger, block, ':happy:');

    expect(block.currentInput?.textContent).toBe(':happy:');
    expect(trigger.opened).toBe(false);
  });

  it('suppresses the shortcut for a span the user just dismissed with Escape', async () => {
    const block = createBlock(':fire');

    document.body.appendChild(block.holder);
    setCaret(block, 5);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput({ inputType: 'insertText', data: 'e', isComposing: false } as InputEvent);
    expect(trigger.opened).toBe(true);

    const escaped = trigger.handleKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(escaped).toBe(true);
    expect(trigger.opened).toBe(false);

    // The user just refused this suggestion — the closing colon must not
    // silently insert the emoji they dismissed.
    await typeClosingColon(trigger, block, ':fire:');

    expect(block.currentInput?.textContent).toBe(':fire:');
    expect(trigger.opened).toBe(false);
  });

  it('does not suppress a genuinely new span opened after an earlier Escape dismissal', async () => {
    const block = createBlock(':fire');

    document.body.appendChild(block.holder);
    setCaret(block, 5);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput({ inputType: 'insertText', data: 'e', isComposing: false } as InputEvent);
    trigger.handleKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));

    // A different trigger, at a different position — not the one dismissed.
    const input = block.currentInput;

    if (input !== null && input !== undefined) {
      input.textContent = ':fire :thumbsup';
    }
    setCaret(block, ':fire :thumbsup'.length);
    await trigger.handleInput({ inputType: 'insertText', data: 'p', isComposing: false } as InputEvent);
    await typeClosingColon(trigger, block, ':fire :thumbsup:');

    expect(block.currentInput?.textContent).toBe(':fire 👍');
  });

  // Three acceptance criteria a bare offset cannot satisfy at once (a
  // dismissal keyed only by `span.start` — no block identity, no liveness
  // check — either leaks across blocks or survives a full delete-and-retype,
  // since offset 0 is the commonest span position there is):
  //   1. the dismissal must persist while the SAME span keeps being edited
  //   2. it must not apply in a DIFFERENT block, even at the same offset
  //   3. it must not apply to a genuinely NEW span at the same offset after
  //      the dismissed one was fully deleted
  describe('Escape dismissal — three acceptance criteria a bare offset cannot satisfy', () => {
    it('criterion 1: persists across further edits to the SAME span (colon never removed)', async () => {
      const block = createBlock(':fire');

      document.body.appendChild(block.holder);
      setCaret(block, 5);

      const trigger = new EmojiTrigger(createBlokModules(block));

      await trigger.handleInput({ inputType: 'insertText', data: 'e', isComposing: false } as InputEvent);
      trigger.handleKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));

      // Backspace the trailing "e" and retype it — edits the span's query
      // WITHOUT ever removing the leading ":", so this is still the same
      // dismissed span, not a new one.
      const input = block.currentInput;

      if (input !== null && input !== undefined) {
        input.textContent = ':fir';
      }
      setCaret(block, 4);
      await trigger.handleInput({ inputType: 'deleteContentBackward', data: null } as InputEvent);

      if (input !== null && input !== undefined) {
        input.textContent = ':fire';
      }
      setCaret(block, 5);
      await trigger.handleInput({ inputType: 'insertText', data: 'e', isComposing: false } as InputEvent);

      await typeClosingColon(trigger, block, ':fire:');

      expect(block.currentInput?.textContent).toBe(':fire:');
      expect(trigger.opened).toBe(false);
    });

    it('criterion 2: does not apply in a different block, even at the same span offset', async () => {
      const blockA = createBlock(':fire', {}, 'block-a');
      const blockB = createBlock(':joy', {}, 'block-b');

      document.body.appendChild(blockA.holder);
      document.body.appendChild(blockB.holder);
      setCaret(blockA, 5);

      const modules = createBlokModules(blockA);
      const trigger = new EmojiTrigger(modules);

      await trigger.handleInput({ inputType: 'insertText', data: 'e', isComposing: false } as InputEvent);
      trigger.handleKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));

      // Switch to a DIFFERENT block whose own trigger happens to start at
      // the SAME offset (0) as the one just dismissed in blockA.
      modules.BlockManager.currentBlock = blockB;
      setCaret(blockB, 4);
      await trigger.handleInput({ inputType: 'insertText', data: 'y', isComposing: false } as InputEvent);
      await typeClosingColon(trigger, blockB, ':joy:');

      expect(blockB.currentInput?.textContent).toBe('😂');
    });

    it('criterion 3: does not apply to a genuinely new span at the same offset after the dismissed one was fully deleted', async () => {
      const block = createBlock(':fire');

      document.body.appendChild(block.holder);
      setCaret(block, 5);

      const trigger = new EmojiTrigger(createBlokModules(block));

      await trigger.handleInput({ inputType: 'insertText', data: 'e', isComposing: false } as InputEvent);
      trigger.handleKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));

      // Delete EVERYTHING, including the dismissed trigger's own ":" — the
      // physical colon that was dismissed is gone, so this is not
      // "continuing the same span". Left with a single non-colon character
      // rather than a truly empty node — the test fixture's setCaret needs
      // an actual text node to place the caret in, and a real contentEditable
      // backspaced down to nothing behaves the same way for this check
      // (offset 0 is simply no longer ":").
      const input = block.currentInput;

      if (input !== null && input !== undefined) {
        input.textContent = 'x';
      }
      setCaret(block, 0);
      await trigger.handleInput({ inputType: 'deleteContentBackward', data: null } as InputEvent);

      // Retype a brand new trigger from scratch, landing at the same
      // offset (0) as the dismissed one.
      if (input !== null && input !== undefined) {
        input.textContent = ':joy';
      }
      setCaret(block, 4);
      await trigger.handleInput({ inputType: 'insertText', data: 'y', isComposing: false } as InputEvent);
      await typeClosingColon(trigger, block, ':joy:');

      expect(block.currentInput?.textContent).toBe('😂');
    });
  });
});
