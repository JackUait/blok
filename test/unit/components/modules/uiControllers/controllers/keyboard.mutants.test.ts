/**
 * Editor-level keyboard controller: the routing and modifier rules a mutant can
 * break silently. Every assertion here was watched failing under a mutant that
 * had survived the existing suite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Block } from '../../../../../../src/components/block';
import { KeyboardController } from '../../../../../../src/components/modules/uiControllers/controllers/keyboard';
import { SelectionUtils as Selection } from '../../../../../../src/components/selection/index';
import { getCaretOffset } from '../../../../../../src/components/utils/caret/selection';
import type * as CaretSelectionModule from '../../../../../../src/components/utils/caret/selection';
import type * as BrowserModule from '../../../../../../src/components/utils/browser';
import {
  findCommonNestedContainer,
  scheduleCaretIntoNestedContainer,
} from '../../../../../../src/components/utils/nested-container-caret';
import { deliverOnSubmit } from '../../../../../../src/components/utils/on-submit';
import { PopoverRegistry } from '../../../../../../src/components/utils/popover/popover-registry';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';
import type { API, BlokConfig, OutputData } from '../../../../../../types';

/** Flipped per test so the iOS Shift+Enter exception can be exercised. */
const iosDevice = vi.hoisted(() => ({ value: false }));

vi.mock('../../../../../../src/components/utils/browser', async (importOriginal) => {
  const actual = await importOriginal<typeof BrowserModule>();

  return {
    ...actual,
    get isIosDevice() {
      return iosDevice.value;
    },
  };
});

vi.mock('../../../../../../src/components/utils/on-submit', () => ({
  deliverOnSubmit: vi.fn(),
}));

vi.mock('../../../../../../src/components/utils/nested-container-caret', () => ({
  findCommonNestedContainer: vi.fn(() => null),
  scheduleCaretIntoNestedContainer: vi.fn(),
}));

vi.mock('../../../../../../src/components/utils/caret/selection', async (importOriginal) => {
  const actual = await importOriginal<typeof CaretSelectionModule>();

  return {
    ...actual,
    getCaretOffset: vi.fn(() => 0),
  };
});

type EditorState = {
  currentBlock: Block | undefined;
  currentBlockIndex: number;
  blocks: Block[];
  anyBlockSelected: boolean;
  allBlocksSelected: boolean;
  selectedBlocks: Block[];
  navigationModeEnabled: boolean;
  isCrossBlockSelectionStarted: boolean;
  inlineToolbarOpened: boolean;
  hasNestedPopoverOpen: boolean;
  toolboxOpened: boolean;
  isDragging: boolean;
};

type PressResult = {
  event: KeyboardEvent;
  /** false when the controller stopped the event during the document capture phase */
  reachedTarget: boolean;
  /** false when the controller called stopImmediatePropagation */
  reachedLaterDocumentListener: boolean;
};

type Harness = {
  controller: KeyboardController;
  blok: BlokModules;
  state: EditorState;
  wrapper: HTMLElement;
  redactor: HTMLElement;
  inside: HTMLElement;
  outside: HTMLElement;
  apiMethods: API;
  order: string[];
  press: (target: HTMLElement, init?: KeyboardEventInit) => PressResult;
};

const makeBlock = (id: string): Block => {
  const holder = document.createElement('div');

  holder.setAttribute('data-block-id', id);

  return { id, name: 'paragraph', holder, selected: false } as unknown as Block;
};

const controllers: KeyboardController[] = [];

const createHarness = (options?: {
  someToolbarOpened?: () => boolean;
  config?: Partial<BlokConfig>;
}): Harness => {
  const wrapper = document.createElement('div');

  wrapper.setAttribute('data-blok-testid', 'blok-editor');
  document.body.appendChild(wrapper);

  const redactor = document.createElement('div');

  wrapper.appendChild(redactor);

  const inside = document.createElement('div');

  inside.textContent = 'inside the redactor';
  redactor.appendChild(inside);

  const outside = document.createElement('div');

  outside.textContent = 'outside the editor';
  document.body.appendChild(outside);

  const state: EditorState = {
    currentBlock: undefined,
    currentBlockIndex: -1,
    blocks: [],
    anyBlockSelected: false,
    allBlocksSelected: false,
    selectedBlocks: [],
    navigationModeEnabled: false,
    isCrossBlockSelectionStarted: false,
    inlineToolbarOpened: false,
    hasNestedPopoverOpen: false,
    toolboxOpened: false,
    isDragging: false,
  };

  const order: string[] = [];
  const apiMethods = { blocks: { getCurrentBlockIndex: (): number => 0 } } as unknown as API;

  const blok = {
    API: { methods: apiMethods },
    BlockManager: {
      get currentBlock(): Block | undefined {
        return state.currentBlock;
      },
      get currentBlockIndex(): number {
        return state.currentBlockIndex;
      },
      get blocks(): Block[] {
        return state.blocks;
      },
      insert: vi.fn(() => makeBlock('inserted-by-enter')),
      unsetCurrentBlock: vi.fn(),
      deleteSelectedBlocksAndInsertReplacement: vi.fn(() => undefined),
      getBlock: vi.fn(() => undefined),
      convert: vi.fn(() => Promise.resolve(makeBlock('converted'))),
    },
    BlockSelection: {
      get anyBlockSelected(): boolean {
        return state.anyBlockSelected;
      },
      get allBlocksSelected(): boolean {
        return state.allBlocksSelected;
      },
      get selectedBlocks(): Block[] {
        return state.selectedBlocks;
      },
      get navigationModeEnabled(): boolean {
        return state.navigationModeEnabled;
      },
      clearSelection: vi.fn(),
      enableNavigationMode: vi.fn(),
      disableNavigationMode: vi.fn(),
    },
    CrossBlockSelection: {
      get isCrossBlockSelectionStarted(): boolean {
        return state.isCrossBlockSelectionStarted;
      },
      selectBlocksOfTextSelection: vi.fn(() => false),
    },
    InlineToolbar: {
      get opened(): boolean {
        return state.inlineToolbarOpened;
      },
      get hasNestedPopoverOpen(): boolean {
        return state.hasNestedPopoverOpen;
      },
      close: vi.fn(),
      closeNestedPopover: vi.fn(),
    },
    BlockSettings: {
      contains: vi.fn(() => false),
    },
    Toolbar: {
      moveAndOpen: vi.fn(),
      close: vi.fn(),
      toolbox: {
        get opened(): boolean {
          return state.toolboxOpened;
        },
        close: vi.fn(),
      },
    },
    BlockEvents: {
      keydown: vi.fn(),
      // handleEscape reads this before the PopoverRegistry branch (see the
      // emoji-menu Escape fix); every Escape now touches it.
      emojiTrigger: { opened: false, close: vi.fn() },
    },
    Caret: {
      setToBlock: vi.fn(),
      positions: {
        START: 'start',
        END: 'end',
        DEFAULT: 'default',
      },
    },
    YjsManager: {
      markCaretBeforeChange: vi.fn(() => {
        order.push('controller');
      }),
      undo: vi.fn(),
      redo: vi.fn(),
      stopCapturing: vi.fn(),
    },
    DragManager: {
      get isDragging(): boolean {
        return state.isDragging;
      },
    },
    Saver: {
      save: vi.fn(() => Promise.resolve({ blocks: [] } as unknown as OutputData)),
    },
  } as unknown as BlokModules;

  const controller = new KeyboardController({
    config: { holder: document.createElement('div'), ...options?.config },
    eventsDispatcher: {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    } as unknown as ConstructorParameters<typeof KeyboardController>[0]['eventsDispatcher'],
    someToolbarOpened: options?.someToolbarOpened ?? ((): boolean => false),
  });

  controller.state = blok;
  controller.setRedactorElement(redactor);
  controller.setWrapperElement(wrapper);
  controllers.push(controller);

  const press = (target: HTMLElement, init: KeyboardEventInit = {}): PressResult => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    const atTarget = vi.fn();
    const laterDocumentCapture = vi.fn();

    target.addEventListener('keydown', atTarget);
    document.addEventListener('keydown', laterDocumentCapture, true);

    try {
      target.dispatchEvent(event);
    } finally {
      target.removeEventListener('keydown', atTarget);
      document.removeEventListener('keydown', laterDocumentCapture, true);
    }

    return {
      event,
      reachedTarget: atTarget.mock.calls.length > 0,
      reachedLaterDocumentListener: laterDocumentCapture.mock.calls.length > 0,
    };
  };

  return { controller, blok, state, wrapper, redactor, inside, outside, apiMethods, order, press };
};

