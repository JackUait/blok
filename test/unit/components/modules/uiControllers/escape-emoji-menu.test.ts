/**
 * Regression coverage for a Critical finding on Task 6: Escape closing the
 * emoji menu was also dropping the user into block navigation mode.
 *
 * The real dispatch path: KeyboardController registers a document CAPTURE-
 * phase keydown listener, so it runs before the block holder's bubble-phase
 * listener (BlockEvents.keydown). Before the fix, KeyboardController's
 * generic "close any open popover" branch closed the emoji menu (via
 * PopoverRegistry) WITHOUT calling stopPropagation. Closing the popover fires
 * PopoverEvent.Closed synchronously, which EmojiTrigger's own listener turns
 * into `opened = false` before the event ever reaches the bubble phase. So by
 * the time BlockEvents.keydown ran, its own `emojiTrigger.opened` guard was
 * already false, and execution fell through to navigationMode.handleEscape,
 * which has no notion of the emoji menu and unconditionally enabled
 * navigation mode.
 *
 * This test does not call EmojiTrigger.handleKeydown or BlockEvents.keydown
 * directly — a test written that way cannot fail on this bug, because the
 * bug lives entirely in whether the SAME keydown event reaches the bubble
 * phase at all. It wires a real KeyboardController (via enable(), so its
 * genuine document capture-phase listener is attached) and a real
 * BlockEvents instance (via a genuine bubble-phase listener on the block
 * holder), opens a real EmojiTrigger, and dispatches one real Escape
 * KeyboardEvent from the block's contentEditable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BlockEvents } from '../../../../../src/components/modules/blockEvents';
import { KeyboardController } from '../../../../../src/components/modules/uiControllers/controllers/keyboard';
import type { Block } from '../../../../../src/components/block';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import { PopoverRegistry } from '../../../../../src/components/utils/popover/popover-registry';

vi.mock('../../../../../src/components/utils/popover', () => ({
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

const MOCK_EMOJI_MART_DATA = {
  default: {
    categories: [{ id: 'people', emojis: ['fire'] }],
    emojis: {
      fire: { id: 'fire', name: 'Fire', keywords: ['hot'], skins: [{ native: '🔥', unified: '1f525' }], version: 1 },
    },
    aliases: {},
  },
};

vi.mock('@emoji-mart/data', () => MOCK_EMOJI_MART_DATA);

describe('Escape with the emoji menu open does not enter navigation mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(PopoverRegistry.instance, 'hasOpenPopovers').mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dispatches a genuine Escape keydown through the real capture-then-bubble pipeline', async () => {
    // Real DOM: wrapper (the editor boundary KeyboardController checks
    // against) -> block holder -> the block's contentEditable.
    const wrapper = document.createElement('div');

    wrapper.setAttribute('data-blok-testid', 'blok-editor');

    const holder = document.createElement('div');
    const input = document.createElement('div');

    input.contentEditable = 'true';
    input.textContent = ':fi';
    holder.appendChild(input);
    wrapper.appendChild(holder);
    document.body.appendChild(wrapper);

    const block = {
      id: 'block-1',
      name: 'paragraph',
      holder,
      currentInput: input,
      inputs: [input],
      isEmpty: false,
      tool: { isDefault: true, isLineBreaksEnabled: false, name: 'paragraph' },
    } as unknown as Block;

    const enableNavigationMode = vi.fn();
    const blockEvents = new BlockEvents({
      config: {},
      eventsDispatcher: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } as unknown as BlockEvents['eventsDispatcher'],
    });

    const blok = {
      BlockEvents: blockEvents,
      BlockManager: {
        currentBlock: block,
        setCurrentBlockByChildNode: vi.fn(),
      },
      BlockSelection: {
        navigationModeEnabled: false,
        anyBlockSelected: false,
        allBlocksSelected: false,
        enableNavigationMode,
        disableNavigationMode: vi.fn(),
      },
      BlockSettings: { opened: false },
      InlineToolbar: { opened: false },
      Toolbar: {
        toolbox: { opened: false, close: vi.fn() },
        close: vi.fn(),
      },
      CrossBlockSelection: {
        selectBlocksOfTextSelection: vi.fn(() => false),
        isCrossBlockSelectionStarted: false,
      },
      DragManager: { isDragging: false },
      I18n: {
        t: (key: string): string => key,
        getLocale: (): string => 'en',
      },
    } as unknown as BlokModules;

    blockEvents.state = blok;

    // Put the caret right after ":fi" so resolveEmojiTriggerSpan finds it.
    const textNode = input.firstChild;

    if (textNode === null) {
      throw new Error('input has no text node');
    }

    const range = document.createRange();

    range.setStart(textNode, 3);
    range.collapse(true);

    const selection = window.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);

    // Open the real emoji menu the same way BlockEvents.input() would.
    await blockEvents.emojiTrigger.handleInput({
      inputType: 'insertText',
      data: 'i',
      isComposing: false,
    } as InputEvent);
    expect(blockEvents.emojiTrigger.opened).toBe(true);

    // The block holder's genuine bubble-phase listener — mirrors how a
    // block's keydown is wired in production ("bound on each Block").
    const bubbleListener = vi.fn((event: Event) => blockEvents.keydown(event as KeyboardEvent));

    holder.addEventListener('keydown', bubbleListener);

    // A real KeyboardController with its real document capture-phase
    // listener attached via enable() — not called directly.
    const controller = new KeyboardController({
      config: {},
      eventsDispatcher: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } as unknown as KeyboardController['eventsDispatcher'],
      someToolbarOpened: () => false,
    });

    controller.state = blok;
    controller.setRedactorElement(wrapper);
    controller.setWrapperElement(wrapper);
    controller.enable();

    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    // The bug: navigation mode gets entered because the event reaches the
    // bubble-phase handler after the emoji menu's `opened` flag was already
    // reset by the capture-phase close.
    expect(enableNavigationMode).not.toHaveBeenCalled();

    // Confirms the mechanism, not just the symptom: the fix stops the event
    // in the capture phase, so the bubble-phase listener never runs at all.
    expect(bubbleListener).not.toHaveBeenCalled();

    expect(blockEvents.emojiTrigger.opened).toBe(false);

    // enable() attached a real document-level capture listener; leaving it
    // registered would let this controller react to keydowns dispatched by
    // later tests sharing the same jsdom document.
    controller.disable();
    wrapper.remove();
  });
});
