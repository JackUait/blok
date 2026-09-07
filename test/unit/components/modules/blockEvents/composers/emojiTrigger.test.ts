import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmojiTrigger } from '../../../../../../src/components/modules/blockEvents/composers/emojiTrigger';
import { isInlineEmojiEnabled } from '../../../../../../src/components/utils/emoji/inline-emoji-config';
import type { Block } from '../../../../../../src/components/block';
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
    // Not a literal constant: a page can host multiple editors, and this id
    // stays on a persistent, hidden DOM node after close() — a shared literal
    // would collide (see the uniqueness test below).
    expect(mockPickerElement.id).toMatch(/^blok-emoji-menu-\d+$/);
  });

  it('gives each EmojiTrigger instance a distinct menu id', async () => {
    // The mocked picker's getElement() always returns the same shared node
    // (mockPickerElement), so id uniqueness is asserted through a real,
    // per-block DOM node instead: each block's own aria-controls value.
    const blockA = createBlock(':fi');
    const blockB = createBlock(':fi');

    document.body.appendChild(blockA.holder);
    document.body.appendChild(blockB.holder);

    setCaret(blockA, 3);

    const triggerA = new EmojiTrigger(createBlokModules(blockA));

    await triggerA.handleInput(createInputEvent());

    setCaret(blockB, 3);

    const triggerB = new EmojiTrigger(createBlokModules(blockB));

    await triggerB.handleInput(createInputEvent());

    const idA = blockA.currentInput?.getAttribute('aria-controls');
    const idB = blockB.currentInput?.getAttribute('aria-controls');

    expect(idA).not.toBeNull();
    expect(idB).not.toBeNull();
    expect(idA).not.toBe(idB);

    triggerA.close();
    triggerB.close();
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

  it('does not close when the selection moves into the picker\'s own element (e.g. clicking its search field)', async () => {
    const block = createBlock(':fi');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    currentTrigger = trigger;

    await trigger.handleInput(createInputEvent());
    expect(trigger.opened).toBe(true);

    // Clicking the picker's own search <input> moves the document
    // Selection's anchor into the picker's subtree — not into the block's
    // contentEditable, and not a case of the caret leaving the ":query" span.
    const pickerInput = document.createElement('input');

    mockPickerElement.appendChild(pickerInput);
    pickerInput.focus();

    const range = document.createRange();
    const textNode = document.createTextNode('');

    mockPickerElement.appendChild(textNode);
    range.setStart(textNode, 0);
    range.collapse(true);

    const selection = window.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));

    expect(trigger.opened).toBe(true);

    mockPickerElement.removeChild(pickerInput);
    mockPickerElement.removeChild(textNode);
  });

  it('destroy() removes the picker element from the DOM, not just hides it', async () => {
    const block = createBlock(':fi');

    document.body.appendChild(block.holder);
    setCaret(block, 3);

    const trigger = new EmojiTrigger(createBlokModules(block));

    await trigger.handleInput(createInputEvent());
    expect(document.body.contains(mockPickerElement)).toBe(true);

    trigger.destroy();

    expect(document.body.contains(mockPickerElement)).toBe(false);
    expect(mockPickerClose).toHaveBeenCalled();
  });

  it('destroy() is safe to call when the menu was never opened', () => {
    const block = createBlock(':fi');

    document.body.appendChild(block.holder);

    const trigger = new EmojiTrigger(createBlokModules(block));

    expect(() => trigger.destroy()).not.toThrow();
  });
});

