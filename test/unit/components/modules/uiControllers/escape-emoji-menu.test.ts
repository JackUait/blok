/**
 * Regression coverage for a Critical finding on Task 6: Escape closing the
 * emoji menu was also dropping the user into block navigation mode.
 *
 * In production this happens through a cross-module race: KeyboardController
 * registers a document CAPTURE-phase keydown listener, so it runs before the
 * block holder's bubble-phase listener (BlockEvents.keydown). Its generic
 * "close any open popover" branch used to close the emoji menu (via
 * PopoverRegistry) WITHOUT calling stopPropagation. Closing the popover fires
 * PopoverEvent.Closed synchronously, which EmojiTrigger's own listener turns
 * into `opened = false` before the event ever reaches the bubble phase. So by
 * the time BlockEvents.keydown ran, its own `emojiTrigger.opened` guard was
 * already false, and execution fell through to navigationMode.handleEscape,
 * which has no notion of the emoji menu and unconditionally enabled
 * navigation mode.
 *
 * This test mocks `PopoverRegistry.hasOpenPopovers()` to always return false
 * (real registry mechanics are exercised by other tests and are irrelevant
 * here), so without the fix the missing emoji check does not manifest via
 * that branch at all — it manifests one step later, via handleEscape's own
 * closing fallback ("nothing else claimed this Escape, so enter navigation
 * mode"), which is exactly as unaware of the emoji menu as
 * navigationMode.handleEscape is. Same observable defect — an Escape that
 * should be fully claimed by the open menu instead reaches code that enters
 * navigation mode — reached by whichever branch happens to run first when
 * nothing intercepts it earlier. The fix (a dedicated branch checked before
 * every other one) closes off both avenues at once.
 *
 * This test does not call EmojiTrigger.handleKeydown or BlockEvents.keydown
 * directly — a test written that way cannot fail on this bug, because the
 * bug is about which of several possible LATER branches gets to run, not
 * about the composer's own method in isolation. It wires a real
 * KeyboardController (via enable(), so its genuine document capture-phase
 * listener is attached) and a real BlockEvents instance (via a genuine
 * bubble-phase listener on the block holder), opens a real EmojiTrigger, and
 * dispatches one real Escape KeyboardEvent from the block's contentEditable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BlockEvents } from '../../../../../src/components/modules/blockEvents';
import { KeyboardController } from '../../../../../src/components/modules/uiControllers/controllers/keyboard';
import type { Block } from '../../../../../src/components/block';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import { PopoverRegistry } from '../../../../../src/components/utils/popover/popover-registry';

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

    // The real emoji menu is now the real EmojiPicker (see Task 6b), whose
    // resolveTheme() calls matchMedia — jsdom doesn't implement it.
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
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

    // The bug: without the fix, nothing in handleEscape claims this Escape
    // (PopoverRegistry is mocked closed, no toolbar is open, no selection),
    // so it falls all the way through to handleEscape's own closing
    // fallback and enters navigation mode — exactly as unaware of the emoji
    // menu as navigationMode.handleEscape is in the real production path.
    expect(enableNavigationMode).not.toHaveBeenCalled();

    // The bubble-phase listener never runs either way: the fixed path's own
    // early return stops it, and the unfixed fallback branch also calls
    // stopPropagation (for its own, unrelated reason) before entering
    // navigation mode. This assertion is not fix-specific — it just confirms
    // the event never reached BlockEvents.keydown for this key.
    expect(bubbleListener).not.toHaveBeenCalled();

    expect(blockEvents.emojiTrigger.opened).toBe(false);

    // enable() attached a real document-level capture listener; leaving it
    // registered would let this controller react to keydowns dispatched by
    // later tests sharing the same jsdom document.
    controller.disable();
    wrapper.remove();
  });
});