/** Lets the awaited BlockManager.convert() settle so the caret restore runs. */
const flushConversion = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const enabledHarness = (options?: Parameters<typeof createHarness>[0]): Harness => {
  const harness = createHarness(options);

  harness.controller.enable();

  return harness;
};

describe('KeyboardController — mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    iosDevice.value = false;
    PopoverRegistry.resetForTests();
    vi.spyOn(Selection, 'isSelectionExists', 'get').mockReturnValue(true);
    vi.spyOn(Selection, 'isCollapsed', 'get').mockReturnValue(false);
  });

  afterEach(() => {
    controllers.forEach((controller) => {
      controller.disable();
    });
    controllers.length = 0;
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('listener wiring', () => {
    it('registers no listeners while the redactor element is missing', () => {
      const harness = createHarness();
      const detached = new KeyboardController({
        config: {},
        eventsDispatcher: {
          on: vi.fn(),
          off: vi.fn(),
          emit: vi.fn(),
        } as unknown as ConstructorParameters<typeof KeyboardController>[0]['eventsDispatcher'],
        someToolbarOpened: (): boolean => false,
      });

      detached.state = harness.blok;
      detached.setWrapperElement(harness.wrapper);
      controllers.push(detached);

      expect(() => {
        detached.enable();
      }).not.toThrow();

      harness.press(harness.outside, { key: 'a' });

      expect(harness.blok.BlockManager.unsetCurrentBlock).not.toHaveBeenCalled();
    });

    it('stops handling redactor input once disabled', () => {
      const harness = enabledHarness();

      harness.controller.disable();
      harness.redactor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true }));

      expect(harness.blok.YjsManager.markCaretBeforeChange).not.toHaveBeenCalled();
    });

    it('handles keys again after a disable/enable cycle', () => {
      const harness = enabledHarness();

      harness.controller.disable();
      harness.controller.enable();
      harness.press(harness.outside, { key: 'a' });

      expect(harness.blok.BlockManager.unsetCurrentBlock).toHaveBeenCalledTimes(1);
    });

    it('captures the caret before a tool handler can read the beforeinput', () => {
      const harness = enabledHarness();

      harness.inside.addEventListener('beforeinput', () => {
        harness.order.push('target');
      });
      harness.inside.dispatchEvent(new InputEvent('beforeinput', { bubbles: true }));

      expect(harness.order).toStrictEqual(['controller', 'target']);
    });

    it('captures the caret before a tool handler can read the keydown', () => {
      const harness = enabledHarness();

      harness.inside.addEventListener('keydown', () => {
        harness.order.push('target');
      });
      harness.press(harness.inside, { key: 'Enter' });

      expect(harness.order).toStrictEqual(['controller', 'target']);
    });

    it('marks the caret with a forced re-capture on beforeinput', () => {
      const harness = enabledHarness();

      harness.redactor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true }));

      expect(harness.blok.YjsManager.markCaretBeforeChange).toHaveBeenCalledWith(true);
    });
  });

  describe('redactor caret capture', () => {
    it('marks the caret for a structural key', () => {
      const harness = enabledHarness();

      harness.press(harness.inside, { key: 'Enter' });

      expect(harness.blok.YjsManager.markCaretBeforeChange).toHaveBeenCalledWith(true);
    });

    it('leaves plain typing alone', () => {
      const harness = enabledHarness();

      harness.press(harness.inside, { key: 'a' });

      expect(harness.blok.YjsManager.markCaretBeforeChange).not.toHaveBeenCalled();
    });

    it('skips a native input inside the redactor', () => {
      const harness = enabledHarness();
      const input = document.createElement('input');

      harness.redactor.appendChild(input);
      harness.press(input, { key: 'Enter' });

      expect(harness.blok.YjsManager.markCaretBeforeChange).not.toHaveBeenCalled();
    });

    it('skips a native textarea inside the redactor', () => {
      const harness = enabledHarness();
      const textarea = document.createElement('textarea');

      harness.redactor.appendChild(textarea);
      harness.press(textarea, { key: 'Enter' });

      expect(harness.blok.YjsManager.markCaretBeforeChange).not.toHaveBeenCalled();
    });

    it('skips a nested editor mounted inside the redactor', () => {
      const harness = enabledHarness();
      const nested = document.createElement('div');

      nested.setAttribute('data-blok-testid', 'blok-editor');
      harness.redactor.appendChild(nested);

      const nestedField = document.createElement('div');

      nested.appendChild(nestedField);
      harness.press(nestedField, { key: 'Enter' });

      expect(harness.blok.YjsManager.markCaretBeforeChange).not.toHaveBeenCalled();
    });

    it('ignores a non-keyboard event named keydown that carries a key', () => {
      const harness = enabledHarness();
      const spoofed = new CustomEvent('keydown', { bubbles: true });

      Object.defineProperty(spoofed, 'key', { value: 'Enter' });
      harness.inside.dispatchEvent(spoofed);

      expect(harness.blok.YjsManager.markCaretBeforeChange).not.toHaveBeenCalled();
    });
  });

  describe('document keydown guards', () => {
    it('ignores a non-keyboard event named keydown', () => {
      const harness = enabledHarness();

      harness.outside.dispatchEvent(new CustomEvent('keydown', { bubbles: true }));

      expect(harness.blok.BlockManager.unsetCurrentBlock).not.toHaveBeenCalled();
    });

    it('stands down inside a tool that claimed the keyboard', () => {
      const harness = enabledHarness();
      const owner = document.createElement('div');

      owner.setAttribute('data-blok-keyboard-owner', '');
      harness.redactor.appendChild(owner);

      const field = document.createElement('div');

      owner.appendChild(field);
      harness.state.currentBlockIndex = 0;
      harness.press(field, { key: 'Enter' });

      expect(harness.blok.BlockSelection.clearSelection).not.toHaveBeenCalled();
    });

    it('leaves Enter to a native input', () => {
      const harness = enabledHarness();
      const input = document.createElement('input');

      harness.redactor.appendChild(input);
      harness.press(input, { key: 'Enter' });

      expect(harness.blok.BlockSelection.clearSelection).not.toHaveBeenCalled();
    });

    it('leaves Enter to a native textarea', () => {
      const harness = enabledHarness();
      const textarea = document.createElement('textarea');

      harness.redactor.appendChild(textarea);
      harness.press(textarea, { key: 'Enter' });

      expect(harness.blok.BlockSelection.clearSelection).not.toHaveBeenCalled();
    });

    it('leaves Escape to an input outside a popover', () => {
      const harness = enabledHarness();
      const input = document.createElement('input');

      harness.redactor.appendChild(input);
      harness.press(input, { key: 'Escape' });

      expect(harness.blok.Toolbar.close).not.toHaveBeenCalled();
    });

    it('claims Escape from an input inside a popover so the popover can close', () => {
      const harness = enabledHarness();
      const popover = document.createElement('div');

      popover.setAttribute('data-blok-popover', '');
      harness.redactor.appendChild(popover);

      const input = document.createElement('input');

      popover.appendChild(input);

      const closeTopmost = vi.spyOn(PopoverRegistry.instance, 'closeTopmost').mockImplementation(() => true);

      vi.spyOn(PopoverRegistry.instance, 'hasOpenPopovers').mockReturnValue(true);

      harness.press(input, { key: 'Escape' });

      expect(closeTopmost).toHaveBeenCalledTimes(1);
    });

    it('leaves Enter to an input inside a popover', () => {
      const harness = enabledHarness();
      const popover = document.createElement('div');

      popover.setAttribute('data-blok-popover', '');
      harness.redactor.appendChild(popover);

      const input = document.createElement('input');

      popover.appendChild(input);
      harness.press(input, { key: 'Enter' });

      expect(harness.blok.BlockSelection.clearSelection).not.toHaveBeenCalled();
    });

    it('ignores a keydown raised inside a different editor instance', () => {
      const harness = enabledHarness();
      const otherEditor = document.createElement('div');

      otherEditor.setAttribute('data-blok-testid', 'blok-editor');
      document.body.appendChild(otherEditor);

      const otherField = document.createElement('div');

      otherEditor.appendChild(otherField);
      harness.press(otherField, { key: 'z', ctrlKey: true });

      expect(harness.blok.YjsManager.undo).not.toHaveBeenCalled();
    });

    it('handles a keydown raised inside this editor instance', () => {
      const harness = enabledHarness();

      harness.press(harness.inside, { key: 'z', ctrlKey: true });

      expect(harness.blok.YjsManager.undo).toHaveBeenCalledTimes(1);
    });

    it('handles a keydown raised outside any editor', () => {
      const harness = enabledHarness();

      harness.press(harness.outside, { key: 'z', ctrlKey: true });

      expect(harness.blok.YjsManager.undo).toHaveBeenCalledTimes(1);
    });
  });

  describe('turn-into shortcut', () => {
    const macCombo = { metaKey: true, altKey: true };
    const winCombo = { ctrlKey: true, shiftKey: true };

    it('converts to Heading 1 with the Mac combo', () => {
      const harness = enabledHarness({ config: { defaultBlock: 'paragraph' } });
      const block = makeBlock('current');

      harness.state.currentBlock = block;

      const { event, reachedTarget } = harness.press(harness.outside, { key: '1', code: 'Digit1', ...macCombo });

      expect(harness.blok.BlockManager.convert).toHaveBeenCalledWith(block, 'header', { level: 1 });
      expect(harness.blok.BlockEvents.keydown).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
      expect(reachedTarget).toBe(false);
    });

    it('converts to Heading 1 with the Win/Linux combo', () => {
      const harness = enabledHarness({ config: { defaultBlock: 'paragraph' } });
      const block = makeBlock('current');

      harness.state.currentBlock = block;
      harness.press(harness.outside, { key: '1', code: 'Digit1', ...winCombo });

      expect(harness.blok.BlockManager.convert).toHaveBeenCalledWith(block, 'header', { level: 1 });
    });

    const headingLevels: [string, number][] = [
      ['Digit2', 2],
      ['Digit3', 3],
      ['Digit4', 4],
      ['Digit5', 5],
      ['Digit6', 6],
    ];

    it.each(headingLevels)('converts %s to the matching heading level', (code, level) => {
      const harness = enabledHarness({ config: { defaultBlock: 'paragraph' } });
      const block = makeBlock('current');

      harness.state.currentBlock = block;
      harness.press(harness.outside, { key: String(level), code, ...macCombo });

      expect(harness.blok.BlockManager.convert).toHaveBeenCalledWith(block, 'header', { level });
    });

    it('converts back to the configured default block with digit 0', () => {
      const harness = enabledHarness({ config: { defaultBlock: 'custom-text' } });
      const block = makeBlock('current');

      harness.state.currentBlock = block;
      harness.press(harness.outside, { key: '0', code: 'Digit0', ...macCombo });

      expect(harness.blok.BlockManager.convert).toHaveBeenCalledWith(block, 'custom-text', {});
    });

    it('falls back to paragraph when no default block is configured', () => {
      const harness = enabledHarness();
      const block = makeBlock('current');

      harness.state.currentBlock = block;
      harness.press(harness.outside, { key: '0', code: 'Digit0', ...macCombo });

      expect(harness.blok.BlockManager.convert).toHaveBeenCalledWith(block, 'paragraph', {});
    });

    const nonMatchingModifiers: [string, KeyboardEventInit][] = [
      ['no modifier', {}],
      ['Cmd alone', { metaKey: true }],
      ['Opt alone', { altKey: true }],
      ['Ctrl alone', { ctrlKey: true }],
      ['Shift alone', { shiftKey: true }],
      ['Ctrl+Opt', { ctrlKey: true, altKey: true }],
    ];

    it.each(nonMatchingModifiers)('does not convert with %s held', (_label, modifiers) => {
      const harness = enabledHarness({ config: { defaultBlock: 'paragraph' } });

      harness.state.currentBlock = makeBlock('current');

      const { event } = harness.press(harness.outside, { key: '1', code: 'Digit1', ...modifiers });

      expect(harness.blok.BlockManager.convert).not.toHaveBeenCalled();
      expect(harness.blok.BlockEvents.keydown).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(false);
    });

    it('lets a non-digit key through with the turn-into modifiers held', () => {
      const harness = enabledHarness({ config: { defaultBlock: 'paragraph' } });

      harness.state.currentBlock = makeBlock('current');
      harness.press(harness.outside, { key: 'a', code: 'KeyA', ...macCombo });

      expect(harness.blok.BlockManager.convert).not.toHaveBeenCalled();
      expect(harness.blok.BlockEvents.keydown).toHaveBeenCalledTimes(1);
    });

    it('does nothing without a current block and leaves the key to default handling', () => {
      const harness = enabledHarness({ config: { defaultBlock: 'paragraph' } });

      harness.state.currentBlock = undefined;

      const { event } = harness.press(harness.outside, { key: '1', code: 'Digit1', ...macCombo });

      expect(harness.blok.BlockManager.convert).not.toHaveBeenCalled();
      expect(harness.blok.BlockManager.unsetCurrentBlock).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(false);
    });

    it('swallows the shortcut while a drag is in progress', () => {
      const harness = enabledHarness({ config: { defaultBlock: 'paragraph' } });

      harness.state.currentBlock = makeBlock('current');
      harness.state.isDragging = true;

      const { event, reachedTarget } = harness.press(harness.outside, { key: '1', code: 'Digit1', ...macCombo });

      expect(harness.blok.BlockManager.convert).not.toHaveBeenCalled();
      expect(harness.blok.BlockEvents.keydown).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
      expect(reachedTarget).toBe(false);
    });

    it('brackets the conversion in stopCapturing and restores the caret offset', async () => {
      vi.mocked(getCaretOffset).mockReturnValue(7);

      const harness = enabledHarness({ config: { defaultBlock: 'paragraph' } });
      const converted = makeBlock('converted-heading');

      vi.mocked(harness.blok.BlockManager.convert).mockResolvedValue(converted);
      harness.state.currentBlock = makeBlock('current');
      harness.press(harness.outside, { key: '1', code: 'Digit1', ...macCombo });

      await flushConversion();

      expect(harness.blok.Caret.setToBlock).toHaveBeenCalledWith(converted, 'default', 7);
      expect(harness.blok.YjsManager.stopCapturing).toHaveBeenCalledTimes(2);
    });

    it('converts once when one physical press emits two keydowns', () => {
      const harness = enabledHarness({ config: { defaultBlock: 'paragraph' } });

      harness.state.currentBlock = makeBlock('current');
      harness.press(harness.outside, { key: '1', code: 'Digit1', ...macCombo });

      const repeat = harness.press(harness.outside, { key: '1', code: 'Digit1', ...macCombo });

      expect(harness.blok.BlockManager.convert).toHaveBeenCalledTimes(1);
      expect(harness.blok.BlockEvents.keydown).not.toHaveBeenCalled();
      expect(repeat.event.defaultPrevented).toBe(true);
    });

    it('converts twice for two different digits pressed back to back', () => {
      const harness = enabledHarness({ config: { defaultBlock: 'paragraph' } });

      harness.state.currentBlock = makeBlock('current');
      harness.press(harness.outside, { key: '1', code: 'Digit1', ...macCombo });
      harness.press(harness.outside, { key: '2', code: 'Digit2', ...macCombo });

      expect(harness.blok.BlockManager.convert).toHaveBeenCalledTimes(2);
    });

    it('converts again once the dedup window has fully elapsed', () => {
      vi.useFakeTimers();

      const harness = enabledHarness({ config: { defaultBlock: 'paragraph' } });

      harness.state.currentBlock = makeBlock('current');
      harness.press(harness.outside, { key: '1', code: 'Digit1', ...macCombo });
      vi.advanceTimersByTime(50);
      harness.press(harness.outside, { key: '1', code: 'Digit1', ...macCombo });

      expect(harness.blok.BlockManager.convert).toHaveBeenCalledTimes(2);
    });
  });

  describe('list shortcut', () => {
    const macCombo = { metaKey: true, shiftKey: true };
    const winCombo = { ctrlKey: true, shiftKey: true };

    const listStyles: [string, string][] = [
      ['Digit5', 'unordered'],
      ['Digit6', 'ordered'],
      ['Digit7', 'checklist'],
    ];

    it.each(listStyles)('converts %s to a %s list', (code, style) => {
      const harness = enabledHarness({ config: { defaultBlock: 'paragraph' } });
      const block = makeBlock('current');

      harness.state.currentBlock = block;

      const { event, reachedTarget } = harness.press(harness.outside, { key: code.slice(-1), code, ...macCombo });

      expect(harness.blok.BlockManager.convert).toHaveBeenCalledWith(block, 'list', { style });
      expect(harness.blok.BlockEvents.keydown).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
      expect(reachedTarget).toBe(false);
    });

    it('wins the Ctrl+Shift+5 collision with Heading 5', () => {
      const harness = enabledHarness({ config: { defaultBlock: 'paragraph' } });
      const block = makeBlock('current');

      harness.state.currentBlock = block;
      harness.press(harness.outside, { key: '5', code: 'Digit5', ...winCombo });

      expect(harness.blok.BlockManager.convert).toHaveBeenCalledWith(block, 'list', { style: 'unordered' });
      expect(harness.blok.BlockManager.convert).not.toHaveBeenCalledWith(block, 'header', { level: 5 });
    });

    it('leaves the digit to the heading combo when Opt is also held', () => {
      const harness = enabledHarness({ config: { defaultBlock: 'paragraph' } });
      const block = makeBlock('current');

      harness.state.currentBlock = block;
      harness.press(harness.outside, { key: '5', code: 'Digit5', metaKey: true, shiftKey: true, altKey: true });

      expect(harness.blok.BlockManager.convert).toHaveBeenCalledWith(block, 'header', { level: 5 });
    });

    const nonListModifiers: [string, KeyboardEventInit][] = [
      ['no modifier', {}],
      ['Cmd without Shift', { metaKey: true }],
      ['Ctrl without Shift', { ctrlKey: true }],
      ['Shift alone', { shiftKey: true }],
    ];

    it.each(nonListModifiers)('does not create a list with %s held', (_label, modifiers) => {
      const harness = enabledHarness({ config: { defaultBlock: 'paragraph' } });

      harness.state.currentBlock = makeBlock('current');
      harness.press(harness.outside, { key: '5', code: 'Digit5', ...modifiers });

      expect(harness.blok.BlockManager.convert).not.toHaveBeenCalled();
      expect(harness.blok.BlockEvents.keydown).toHaveBeenCalledTimes(1);
    });

    it('leaves a digit with no list style to the rest of the pipeline', () => {
      const harness = enabledHarness({ config: { defaultBlock: 'paragraph' } });

      harness.state.currentBlock = makeBlock('current');
      harness.press(harness.outside, { key: '1', code: 'Digit1', ...macCombo });

      expect(harness.blok.BlockManager.convert).not.toHaveBeenCalled();
      expect(harness.blok.BlockEvents.keydown).toHaveBeenCalledTimes(1);
    });

    it('does nothing without a current block and leaves the key to default handling', () => {
      const harness = enabledHarness({ config: { defaultBlock: 'paragraph' } });

      harness.state.currentBlock = undefined;
      harness.press(harness.outside, { key: '5', code: 'Digit5', ...macCombo });

      expect(harness.blok.BlockManager.convert).not.toHaveBeenCalled();
      expect(harness.blok.BlockManager.unsetCurrentBlock).toHaveBeenCalledTimes(1);
    });

    it('swallows the list shortcut while a drag is in progress', () => {
      const harness = enabledHarness({ config: { defaultBlock: 'paragraph' } });

      harness.state.currentBlock = makeBlock('current');
      harness.state.isDragging = true;

      const { event, reachedTarget } = harness.press(harness.outside, { key: '5', code: 'Digit5', ...macCombo });

      expect(harness.blok.BlockManager.convert).not.toHaveBeenCalled();
      expect(harness.blok.BlockEvents.keydown).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
      expect(reachedTarget).toBe(false);
    });

    it('brackets the list conversion in stopCapturing and restores the caret offset', async () => {
      vi.mocked(getCaretOffset).mockReturnValue(4);

      const harness = enabledHarness({ config: { defaultBlock: 'paragraph' } });
      const converted = makeBlock('converted-list');

      vi.mocked(harness.blok.BlockManager.convert).mockResolvedValue(converted);
      harness.state.currentBlock = makeBlock('current');
      harness.press(harness.outside, { key: '5', code: 'Digit5', ...macCombo });

      await flushConversion();

      expect(harness.blok.Caret.setToBlock).toHaveBeenCalledWith(converted, 'default', 4);
      expect(harness.blok.YjsManager.stopCapturing).toHaveBeenCalledTimes(2);
    });

    it('creates one list when one physical press emits two keydowns', () => {
      const harness = enabledHarness({ config: { defaultBlock: 'paragraph' } });

      harness.state.currentBlock = makeBlock('current');
      harness.press(harness.outside, { key: '5', code: 'Digit5', ...macCombo });

      const repeat = harness.press(harness.outside, { key: '5', code: 'Digit5', ...macCombo });

      expect(harness.blok.BlockManager.convert).toHaveBeenCalledTimes(1);
      expect(harness.blok.BlockEvents.keydown).not.toHaveBeenCalled();
      expect(repeat.event.defaultPrevented).toBe(true);
    });

    it('creates two lists for two different digits pressed back to back', () => {
      const harness = enabledHarness({ config: { defaultBlock: 'paragraph' } });

      harness.state.currentBlock = makeBlock('current');
      harness.press(harness.outside, { key: '5', code: 'Digit5', ...macCombo });
      harness.press(harness.outside, { key: '6', code: 'Digit6', ...macCombo });

      expect(harness.blok.BlockManager.convert).toHaveBeenCalledTimes(2);
    });

    it('creates a list again once the dedup window has fully elapsed', () => {
      vi.useFakeTimers();

      const harness = enabledHarness({ config: { defaultBlock: 'paragraph' } });

      harness.state.currentBlock = makeBlock('current');
      harness.press(harness.outside, { key: '5', code: 'Digit5', ...macCombo });
      vi.advanceTimersByTime(50);
      harness.press(harness.outside, { key: '5', code: 'Digit5', ...macCombo });

      expect(harness.blok.BlockManager.convert).toHaveBeenCalledTimes(2);
    });
  });

  describe('Enter', () => {
    const enterOnBody = (harness: Harness, init: KeyboardEventInit = {}): PressResult =>
      harness.press(document.body, { key: 'Enter', ...init });

    it('inserts a block, moves the caret and opens the toolbar on a body-target Enter', () => {
      const harness = enabledHarness();
      const inserted = makeBlock('brand-new');

      vi.mocked(harness.blok.BlockManager.insert).mockReturnValue(inserted);
      harness.state.currentBlockIndex = 0;

      const { event } = enterOnBody(harness);

      expect(harness.blok.BlockManager.insert).toHaveBeenCalledTimes(1);
      expect(harness.blok.Caret.setToBlock).toHaveBeenCalledWith(inserted);
      expect(harness.blok.Toolbar.moveAndOpen).toHaveBeenCalledWith(inserted);
      expect(harness.blok.BlockSelection.clearSelection).toHaveBeenCalledTimes(1);
      expect(harness.blok.BlockSelection.clearSelection).toHaveBeenCalledWith(event);
      expect(event.defaultPrevented).toBe(true);
    });

    it('inserts nothing when no block is pointed at', () => {
      const harness = enabledHarness();

      harness.state.currentBlockIndex = -1;
      enterOnBody(harness);

      expect(harness.blok.BlockManager.insert).not.toHaveBeenCalled();
      expect(harness.blok.BlockSelection.clearSelection).toHaveBeenCalledTimes(1);
    });

    it('inserts nothing when the Enter came from inside the editor content', () => {
      const harness = enabledHarness();

      harness.state.currentBlockIndex = 0;
      harness.press(harness.inside, { key: 'Enter' });

      expect(harness.blok.BlockManager.insert).not.toHaveBeenCalled();
      expect(harness.blok.BlockSelection.clearSelection).toHaveBeenCalledTimes(1);
    });

    it('leaves an Enter that commits an IME composition to the input method', () => {
      const harness = enabledHarness();

      harness.state.currentBlockIndex = 0;
      enterOnBody(harness, { isComposing: true });

      expect(harness.blok.BlockManager.insert).not.toHaveBeenCalled();
      expect(harness.blok.BlockSelection.clearSelection).not.toHaveBeenCalled();
    });

    it('stands down while a toolbar is open', () => {
      const harness = enabledHarness({ someToolbarOpened: () => true });

      harness.state.currentBlockIndex = 0;
      enterOnBody(harness);

      expect(harness.blok.BlockManager.insert).not.toHaveBeenCalled();
      expect(harness.blok.BlockSelection.clearSelection).not.toHaveBeenCalled();
    });

    it('delegates Enter to the block pipeline in navigation mode', () => {
      const harness = enabledHarness();

      harness.state.navigationModeEnabled = true;
      harness.state.currentBlockIndex = 0;

      const { event } = enterOnBody(harness);

      expect(harness.blok.BlockEvents.keydown).toHaveBeenCalledWith(event);
      expect(harness.blok.BlockManager.insert).not.toHaveBeenCalled();
      expect(harness.blok.BlockSelection.clearSelection).not.toHaveBeenCalled();
    });

    it('drops a block selection instead of inserting when no native selection is left', () => {
      const harness = enabledHarness();

      harness.state.anyBlockSelected = true;
      harness.state.currentBlockIndex = 0;
      vi.spyOn(Selection, 'isSelectionExists', 'get').mockReturnValue(false);

      const { event, reachedLaterDocumentListener } = enterOnBody(harness);

      expect(harness.blok.BlockSelection.clearSelection).toHaveBeenCalledTimes(1);
      expect(harness.blok.BlockManager.insert).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
      expect(reachedLaterDocumentListener).toBe(false);
    });

    it('drops a block selection when the native selection is collapsed', () => {
      const harness = enabledHarness();

      harness.state.anyBlockSelected = true;
      harness.state.currentBlockIndex = 0;
      vi.spyOn(Selection, 'isCollapsed', 'get').mockReturnValue(true);

      const { event } = enterOnBody(harness);

      expect(harness.blok.BlockManager.insert).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
    });

    it('keeps inserting when a live uncollapsed selection coexists with selected blocks', () => {
      const harness = enabledHarness();

      harness.state.anyBlockSelected = true;
      harness.state.currentBlockIndex = 0;
      enterOnBody(harness);

      expect(harness.blok.BlockManager.insert).toHaveBeenCalledTimes(1);
    });

    it('keeps inserting when no blocks are selected and no native selection exists', () => {
      const harness = enabledHarness();

      harness.state.currentBlockIndex = 0;
      vi.spyOn(Selection, 'isSelectionExists', 'get').mockReturnValue(false);
      enterOnBody(harness);

      expect(harness.blok.BlockManager.insert).toHaveBeenCalledTimes(1);
    });

    it('lets config.onEnter suppress the insert', () => {
      const seen: [KeyboardEvent, API][] = [];
      const onEnter = vi.fn((event: KeyboardEvent, api: API): boolean => {
        seen.push([event, api]);

        return true;
      });
      const harness = enabledHarness({ config: { onEnter } });

      harness.state.currentBlockIndex = 0;

      const { event } = enterOnBody(harness);

      expect(onEnter).toHaveBeenCalledTimes(1);
      expect(seen[0][0]).toBe(event);
      expect(seen[0][1]).toBe(harness.apiMethods);
      expect(harness.blok.BlockManager.insert).not.toHaveBeenCalled();
      expect(harness.blok.BlockSelection.clearSelection).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it('keeps the insert when config.onEnter returns nothing', () => {
      const onEnter = vi.fn((): void => undefined);
      const harness = enabledHarness({ config: { onEnter } });

      harness.state.currentBlockIndex = 0;
      enterOnBody(harness);

      expect(onEnter).toHaveBeenCalledTimes(1);
      expect(harness.blok.BlockManager.insert).toHaveBeenCalledTimes(1);
    });

    it('treats Shift+Enter as a soft line break and skips config.onEnter', () => {
      const onEnter = vi.fn((): boolean => true);
      const harness = enabledHarness({ config: { onEnter } });

      harness.state.currentBlockIndex = 0;
      enterOnBody(harness, { shiftKey: true });

      expect(onEnter).not.toHaveBeenCalled();
      expect(harness.blok.BlockManager.insert).toHaveBeenCalledTimes(1);
    });

    it('still runs config.onEnter for Shift+Enter on iOS', () => {
      iosDevice.value = true;

      const onEnter = vi.fn((): boolean => true);
      const harness = enabledHarness({ config: { onEnter } });

      harness.state.currentBlockIndex = 0;
      enterOnBody(harness, { shiftKey: true });

      expect(onEnter).toHaveBeenCalledTimes(1);
      expect(harness.blok.BlockManager.insert).not.toHaveBeenCalled();
    });

    it('delivers config.onSubmit with the serializer instead of inserting', () => {
      const onSubmit = vi.fn();
      const harness = enabledHarness({ config: { onSubmit } });

      harness.state.currentBlockIndex = 0;

      const { event } = enterOnBody(harness);

      expect(deliverOnSubmit).toHaveBeenCalledTimes(1);

      const [saveThunk, api, handler] = vi.mocked(deliverOnSubmit).mock.calls[0];

      expect(api).toBe(harness.apiMethods);
      expect(handler).toBe(onSubmit);

      void saveThunk();

      expect(harness.blok.Saver.save).toHaveBeenCalledTimes(1);
      expect(harness.blok.BlockManager.insert).not.toHaveBeenCalled();
      expect(harness.blok.BlockSelection.clearSelection).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it('does not submit on Shift+Enter', () => {
      const onSubmit = vi.fn();
      const harness = enabledHarness({ config: { onSubmit } });

      harness.state.currentBlockIndex = 0;
      enterOnBody(harness, { shiftKey: true });

      expect(deliverOnSubmit).not.toHaveBeenCalled();
      expect(harness.blok.BlockManager.insert).toHaveBeenCalledTimes(1);
    });

    it('lets a handled onEnter take precedence over onSubmit', () => {
      const onEnter = vi.fn((): boolean => true);
      const onSubmit = vi.fn();
      const harness = enabledHarness({ config: { onEnter, onSubmit } });

      harness.state.currentBlockIndex = 0;
      enterOnBody(harness);

      expect(deliverOnSubmit).not.toHaveBeenCalled();
    });
  });

  describe('Backspace and Delete', () => {
    const noNativeSelection = (): void => {
      vi.spyOn(Selection, 'isSelectionExists', 'get').mockReturnValue(false);
    };

    it('removes the selected blocks and puts the caret in the replacement', () => {
      const harness = enabledHarness();
      const replacement = makeBlock('replacement');

      harness.state.anyBlockSelected = true;
      noNativeSelection();
      vi.mocked(harness.blok.BlockManager.deleteSelectedBlocksAndInsertReplacement).mockReturnValue(replacement);

      const { event, reachedLaterDocumentListener } = harness.press(document.body, { key: 'Backspace' });

      expect(harness.blok.BlockManager.deleteSelectedBlocksAndInsertReplacement).toHaveBeenCalledTimes(1);
      expect(harness.blok.Caret.setToBlock).toHaveBeenCalledWith(replacement, 'start');
      expect(harness.blok.BlockSelection.clearSelection).toHaveBeenCalledWith(event);
      expect(event.defaultPrevented).toBe(true);
      expect(reachedLaterDocumentListener).toBe(false);
    });

    it('removes the selected blocks on Delete too', () => {
      const harness = enabledHarness();

      harness.state.anyBlockSelected = true;
      noNativeSelection();
      harness.press(document.body, { key: 'Delete' });

      expect(harness.blok.BlockManager.deleteSelectedBlocksAndInsertReplacement).toHaveBeenCalledTimes(1);
    });

    it('leaves Backspace to the BlockSettings popover', () => {
      const harness = enabledHarness();

      harness.state.anyBlockSelected = true;
      noNativeSelection();
      vi.mocked(harness.blok.BlockSettings.contains).mockReturnValue(true);
      harness.press(document.body, { key: 'Backspace' });

      expect(harness.blok.BlockManager.deleteSelectedBlocksAndInsertReplacement).not.toHaveBeenCalled();
    });

    it('deletes nothing when no block is selected', () => {
      const harness = enabledHarness();

      vi.spyOn(Selection, 'isSelectionExists', 'get').mockReturnValue(false);
      harness.press(document.body, { key: 'Backspace' });

      expect(harness.blok.BlockManager.deleteSelectedBlocksAndInsertReplacement).not.toHaveBeenCalled();
    });

    it('deletes nothing while a live uncollapsed text selection is on the page', () => {
      const harness = enabledHarness();

      harness.state.anyBlockSelected = true;
      harness.press(document.body, { key: 'Backspace' });

      expect(harness.blok.BlockManager.deleteSelectedBlocksAndInsertReplacement).not.toHaveBeenCalled();
    });

    it('deletes when the native selection is collapsed', () => {
      const harness = enabledHarness();

      harness.state.anyBlockSelected = true;
      vi.spyOn(Selection, 'isCollapsed', 'get').mockReturnValue(true);
      harness.press(document.body, { key: 'Backspace' });

      expect(harness.blok.BlockManager.deleteSelectedBlocksAndInsertReplacement).toHaveBeenCalledTimes(1);
    });

    it('deletes when no native selection exists at all', () => {
      const harness = enabledHarness();

      harness.state.anyBlockSelected = true;
      noNativeSelection();
      harness.press(document.body, { key: 'Backspace' });

      expect(harness.blok.BlockManager.deleteSelectedBlocksAndInsertReplacement).toHaveBeenCalledTimes(1);
    });

    it('deletes during a cross-block selection even with a live text selection', () => {
      const harness = enabledHarness();

      harness.state.anyBlockSelected = true;
      harness.state.isCrossBlockSelectionStarted = true;
      harness.press(document.body, { key: 'Backspace' });

      expect(harness.blok.BlockManager.deleteSelectedBlocksAndInsertReplacement).toHaveBeenCalledTimes(1);
    });

    it('looks for the shared container using only the selected blocks', () => {
      const harness = enabledHarness();
      const selectedOne = makeBlock('sel-1');
      const untouched = makeBlock('untouched');
      const selectedTwo = makeBlock('sel-2');

      Object.assign(selectedOne, { selected: true });
      Object.assign(selectedTwo, { selected: true });
      harness.state.blocks = [selectedOne, untouched, selectedTwo];
      harness.state.anyBlockSelected = true;
      noNativeSelection();
      harness.press(document.body, { key: 'Backspace' });

      expect(findCommonNestedContainer).toHaveBeenCalledWith([selectedOne, selectedTwo]);
    });

    it('restores the caret into the shared container when no replacement was inserted', () => {
      const harness = enabledHarness();
      const container = document.createElement('div');
      const holder = document.createElement('div');
      const resolved = makeBlock('resolved');

      vi.mocked(findCommonNestedContainer).mockReturnValue(container);
      vi.mocked(harness.blok.BlockManager.getBlock).mockReturnValue(resolved);
      harness.state.anyBlockSelected = true;
      noNativeSelection();
      harness.press(document.body, { key: 'Backspace' });

      expect(harness.blok.Caret.setToBlock).not.toHaveBeenCalled();
      expect(scheduleCaretIntoNestedContainer).toHaveBeenCalledTimes(1);

      const [passedContainer, deps] = vi.mocked(scheduleCaretIntoNestedContainer).mock.calls[0];

      expect(passedContainer).toBe(container);
      expect(deps.getBlock(holder)).toBe(resolved);
      expect(vi.mocked(harness.blok.BlockManager.getBlock).mock.calls[0][0]).toBe(holder);

      deps.setCaretToBlockStart(resolved);

      expect(harness.blok.Caret.setToBlock).toHaveBeenCalledWith(resolved, 'start');
    });
  });

  describe('Escape', () => {
    it('leaves navigation mode without discarding the caret', () => {
      const harness = enabledHarness();

      harness.state.navigationModeEnabled = true;
      harness.press(harness.inside, { key: 'Escape' });

      expect(harness.blok.BlockSelection.disableNavigationMode).toHaveBeenCalledWith(false);
      expect(harness.blok.Toolbar.close).not.toHaveBeenCalled();
    });

    it('closes the toolbox and keeps the event from the block handlers', () => {
      const harness = enabledHarness();

      harness.state.toolboxOpened = true;

      const { event, reachedTarget } = harness.press(harness.inside, { key: 'Escape' });

      expect(harness.blok.Toolbar.toolbox.close).toHaveBeenCalledTimes(1);
      expect(reachedTarget).toBe(false);
      expect(event.defaultPrevented).toBe(false);
    });

    it('closes the topmost registered popover', () => {
      const harness = enabledHarness();
      const closeTopmost = vi.spyOn(PopoverRegistry.instance, 'closeTopmost').mockImplementation(() => true);

      vi.spyOn(PopoverRegistry.instance, 'hasOpenPopovers').mockReturnValue(true);
      harness.press(harness.inside, { key: 'Escape' });

      expect(closeTopmost).toHaveBeenCalledTimes(1);
      expect(harness.blok.Toolbar.close).not.toHaveBeenCalled();
    });

    it('returns a caret to the editor when escaping a select-all', () => {
      const harness = enabledHarness();
      const first = makeBlock('first-selected');

      harness.state.anyBlockSelected = true;
      harness.state.allBlocksSelected = true;
      harness.state.selectedBlocks = [first, makeBlock('second-selected')];

      const { event, reachedLaterDocumentListener } = harness.press(harness.inside, { key: 'Escape' });

      expect(harness.blok.BlockSelection.clearSelection).toHaveBeenCalledWith(event, true);
      expect(harness.blok.Caret.setToBlock).toHaveBeenCalledWith(first, 'end');
      expect(event.defaultPrevented).toBe(true);
      expect(reachedLaterDocumentListener).toBe(false);
    });

    it('places no caret when the select-all left no blocks behind', () => {
      const harness = enabledHarness();

      harness.state.anyBlockSelected = true;
      harness.state.allBlocksSelected = true;
      harness.state.selectedBlocks = [];
      harness.press(harness.inside, { key: 'Escape' });

      expect(harness.blok.Caret.setToBlock).not.toHaveBeenCalled();
    });

    it('only clears a partial block selection', () => {
      const harness = enabledHarness();

      harness.state.anyBlockSelected = true;
      harness.state.allBlocksSelected = false;
      harness.state.selectedBlocks = [makeBlock('partial')];

      const { event } = harness.press(harness.inside, { key: 'Escape' });

      expect(harness.blok.BlockSelection.clearSelection).toHaveBeenCalledWith(event);
      expect(harness.blok.Caret.setToBlock).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it('dismisses only the nested popover of an open inline toolbar', () => {
      const harness = enabledHarness();

      harness.state.inlineToolbarOpened = true;
      harness.state.hasNestedPopoverOpen = true;

      const { event, reachedLaterDocumentListener } = harness.press(harness.inside, { key: 'Escape' });

      expect(harness.blok.InlineToolbar.closeNestedPopover).toHaveBeenCalledTimes(1);
      expect(harness.blok.InlineToolbar.close).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
      expect(reachedLaterDocumentListener).toBe(false);
    });

    it('ignores a stale nested-popover flag while the inline toolbar is closed', () => {
      const harness = enabledHarness();

      harness.state.inlineToolbarOpened = false;
      harness.state.hasNestedPopoverOpen = true;
      harness.press(harness.inside, { key: 'Escape' });

      expect(harness.blok.InlineToolbar.closeNestedPopover).not.toHaveBeenCalled();
    });

    it('closes the inline toolbar and keeps the event from the block handlers', () => {
      const harness = enabledHarness();

      harness.state.inlineToolbarOpened = true;

      const { event, reachedTarget } = harness.press(harness.inside, { key: 'Escape' });

      expect(harness.blok.InlineToolbar.close).toHaveBeenCalledTimes(1);
      expect(reachedTarget).toBe(false);
      expect(event.defaultPrevented).toBe(false);
    });

    it('leaves an Escape raised inside the toolbar to the toolbar itself', () => {
      const harness = enabledHarness();
      const toolbar = document.createElement('div');

      toolbar.setAttribute('data-blok-toolbar', '');
      harness.redactor.appendChild(toolbar);

      const button = document.createElement('button');

      toolbar.appendChild(button);
      harness.state.currentBlock = makeBlock('current');

      const { event, reachedTarget } = harness.press(button, { key: 'Escape' });

      expect(harness.blok.Toolbar.close).not.toHaveBeenCalled();
      expect(harness.blok.BlockSelection.enableNavigationMode).not.toHaveBeenCalled();
      expect(harness.blok.CrossBlockSelection.selectBlocksOfTextSelection).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
      expect(reachedTarget).toBe(true);
    });

    it('turns a cross-block text selection into a block selection', () => {
      const harness = enabledHarness();

      harness.state.currentBlock = makeBlock('current');
      vi.mocked(harness.blok.CrossBlockSelection.selectBlocksOfTextSelection).mockReturnValue(true);

      const { event, reachedTarget } = harness.press(harness.inside, { key: 'Escape' });

      expect(harness.blok.BlockSelection.enableNavigationMode).not.toHaveBeenCalled();
      expect(harness.blok.Toolbar.close).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
      expect(reachedTarget).toBe(false);
    });

    it('enters navigation mode from inside the editor content', () => {
      const harness = enabledHarness();

      harness.state.currentBlock = makeBlock('current');

      const { event, reachedTarget } = harness.press(harness.inside, { key: 'Escape' });

      expect(harness.blok.BlockSelection.enableNavigationMode).toHaveBeenCalledTimes(1);
      expect(harness.blok.Toolbar.close).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
      expect(reachedTarget).toBe(false);
    });

    it('only closes the toolbar when the Escape came from outside the editor content', () => {
      const harness = enabledHarness();

      harness.state.currentBlock = makeBlock('current');

      const { event, reachedTarget } = harness.press(harness.outside, { key: 'Escape' });

      expect(harness.blok.BlockSelection.enableNavigationMode).not.toHaveBeenCalled();
      expect(harness.blok.Toolbar.close).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(false);
      expect(reachedTarget).toBe(true);
    });

    it('only closes the toolbar when there is no current block', () => {
      const harness = enabledHarness();

      harness.state.currentBlock = undefined;
      harness.press(harness.inside, { key: 'Escape' });

      expect(harness.blok.BlockSelection.enableNavigationMode).not.toHaveBeenCalled();
      expect(harness.blok.Toolbar.close).toHaveBeenCalledTimes(1);
    });

    it('leaves the Escape to the drag controller while a drag is in progress', () => {
      const harness = enabledHarness();

      harness.state.currentBlock = makeBlock('current');
      harness.state.isDragging = true;

      const { event, reachedTarget } = harness.press(harness.inside, { key: 'Escape' });

      expect(harness.blok.BlockSelection.enableNavigationMode).not.toHaveBeenCalled();
      expect(harness.blok.Toolbar.close).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(false);
      expect(reachedTarget).toBe(true);
    });
  });

  describe('Tab', () => {
    it('forwards Tab to the block pipeline and swallows it when blocks are selected', () => {
      const harness = enabledHarness();

      harness.state.anyBlockSelected = true;

      const { event, reachedTarget } = harness.press(harness.outside, { key: 'Tab' });

      expect(harness.blok.BlockEvents.keydown).toHaveBeenCalledWith(event);
      expect(event.defaultPrevented).toBe(true);
      expect(reachedTarget).toBe(false);
    });

    it('leaves Tab alone when nothing is selected', () => {
      const harness = enabledHarness();

      const { event, reachedTarget } = harness.press(harness.outside, { key: 'Tab' });

      expect(harness.blok.BlockEvents.keydown).not.toHaveBeenCalled();
      expect(harness.blok.BlockManager.unsetCurrentBlock).toHaveBeenCalledTimes(1);
      expect(harness.blok.Toolbar.close).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(false);
      expect(reachedTarget).toBe(true);
    });
  });

  describe('undo and redo', () => {
    it('undoes on Ctrl+Z and swallows the keystroke', () => {
      const harness = enabledHarness();

      const { event, reachedTarget } = harness.press(harness.outside, { key: 'z', ctrlKey: true });

      expect(harness.blok.YjsManager.undo).toHaveBeenCalledTimes(1);
      expect(harness.blok.YjsManager.redo).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
      expect(reachedTarget).toBe(false);
    });

    it('undoes on Cmd+Z', () => {
      const harness = enabledHarness();

      harness.press(harness.outside, { key: 'z', metaKey: true });

      expect(harness.blok.YjsManager.undo).toHaveBeenCalledTimes(1);
    });

    it('redoes on Ctrl+Shift+Z', () => {
      const harness = enabledHarness();

      harness.press(harness.outside, { key: 'z', ctrlKey: true, shiftKey: true });

      expect(harness.blok.YjsManager.redo).toHaveBeenCalledTimes(1);
      expect(harness.blok.YjsManager.undo).not.toHaveBeenCalled();
    });

    it('redoes on Ctrl+Shift+Z when the key arrives uppercased', () => {
      const harness = enabledHarness();

      harness.press(harness.outside, { key: 'Z', ctrlKey: true, shiftKey: true });

      expect(harness.blok.YjsManager.redo).toHaveBeenCalledTimes(1);
    });

    it('leaves an unmodified z to the rest of the pipeline', () => {
      const harness = enabledHarness();

      harness.press(harness.outside, { key: 'z' });

      expect(harness.blok.YjsManager.undo).not.toHaveBeenCalled();
      expect(harness.blok.BlockManager.unsetCurrentBlock).toHaveBeenCalledTimes(1);
    });

    it('swallows undo while a drag is in progress', () => {
      const harness = enabledHarness();

      harness.state.isDragging = true;

      const { event, reachedTarget } = harness.press(harness.outside, { key: 'z', ctrlKey: true });

      expect(harness.blok.YjsManager.undo).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
      expect(reachedTarget).toBe(false);
    });

    it('undoes once when one physical press emits two keydowns', () => {
      const harness = enabledHarness();

      harness.press(harness.outside, { key: 'z', ctrlKey: true });

      const repeat = harness.press(harness.outside, { key: 'z', ctrlKey: true });

      expect(harness.blok.YjsManager.undo).toHaveBeenCalledTimes(1);
      expect(repeat.event.defaultPrevented).toBe(true);
    });

    it('still redoes when Ctrl+Shift+Z immediately follows Ctrl+Z', () => {
      const harness = enabledHarness();

      harness.press(harness.outside, { key: 'z', ctrlKey: true });
      harness.press(harness.outside, { key: 'z', ctrlKey: true, shiftKey: true });

      expect(harness.blok.YjsManager.undo).toHaveBeenCalledTimes(1);
      expect(harness.blok.YjsManager.redo).toHaveBeenCalledTimes(1);
    });

    it('undoes again once the dedup window has fully elapsed', () => {
      vi.useFakeTimers();

      const harness = enabledHarness();

      harness.press(harness.outside, { key: 'z', ctrlKey: true });
      vi.advanceTimersByTime(50);
      harness.press(harness.outside, { key: 'z', ctrlKey: true });

      expect(harness.blok.YjsManager.undo).toHaveBeenCalledTimes(2);
    });

    it('redoes on the Ctrl+Y alias and swallows the keystroke', () => {
      const harness = enabledHarness();

      const { event, reachedTarget } = harness.press(harness.outside, { key: 'y', ctrlKey: true, code: 'KeyY' });

      expect(harness.blok.YjsManager.redo).toHaveBeenCalledTimes(1);
      expect(harness.blok.YjsManager.undo).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
      expect(reachedTarget).toBe(false);
    });

    it('redoes on Ctrl+Y when the key arrives uppercased', () => {
      const harness = enabledHarness();

      harness.press(harness.outside, { key: 'Y', ctrlKey: true, code: 'KeyY' });

      expect(harness.blok.YjsManager.redo).toHaveBeenCalledTimes(1);
    });

    it('leaves Ctrl+Shift+Y to the tool shortcut listener', () => {
      const harness = enabledHarness();

      const { event, reachedTarget } = harness.press(harness.outside, {
        key: 'y',
        code: 'KeyY',
        ctrlKey: true,
        shiftKey: true,
      });

      expect(harness.blok.YjsManager.redo).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
      expect(reachedTarget).toBe(true);
    });

    it('leaves an unmodified y to the rest of the pipeline', () => {
      const harness = enabledHarness();

      harness.press(harness.outside, { key: 'y', code: 'KeyY' });

      expect(harness.blok.YjsManager.redo).not.toHaveBeenCalled();
      expect(harness.blok.BlockManager.unsetCurrentBlock).toHaveBeenCalledTimes(1);
    });

    it('ignores Cmd+Y, which is not the redo alias', () => {
      const harness = enabledHarness();

      harness.press(harness.outside, { key: 'y', code: 'KeyY', metaKey: true });

      expect(harness.blok.YjsManager.redo).not.toHaveBeenCalled();
    });

    it('swallows the Ctrl+Y redo while a drag is in progress', () => {
      const harness = enabledHarness();

      harness.state.isDragging = true;

      const { event, reachedTarget } = harness.press(harness.outside, { key: 'y', code: 'KeyY', ctrlKey: true });

      expect(harness.blok.YjsManager.redo).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
      expect(reachedTarget).toBe(false);
    });

    it('redoes once when one physical Ctrl+Y press emits two keydowns', () => {
      const harness = enabledHarness();

      harness.press(harness.outside, { key: 'y', code: 'KeyY', ctrlKey: true });

      const repeat = harness.press(harness.outside, { key: 'y', code: 'KeyY', ctrlKey: true });

      expect(harness.blok.YjsManager.redo).toHaveBeenCalledTimes(1);
      expect(repeat.event.defaultPrevented).toBe(true);
    });

    it('still redoes when Ctrl+Y immediately follows an undo', () => {
      const harness = enabledHarness();

      harness.press(harness.outside, { key: 'z', ctrlKey: true });
      harness.press(harness.outside, { key: 'y', code: 'KeyY', ctrlKey: true });

      expect(harness.blok.YjsManager.redo).toHaveBeenCalledTimes(1);
    });

    it('redoes again once the Ctrl+Y dedup window has fully elapsed', () => {
      vi.useFakeTimers();

      const harness = enabledHarness();

      harness.press(harness.outside, { key: 'y', code: 'KeyY', ctrlKey: true });
      vi.advanceTimersByTime(50);
      harness.press(harness.outside, { key: 'y', code: 'KeyY', ctrlKey: true });

      expect(harness.blok.YjsManager.redo).toHaveBeenCalledTimes(2);
    });
  });

  describe('default key handling', () => {
    it('leaves typing inside the BlockSettings popover alone', () => {
      const harness = enabledHarness();

      vi.mocked(harness.blok.BlockSettings.contains).mockReturnValue(true);
      harness.press(harness.outside, { key: 'a' });

      expect(harness.blok.BlockManager.unsetCurrentBlock).not.toHaveBeenCalled();
    });

    it('forwards navigation-mode keys to the block pipeline', () => {
      const harness = enabledHarness();

      harness.state.navigationModeEnabled = true;

      const { event } = harness.press(harness.outside, { key: 'a' });

      expect(harness.blok.BlockEvents.keydown).toHaveBeenCalledWith(event);
      expect(harness.blok.BlockManager.unsetCurrentBlock).not.toHaveBeenCalled();
    });

    it('does not re-handle a navigation-mode key another listener already claimed', () => {
      const harness = createHarness();
      const claimKey = (event: Event): void => {
        event.preventDefault();
      };

      document.addEventListener('keydown', claimKey, true);
      harness.controller.enable();
      harness.state.navigationModeEnabled = true;

      try {
        harness.press(harness.outside, { key: 'a' });
      } finally {
        document.removeEventListener('keydown', claimKey, true);
      }

      expect(harness.blok.BlockEvents.keydown).not.toHaveBeenCalled();
      expect(harness.blok.BlockManager.unsetCurrentBlock).not.toHaveBeenCalled();
    });

    it('drops the current block and closes the toolbar for a key outside the editor', () => {
      const harness = enabledHarness();

      harness.press(harness.outside, { key: 'a' });

      expect(harness.blok.BlockEvents.keydown).not.toHaveBeenCalled();
      expect(harness.blok.BlockManager.unsetCurrentBlock).toHaveBeenCalledTimes(1);
      expect(harness.blok.Toolbar.close).toHaveBeenCalledTimes(1);
    });

    it('drops the current block for a modified key outside the editor', () => {
      const harness = enabledHarness();

      harness.press(harness.outside, { key: 'a', shiftKey: true });

      expect(harness.blok.BlockManager.unsetCurrentBlock).toHaveBeenCalledTimes(1);
    });

    it('treats a key outside the editor as a keydown on the current block', () => {
      const harness = enabledHarness();

      harness.state.currentBlock = makeBlock('current');

      const { event } = harness.press(harness.outside, { key: 'a' });

      expect(harness.blok.BlockEvents.keydown).toHaveBeenCalledWith(event);
      expect(harness.blok.BlockManager.unsetCurrentBlock).not.toHaveBeenCalled();
    });

    it('leaves a key typed inside the editor to the block that owns it', () => {
      const harness = enabledHarness();

      harness.state.currentBlock = makeBlock('current');
      harness.press(harness.inside, { key: 'a' });

      expect(harness.blok.BlockEvents.keydown).not.toHaveBeenCalled();
      expect(harness.blok.BlockManager.unsetCurrentBlock).not.toHaveBeenCalled();
    });

    it('keeps the caret alone for a key typed inside the editor with no current block', () => {
      const harness = enabledHarness();

      harness.press(harness.inside, { key: 'a' });

      expect(harness.blok.BlockManager.unsetCurrentBlock).not.toHaveBeenCalled();
      expect(harness.blok.Toolbar.close).not.toHaveBeenCalled();
    });
  });

  describe('keydown bubbling from a non-element target', () => {
    /**
     * `harness.press` only accepts elements. A keydown can also bubble out of a
     * Text node inside the redactor, and the handlers branch on
     * `target instanceof Element` / `target instanceof HTMLElement`, so the two
     * types must be told apart rather than treated as one.
     */
    const pressOnNode = (
      target: EventTarget,
      init: KeyboardEventInit = {}
    ): { event: KeyboardEvent; reachedLaterDocumentListener: boolean } => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      const laterDocumentCapture = vi.fn();

      document.addEventListener('keydown', laterDocumentCapture, true);

      try {
        target.dispatchEvent(event);
      } finally {
        document.removeEventListener('keydown', laterDocumentCapture, true);
      }

      return { event, reachedLaterDocumentListener: laterDocumentCapture.mock.calls.length > 0 };
    };

    it('does not enter navigation mode for an Escape whose target is a text node', () => {
      const harness = enabledHarness();
      const text = document.createTextNode('caret text');

      harness.state.currentBlock = makeBlock('current');
      harness.redactor.appendChild(text);

      const { event } = pressOnNode(text, { key: 'Escape' });

      expect(harness.blok.BlockSelection.enableNavigationMode).not.toHaveBeenCalled();
      expect(harness.blok.Toolbar.close).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(false);
    });

    it('leaves a keydown raised on a text node to the rest of the pipeline', () => {
      const harness = enabledHarness();
      const text = document.createTextNode('caret text');

      harness.redactor.appendChild(text);

      // A throw from inside a capture listener is swallowed by the DOM and
      // reported as an uncaught error instead, so it is invisible to
      // `not.toThrow()` and has to be observed on `window`.
      const uncaught = vi.fn();

      window.addEventListener('error', uncaught);

      try {
        pressOnNode(text, { key: 'Enter' });
      } finally {
        window.removeEventListener('error', uncaught);
      }

      expect(uncaught).not.toHaveBeenCalled();
      expect(harness.blok.BlockManager.insert).not.toHaveBeenCalled();
      expect(harness.blok.BlockSelection.clearSelection).toHaveBeenCalledTimes(1);
    });
  });
});