describe('EmojiTrigger — grid highlight navigation', () => {
  let currentTrigger: EmojiTrigger | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPickerOpen.mockResolvedValue(undefined);
    mockPickerElement.innerHTML = '';
  });

  afterEach(() => {
    currentTrigger?.close();
    currentTrigger = undefined;
    mockPickerElement.innerHTML = '';
    vi.restoreAllMocks();
  });

  /**
   * ":i" ranks both fixture emoji (their names/ids both contain "i"), tied,
   * so dataset order wins: fire then grinning. Mimics what the real
   * EmojiPicker renders for that query, since open()/setQuery() are mocked
   * out and render nothing for real.
   */
  function renderTwoResultButtons(): HTMLButtonElement[] {
    return ['🔥', '😀'].map(native => {
      const btn = document.createElement('button');

      btn.setAttribute('data-emoji-native', native);
      mockPickerElement.appendChild(btn);

      return btn;
    });
  }

  async function openWithTwoResults(): Promise<{ trigger: EmojiTrigger; buttons: HTMLButtonElement[]; block: Block }> {
    const block = createBlock(':i');

    document.body.appendChild(block.holder);
    setCaret(block, 2);

    const trigger = new EmojiTrigger(createBlokModules(block));

    currentTrigger = trigger;

    const buttons = renderTwoResultButtons();

    await trigger.handleInput(createInputEvent({ data: 'i' }));

    return { trigger, buttons, block };
  }

  const press = (trigger: EmojiTrigger, key: string): boolean =>
    trigger.handleKeydown(new KeyboardEvent('keydown', { key }));

  it('highlights the top-ranked result by default, visibly', async () => {
    const { trigger, buttons } = await openWithTwoResults();

    expect(trigger.getHighlightedEmoji()?.native).toBe('🔥');
    expect(buttons[0]?.getAttribute('aria-selected')).toBe('true');
    expect(buttons[1]?.getAttribute('aria-selected')).toBeNull();
  });

  it('ArrowRight moves the highlight to the next result, visibly', async () => {
    const { trigger, buttons } = await openWithTwoResults();

    press(trigger, 'ArrowRight');

    expect(trigger.getHighlightedEmoji()?.native).toBe('😀');
    expect(buttons[0]?.getAttribute('aria-selected')).toBeNull();
    expect(buttons[1]?.getAttribute('aria-selected')).toBe('true');
  });

  it('ArrowRight past the last result clamps instead of wrapping', async () => {
    const { trigger } = await openWithTwoResults();

    press(trigger, 'ArrowRight');
    press(trigger, 'ArrowRight');

    expect(trigger.getHighlightedEmoji()?.native).toBe('😀');
  });

  it('ArrowLeft moves back toward the first result and clamps there', async () => {
    const { trigger } = await openWithTwoResults();

    press(trigger, 'ArrowRight');
    press(trigger, 'ArrowLeft');
    press(trigger, 'ArrowLeft');

    expect(trigger.getHighlightedEmoji()?.native).toBe('🔥');
  });

  it('ArrowDown steps by a full grid row (10) and clamps within the results', async () => {
    const { trigger } = await openWithTwoResults();

    press(trigger, 'ArrowDown');

    expect(trigger.getHighlightedEmoji()?.native).toBe('😀');
  });

  it('ArrowUp steps back by a full grid row and clamps at the first result', async () => {
    const { trigger } = await openWithTwoResults();

    press(trigger, 'ArrowRight');
    press(trigger, 'ArrowUp');

    expect(trigger.getHighlightedEmoji()?.native).toBe('🔥');
  });

  it('Home and End jump straight to the first and last result', async () => {
    const { trigger } = await openWithTwoResults();

    press(trigger, 'End');
    expect(trigger.getHighlightedEmoji()?.native).toBe('😀');

    press(trigger, 'Home');
    expect(trigger.getHighlightedEmoji()?.native).toBe('🔥');
  });

  it('resets the highlight to the top result on the next keystroke', async () => {
    const { trigger } = await openWithTwoResults();

    press(trigger, 'ArrowRight');
    expect(trigger.getHighlightedEmoji()?.native).toBe('😀');

    renderTwoResultButtons();
    await trigger.handleInput(createInputEvent({ data: 'i' }));

    expect(trigger.getHighlightedEmoji()?.native).toBe('🔥');
  });

  it('still claims ArrowLeft and ArrowRight so they do not leak into block navigation', async () => {
    const { trigger } = await openWithTwoResults();

    expect(press(trigger, 'ArrowLeft')).toBe(true);
    expect(press(trigger, 'ArrowRight')).toBe(true);
  });

  it('Enter inserts the highlighted emoji and closes the menu', async () => {
    const { trigger, block } = await openWithTwoResults();

    expect(press(trigger, 'Enter')).toBe(true);
    expect(block.currentInput?.textContent).toBe('🔥');
    expect(trigger.opened).toBe(false);
  });

  it('Tab inserts the highlighted emoji and closes the menu', async () => {
    const { trigger, block } = await openWithTwoResults();

    expect(press(trigger, 'Tab')).toBe(true);
    expect(block.currentInput?.textContent).toBe('🔥');
    expect(trigger.opened).toBe(false);
  });
});
