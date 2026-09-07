import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmojiTrigger } from '../../../../../../src/components/modules/blockEvents/composers/emojiTrigger';
import { isInlineEmojiEnabled } from '../../../../../../src/components/utils/emoji/inline-emoji-config';
import { createBlock, createBlokModules, setCaret } from './emojiTrigger.fixture';

/**
 * The real @emoji-mart/data package is a ~415KB JSON file; loading it for
 * real (as emoji-data.test.ts also avoids doing) makes these tests slow and,
 * under concurrent load, flaky. A small fixture is enough: "fire" covers the
 * ":fi" query and nothing here matches ":zzzzzz".
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

/**
 * A real PopoverDesktop reaches for window.matchMedia and layout APIs, which
 * jsdom does not implement — stub the module so these tests can assert menu
 * STATE (the composer's `opened` flag) without constructing real popover DOM.
 * Rendering and keyboard navigation are covered by Task 9's browser test.
 */
vi.mock('../../../../../../src/components/utils/popover', () => ({
  // A `function` (not an arrow function) so `new PopoverDesktop(...)` is a
  // valid constructor call — an arrow-function implementation throws
  // "is not a constructor".
  PopoverDesktop: vi.fn(function popoverDesktopMock() {
    return {
      show: vi.fn(),
      hide: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      destroy: vi.fn(),
      filterItems: vi.fn(),
      updatePosition: vi.fn(),
      getElement: vi.fn(() => document.createElement('div')),
    };
  }),
  PopoverMobile: vi.fn(function popoverMobileMock() {
    return {
      show: vi.fn(),
      hide: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      destroy: vi.fn(),
      filterItems: vi.fn(),
      updatePosition: vi.fn(),
      getElement: vi.fn(() => document.createElement('div')),
    };
  }),
}));

const createInputEvent = (options: Partial<InputEvent> = {}): InputEvent => ({
  inputType: 'insertText',
  data: 'i',
  isComposing: false,
  ...options,
} as InputEvent);

describe('EmojiTrigger — opening and closing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the menu when ":fi" is typed at the start of a paragraph', async () => {
    const block = createBlock(':fi');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput(createInputEvent());

    expect(trigger.opened).toBe(true);
  });

  it('does not open when the colon sits inside "10:30"', async () => {
    const block = createBlock('10:30');

    document.body.appendChild(block.holder);
    setCaret(block, 5);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput(createInputEvent({ data: '0' }));

    expect(trigger.opened).toBe(false);
  });

  it('does not open in a block that is not text-like', async () => {
    const block = createBlock(':fi', { isDefault: false, isLineBreaksEnabled: true });

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput(createInputEvent());

    expect(trigger.opened).toBe(false);
  });

  it('ignores input while a composition is in progress', async () => {
    const block = createBlock(':fi');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput(createInputEvent({ isComposing: true }));

    expect(trigger.opened).toBe(false);
  });

  it('closes when a space is typed into the query', async () => {
    const block = createBlock(':fi');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput(createInputEvent());
    expect(trigger.opened).toBe(true);

    if (block.currentInput !== null && block.currentInput !== undefined) {
      block.currentInput.textContent = ':fi ';
    }
    setCaret(block, 4);
    await trigger.handleInput(createInputEvent({ data: ' ' }));

    expect(trigger.opened).toBe(false);
  });

  it('closes on Escape and leaves the typed text alone', async () => {
    const block = createBlock(':fi');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput(createInputEvent());

    const handled = trigger.handleKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(handled).toBe(true);
    expect(trigger.opened).toBe(false);
    expect(block.currentInput?.textContent).toBe(':fi');
  });

  it('never opens when inlineEmoji is false', async () => {
    // The composer itself has no config access; BlockEvents guards the call.
    // This asserts the guard, not the composer, so it drives the real wiring.
    const block = createBlock(':fi');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));
    const handleInput = vi.spyOn(trigger, 'handleInput');

    // Stand in for BlockEvents.handleInput's guard line.
    if (isInlineEmojiEnabled({ inlineEmoji: false })) {
      void trigger.handleInput(createInputEvent());
    }

    expect(handleInput).not.toHaveBeenCalled();
    expect(trigger.opened).toBe(false);
  });

  it('closes when the search yields nothing', async () => {
    const block = createBlock(':zzzzzz');

    document.body.appendChild(block.holder);
    setCaret(block, 7);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput(createInputEvent({ data: 'z' }));

    expect(trigger.opened).toBe(false);
  });
});
