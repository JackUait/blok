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
});
