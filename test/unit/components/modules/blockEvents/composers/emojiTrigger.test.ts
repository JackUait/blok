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

interface MockEmojiPickerOptions {
  onSelect: (native: string) => void;
  onRemove: () => void;
  i18n: { t: (key: string) => string };
  locale: string;
  inline?: boolean;
}

/** Stable across the whole file so tests can inspect what the composer set on it. */
const mockPickerElement = document.createElement('div');
const mockPickerConstructor = vi.fn<(options: MockEmojiPickerOptions) => void>();
const mockPickerOpen = vi.fn<(anchor: HTMLElement, anchorRect?: DOMRect) => Promise<void>>().mockResolvedValue(undefined);
const mockPickerSetQuery = vi.fn<(query: string) => void>();
const mockPickerClose = vi.fn<() => void>();

/**
 * A real EmojiPicker reaches for window.matchMedia and layout APIs, which
 * jsdom does not implement — stub the module so these tests can assert menu
 * STATE (the composer's `opened` flag) and what it tells the picker to do,
 * without constructing real picker DOM. Rendering, keyboard navigation and
 * the picker's own inline-mode behaviour are covered by its own suite
 * (test/unit/tools/callout/emoji-picker/) and Task 9's browser test.
 */
vi.mock('../../../../../../src/tools/callout/emoji-picker', () => ({
  prefetchEmojiPickerData: vi.fn(),
  // A `function` (not an arrow function) so `new EmojiPicker(...)` is a
  // valid constructor call — an arrow-function implementation throws
  // "is not a constructor".
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

const createInputEvent = (options: Partial<InputEvent> = {}): InputEvent => ({
  inputType: 'insertText',
  data: 'i',
  isComposing: false,
  ...options,
} as InputEvent);

describe('EmojiTrigger — opening and closing', () => {
  // Tracks the trigger each test creates so afterEach can close it: an open
  // menu registers a real `document` selectionchange listener (see
  // handleSelectionChange), and a test that ends without closing would leak
  // it onto every later test's document.
  let currentTrigger: EmojiTrigger | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    currentTrigger?.close();
    currentTrigger = undefined;
    vi.restoreAllMocks();
  });

  it('opens the menu when ":fi" is typed at the start of a paragraph', async () => {
    const block = createBlock(':fi');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    currentTrigger = trigger;

    await trigger.handleInput(createInputEvent());

    expect(trigger.opened).toBe(true);
  });

  it('does not open when the colon sits inside "10:30"', async () => {
    const block = createBlock('10:30');

    document.body.appendChild(block.holder);
    setCaret(block, 5);

    const trigger = new EmojiTrigger(createBlokModules(block));

    currentTrigger = trigger;

    await trigger.handleInput(createInputEvent({ data: '0' }));

    expect(trigger.opened).toBe(false);
  });

  it('does not open in a block that is not text-like', async () => {
    const block = createBlock(':fi', { isDefault: false, isLineBreaksEnabled: true });

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    currentTrigger = trigger;

    await trigger.handleInput(createInputEvent());

    expect(trigger.opened).toBe(false);
  });

  it('ignores input while a composition is in progress', async () => {
    const block = createBlock(':fi');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    currentTrigger = trigger;

    await trigger.handleInput(createInputEvent({ isComposing: true }));

    expect(trigger.opened).toBe(false);
  });

  it('closes when a space is typed into the query', async () => {
    const block = createBlock(':fi');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    currentTrigger = trigger;

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

    currentTrigger = trigger;

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

    currentTrigger = trigger;

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

    currentTrigger = trigger;

    await trigger.handleInput(createInputEvent({ data: 'z' }));

    expect(trigger.opened).toBe(false);
  });

  it('closes when the caret leaves the span without a text mutation', async () => {
    // A second word later in the block gives the caret somewhere to move to
    // that is unambiguously outside the ":fi" span.
    const block = createBlock(':fi elsewhere');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    currentTrigger = trigger;

    await trigger.handleInput(createInputEvent());
    expect(trigger.opened).toBe(true);

    // Arrow/click caret movement fires no input event, so nothing but a
    // selectionchange listener can catch this — setCaret alone does not
    // notify EmojiTrigger; dispatch the same event a real caret move fires.
    setCaret(block, 10);
    document.dispatchEvent(new Event('selectionchange'));

    expect(trigger.opened).toBe(false);
  });
});

describe('EmojiTrigger — rendering the real picker', () => {
  let currentTrigger: EmojiTrigger | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPickerOpen.mockResolvedValue(undefined);
  });

  afterEach(() => {
    currentTrigger?.close();
    currentTrigger = undefined;
    vi.restoreAllMocks();
  });

  it('constructs the picker in inline mode, tagged for the browser test and the combobox aria-controls', async () => {
    const block = createBlock(':fi');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    currentTrigger = trigger;

    await trigger.handleInput(createInputEvent());

    expect(mockPickerConstructor).toHaveBeenCalledTimes(1);
    expect(mockPickerConstructor.mock.calls[0]?.[0]?.inline).toBe(true);
    expect(mockPickerElement.getAttribute('data-blok-testid')).toBe('emoji-menu');
    expect(mockPickerElement.id).toBe('blok-emoji-menu');
  });

  it('opens the picker anchored on the block input, passing the caret rect', async () => {
    const block = createBlock(':fi');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    currentTrigger = trigger;

    await trigger.handleInput(createInputEvent());

    expect(mockPickerOpen).toHaveBeenCalledTimes(1);
    const [anchorArg, rectArg] = mockPickerOpen.mock.calls[0] ?? [];

    expect(anchorArg).toBe(block.currentInput);
    expect(rectArg).toBeDefined();
  });

  it('mirrors each keystroke\'s query into the picker via setQuery', async () => {
    const block = createBlock(':fi');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    currentTrigger = trigger;

    await trigger.handleInput(createInputEvent());

    expect(mockPickerSetQuery).toHaveBeenLastCalledWith('fi');

    if (block.currentInput !== null && block.currentInput !== undefined) {
      block.currentInput.textContent = ':fir';
    }
    setCaret(block, 4);
    await trigger.handleInput(createInputEvent({ data: 'r' }));

    expect(mockPickerSetQuery).toHaveBeenLastCalledWith('fir');
  });

  it('does not reopen the picker for a second keystroke inside the same span', async () => {
    const block = createBlock(':fi');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    currentTrigger = trigger;

    await trigger.handleInput(createInputEvent());

    if (block.currentInput !== null && block.currentInput !== undefined) {
      block.currentInput.textContent = ':fir';
    }
    setCaret(block, 4);
    await trigger.handleInput(createInputEvent({ data: 'r' }));

    expect(mockPickerOpen).toHaveBeenCalledTimes(1);
  });

  it('closes the picker when the trigger closes', async () => {
    const block = createBlock(':fi');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    currentTrigger = trigger;

    await trigger.handleInput(createInputEvent());
    trigger.close();

    expect(mockPickerClose).toHaveBeenCalledTimes(1);
  });
});
