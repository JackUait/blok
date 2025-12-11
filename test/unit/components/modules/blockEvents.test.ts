import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BlockEvents from '../../../../src/components/modules/blockEvents';
import EventsDispatcher from '../../../../src/components/utils/events';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import type { BlokConfig } from '../../../../types';
import type { BlokEventMap } from '../../../../src/components/events';
import type Block from '../../../../src/components/block';
import SelectionUtils from '../../../../src/components/selection';
import * as caretUtils from '../../../../src/components/utils/caret';
import * as blocksUtils from '../../../../src/components/utils/blocks';
import { keyCodes } from '../../../../src/components/utils';

const KEY_CODE_TO_KEY_MAP: Record<number, string> = {
  [keyCodes.BACKSPACE]: 'Backspace',
  [keyCodes.DELETE]: 'Delete',
  [keyCodes.DOWN]: 'ArrowDown',
  [keyCodes.ENTER]: 'Enter',
  [keyCodes.LEFT]: 'ArrowLeft',
  [keyCodes.RIGHT]: 'ArrowRight',
  [keyCodes.SLASH]: '/',
  [keyCodes.TAB]: 'Tab',
  [keyCodes.UP]: 'ArrowUp',
};

const createBlockEvents = (overrides: Partial<BlokModules> = {}): BlockEvents => {
  const blockEvents = new BlockEvents({
    config: {} as BlokConfig,
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  });

  const wrapper = document.createElement('div');

  const defaults: Partial<BlokModules> = {
    Toolbar: {
      opened: false,
      close: vi.fn(),
      moveAndOpen: vi.fn(),
      toolbox: {
        open: vi.fn(),
      },
    } as unknown as BlokModules['Toolbar'],
    BlockSelection: {
      anyBlockSelected: false,
      clearSelection: vi.fn(),
      copySelectedBlocks: vi.fn(() => Promise.resolve()),
      selectedBlocks: [],
    } as unknown as BlokModules['BlockSelection'],
    InlineToolbar: {
      opened: false,
      tryToShow: vi.fn(async () => undefined),
      close: vi.fn(),
    } as unknown as BlokModules['InlineToolbar'],
    BlockManager: {
      currentBlock: undefined,
      currentBlockIndex: 0,
      previousBlock: null,
      nextBlock: null,
      getBlockByChildNode: vi.fn(),
      insertDefaultBlockAtIndex: vi.fn(),
      removeBlock: vi.fn(),
      removeSelectedBlocks: vi.fn(),
      split: vi.fn(),
    } as unknown as BlokModules['BlockManager'],
    Caret: {
      navigateNext: vi.fn(() => false),
      navigatePrevious: vi.fn(() => false),
      navigateVerticalNext: vi.fn(() => false),
      navigateVerticalPrevious: vi.fn(() => false),
      setToBlock: vi.fn(),
      insertContentAtCaretPosition: vi.fn(),
      positions: {
        START: 'start-position',
        END: 'end-position',
      },
    } as unknown as BlokModules['Caret'],
    UI: {
      nodes: {
        wrapper,
      },
      someToolbarOpened: false,
      someFlipperButtonFocused: false,
      checkEmptiness: vi.fn(),
      closeAllToolbars: vi.fn(),
    } as unknown as BlokModules['UI'],
    BlockSettings: {
      opened: false,
      open: vi.fn(),
      contains: vi.fn(() => false),
    } as unknown as BlokModules['BlockSettings'],
    CrossBlockSelection: {
      toggleBlockSelectedState: vi.fn(),
    } as unknown as BlokModules['CrossBlockSelection'],
  };

  const mergedState: Partial<BlokModules> = { ...defaults };

  for (const [moduleName, moduleOverrides] of Object.entries(overrides) as Array<[keyof BlokModules, unknown]>) {
    const defaultModule = defaults[moduleName];

    if (
      defaultModule !== undefined &&
      defaultModule !== null &&
      typeof defaultModule === 'object' &&
      moduleOverrides !== null &&
      typeof moduleOverrides === 'object'
    ) {
      (mergedState as Record<keyof BlokModules, BlokModules[keyof BlokModules]>)[moduleName] = {
        ...(defaultModule as object),
        ...(moduleOverrides as object),
      } as BlokModules[typeof moduleName];
    } else if (moduleOverrides !== undefined) {
      (mergedState as Record<keyof BlokModules, BlokModules[keyof BlokModules]>)[moduleName] = moduleOverrides as BlokModules[typeof moduleName];
    }
  }

  blockEvents.state = mergedState as BlokModules;

  return blockEvents;
};

const createKeyboardEvent = (options: Partial<KeyboardEvent>): KeyboardEvent => {
  let derivedKey: string;

  if (options.key !== undefined) {
    derivedKey = options.key;
  } else if (options.keyCode !== undefined) {
    derivedKey = KEY_CODE_TO_KEY_MAP[options.keyCode] ?? String.fromCharCode(options.keyCode);
  } else {
    derivedKey = '';
  }
  const derivedCode = options.code !== undefined ? options.code : derivedKey;
  const derivedKeyCode = options.keyCode ?? 0;

  return {
    keyCode: derivedKeyCode,
    key: derivedKey,
    code: derivedCode,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    target: document.createElement('div'),
    ...options,
  } as KeyboardEvent;
};


beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BlockEvents', () => {
  describe('keyup', () => {
    it('calls UI.checkEmptiness when Shift is not pressed', () => {
      const checkEmptiness = vi.fn();
      const blockEvents = createBlockEvents({
        UI: {
          checkEmptiness,
        } as unknown as BlokModules['UI'],
      });

      blockEvents.keyup(createKeyboardEvent({ shiftKey: false }));

      expect(checkEmptiness).toHaveBeenCalledTimes(1);
    });

    it('skips UI.checkEmptiness when Shift is pressed', () => {
      const checkEmptiness = vi.fn();
      const blockEvents = createBlockEvents({
        UI: {
          checkEmptiness,
        } as unknown as BlokModules['UI'],
      });

      blockEvents.keyup(createKeyboardEvent({ shiftKey: true }));

      expect(checkEmptiness).not.toHaveBeenCalled();
    });
  });


  describe('handleCommandC', () => {
    it('copies selected blocks when any block is selected', () => {
      const copySelectedBlocks = vi.fn();
      const blockEvents = createBlockEvents({
        BlockSelection: {
          anyBlockSelected: true,
          copySelectedBlocks,
        } as unknown as BlokModules['BlockSelection'],
      });
      const event = new Event('copy') as ClipboardEvent;

      blockEvents.handleCommandC(event);

      expect(copySelectedBlocks).toHaveBeenCalledWith(event);
    });

    it('does nothing when no blocks are selected', () => {
      const copySelectedBlocks = vi.fn();
      const blockEvents = createBlockEvents({
        BlockSelection: {
          anyBlockSelected: false,
          copySelectedBlocks,
        } as unknown as BlokModules['BlockSelection'],
      });

      blockEvents.handleCommandC(new Event('copy') as ClipboardEvent);

      expect(copySelectedBlocks).not.toHaveBeenCalled();
    });
  });

  describe('handleCommandX', () => {
    it('cuts selected blocks and restores caret position', async () => {
      const copySelectedBlocks = vi.fn().mockResolvedValue(undefined);
      const removeSelectedBlocks = vi.fn().mockReturnValue(3);
      const insertDefaultBlockAtIndex = vi.fn().mockReturnValue({} as Block);
      const clearSelection = vi.fn();
      const setToBlock = vi.fn();

      const blockEvents = createBlockEvents({
        BlockSelection: {
          anyBlockSelected: true,
          copySelectedBlocks,
          clearSelection,
        } as unknown as BlokModules['BlockSelection'],
        BlockManager: {
          removeSelectedBlocks,
          insertDefaultBlockAtIndex,
        } as unknown as BlokModules['BlockManager'],
        Caret: {
          setToBlock,
          positions: {
            START: 'start-position',
          },
        } as unknown as BlokModules['Caret'],
      });
      const event = new Event('cut') as ClipboardEvent;

      blockEvents.handleCommandX(event);
      await copySelectedBlocks.mock.results[0]!.value;
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(copySelectedBlocks).toHaveBeenCalledWith(event);
      expect(removeSelectedBlocks).toHaveBeenCalledTimes(1);
      expect(insertDefaultBlockAtIndex).toHaveBeenCalledWith(3, true);
      expect(setToBlock).toHaveBeenCalledWith(insertDefaultBlockAtIndex.mock.results[0]!.value, 'start-position');
      expect(clearSelection).toHaveBeenCalledWith(event);
    });

    it('does nothing when there is no block selection', () => {
      const copySelectedBlocks = vi.fn().mockResolvedValue(undefined);
      const blockEvents = createBlockEvents({
        BlockSelection: {
          anyBlockSelected: false,
          copySelectedBlocks,
        } as unknown as BlokModules['BlockSelection'],
      });

      blockEvents.handleCommandX(new Event('cut') as ClipboardEvent);

      expect(copySelectedBlocks).not.toHaveBeenCalled();
    });
  });

  describe('keydown', () => {
    const handlers: Array<{ keyCode: number; handler: 'backspace' | 'delete' | 'enter' | 'arrowRightAndDown' | 'arrowLeftAndUp' | 'tabPressed' }> = [
      { keyCode: keyCodes.BACKSPACE,
        handler: 'backspace' },
      { keyCode: keyCodes.DELETE,
        handler: 'delete' },
      { keyCode: keyCodes.ENTER,
        handler: 'enter' },
      { keyCode: keyCodes.DOWN,
        handler: 'arrowRightAndDown' },
      { keyCode: keyCodes.RIGHT,
        handler: 'arrowRightAndDown' },
      { keyCode: keyCodes.UP,
        handler: 'arrowLeftAndUp' },
      { keyCode: keyCodes.LEFT,
        handler: 'arrowLeftAndUp' },
      { keyCode: keyCodes.TAB,
        handler: 'tabPressed' },
    ];

    it.each(handlers)('delegates keyCode %s to %s', ({ keyCode, handler }) => {
      const blockEvents = createBlockEvents();
      const spy = vi
        .spyOn(blockEvents as unknown as Record<typeof handler, (event: KeyboardEvent) => void>, handler)
        .mockImplementation(() => undefined);
      const event = createKeyboardEvent({ keyCode });

      blockEvents.keydown(event);

      expect(spy).toHaveBeenCalledWith(event);
    });

    it('calls slashPressed when "/" is typed without modifiers', () => {
      const blockEvents = createBlockEvents();
      const slashSpy = vi
        .spyOn(blockEvents as unknown as { slashPressed: (event: KeyboardEvent) => void }, 'slashPressed')
        .mockImplementation(() => undefined);
      const event = createKeyboardEvent({ keyCode: keyCodes.SLASH,
        key: '/' });

      blockEvents.keydown(event);

      expect(slashSpy).toHaveBeenCalledWith(event);
    });

    it('skips slashPressed when modifier key is pressed', () => {
      const blockEvents = createBlockEvents();
      const slashSpy = vi
        .spyOn(blockEvents as unknown as { slashPressed: (event: KeyboardEvent) => void }, 'slashPressed')
        .mockImplementation(() => undefined);
      const event = createKeyboardEvent({ keyCode: keyCodes.SLASH,
        key: '/',
        ctrlKey: true });

      blockEvents.keydown(event);

      expect(slashSpy).not.toHaveBeenCalled();
    });

    it('activates command slash when Slash code is used with control modifier', () => {
      const blockEvents = createBlockEvents();
      const commandSpy = vi
        .spyOn(blockEvents as unknown as { commandSlashPressed: () => void }, 'commandSlashPressed')
        .mockImplementation(() => undefined);
      const event = createKeyboardEvent({ code: 'Slash',
        ctrlKey: true });

      blockEvents.keydown(event);

      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(commandSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('tabPressed', () => {
    it('skips navigation when inline toolbar is open', () => {
      const navigateNext = vi.fn();
      const blockEvents = createBlockEvents({
        InlineToolbar: {
          opened: true,
        } as unknown as BlokModules['InlineToolbar'],
        Caret: {
          navigateNext,
        } as unknown as BlokModules['Caret'],
      });
      const event = createKeyboardEvent({ keyCode: keyCodes.TAB });

      (blockEvents as unknown as { tabPressed: (event: KeyboardEvent) => void }).tabPressed(event);

      expect(navigateNext).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('prevents default when navigation succeeds', () => {
      const navigateNext = vi.fn().mockReturnValue(true);
      const blockEvents = createBlockEvents({
        Caret: {
          navigateNext,
        } as unknown as BlokModules['Caret'],
      });
      const event = createKeyboardEvent({ keyCode: keyCodes.TAB });

      (blockEvents as unknown as { tabPressed: (event: KeyboardEvent) => void }).tabPressed(event);

      expect(navigateNext).toHaveBeenCalledWith(true);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
    });

    it('navigates to previous input on Shift+Tab', () => {
      const navigatePrevious = vi.fn().mockReturnValue(true);
      const blockEvents = createBlockEvents({
        Caret: {
          navigatePrevious,
        } as unknown as BlokModules['Caret'],
      });
      const event = createKeyboardEvent({ keyCode: keyCodes.TAB,
        shiftKey: true });

      (blockEvents as unknown as { tabPressed: (event: KeyboardEvent) => void }).tabPressed(event);

      expect(navigatePrevious).toHaveBeenCalledWith(true);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
    });
  });

  describe('slashPressed', () => {
    it('ignores events fired outside the blok wrapper', () => {
      const insertContentAtCaretPosition = vi.fn();
      const blockEvents = createBlockEvents({
        Caret: {
          insertContentAtCaretPosition,
        } as unknown as BlokModules['Caret'],
      });
      const event = createKeyboardEvent({
        keyCode: keyCodes.SLASH,
        key: '/',
        target: document.createElement('div'),
      });

      (blockEvents as unknown as { slashPressed: (event: KeyboardEvent) => void }).slashPressed(event);

      expect(insertContentAtCaretPosition).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('opens toolbox for empty block inside blok', () => {
      const insertContentAtCaretPosition = vi.fn();
      const currentBlock = {
        isEmpty: true,
      } as unknown as Block;
      const wrapper = document.createElement('div');
      const target = document.createElement('div');

      wrapper.appendChild(target);
      document.body.appendChild(wrapper);
      const blockEvents = createBlockEvents({
        Caret: {
          insertContentAtCaretPosition,
        } as unknown as BlokModules['Caret'],
        BlockManager: {
          currentBlock,
        } as unknown as BlokModules['BlockManager'],
        UI: {
          nodes: {
            wrapper,
          },
        } as unknown as BlokModules['UI'],
      });
      const activateSpy = vi
        .spyOn(blockEvents as unknown as { activateToolbox: () => void }, 'activateToolbox')
        .mockImplementation(() => undefined);
      const event = createKeyboardEvent({
        keyCode: keyCodes.SLASH,
        key: '/',
        target,
      });

      (blockEvents as unknown as { slashPressed: (event: KeyboardEvent) => void }).slashPressed(event);

      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(insertContentAtCaretPosition).toHaveBeenCalledWith('/');
      expect(activateSpy).toHaveBeenCalledTimes(1);

      wrapper.remove();
    });

    it('does nothing when current block is not empty', () => {
      const insertContentAtCaretPosition = vi.fn();
      const currentBlock = {
        isEmpty: false,
      } as unknown as Block;
      const wrapper = document.createElement('div');
      const target = document.createElement('div');

      wrapper.appendChild(target);
      document.body.appendChild(wrapper);
      const blockEvents = createBlockEvents({
        Caret: {
          insertContentAtCaretPosition,
        } as unknown as BlokModules['Caret'],
        BlockManager: {
          currentBlock,
        } as unknown as BlokModules['BlockManager'],
        UI: {
          nodes: {
            wrapper,
          },
        } as unknown as BlokModules['UI'],
      });
      const activateSpy = vi
        .spyOn(blockEvents as unknown as { activateToolbox: () => void }, 'activateToolbox')
        .mockImplementation(() => undefined);
      const event = createKeyboardEvent({
        keyCode: keyCodes.SLASH,
        key: '/',
        target,
      });

      (blockEvents as unknown as { slashPressed: (event: KeyboardEvent) => void }).slashPressed(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(insertContentAtCaretPosition).not.toHaveBeenCalled();
      expect(activateSpy).not.toHaveBeenCalled();

      wrapper.remove();
    });
  });

  describe('enter', () => {
    it('returns early when line breaks are enabled', () => {
      const moveAndOpen = vi.fn();
      const currentBlock = {
        tool: {
          isLineBreaksEnabled: true,
        },
      } as unknown as Block;
      const blockEvents = createBlockEvents({
        Toolbar: {
          moveAndOpen,
        } as unknown as BlokModules['Toolbar'],
        BlockManager: {
          currentBlock,
        } as unknown as BlokModules['BlockManager'],
      });
      const event = createKeyboardEvent({ keyCode: keyCodes.ENTER });

      (blockEvents as unknown as { enter: (event: KeyboardEvent) => void }).enter(event);

      expect(moveAndOpen).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('inserts a new block when caret is at the end of the block', () => {
      const moveAndOpen = vi.fn();
      const setToBlock = vi.fn();
      const insertDefaultBlockAtIndex = vi.fn().mockReturnValue({ id: 'inserted' } as unknown as Block);
      const currentInput = document.createElement('div');
      const currentBlock = {
        tool: {
          isLineBreaksEnabled: false,
        },
        currentInput,
        hasMedia: false,
      } as unknown as Block;

      vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(false);
      vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);
      const blockEvents = createBlockEvents({
        Toolbar: {
          moveAndOpen,
        } as unknown as BlokModules['Toolbar'],
        BlockManager: {
          currentBlock,
          currentBlockIndex: 2,
          insertDefaultBlockAtIndex,
        } as unknown as BlokModules['BlockManager'],
        Caret: {
          setToBlock,
          positions: {
            START: 'start-position',
            END: 'end-position',
          },
        } as unknown as BlokModules['Caret'],
      });
      const event = createKeyboardEvent({ keyCode: keyCodes.ENTER });

      (blockEvents as unknown as { enter: (event: KeyboardEvent) => void }).enter(event);

      expect(insertDefaultBlockAtIndex).toHaveBeenCalledWith(3);
      expect(setToBlock).toHaveBeenCalledWith(insertDefaultBlockAtIndex.mock.results[0]!.value);
      expect(moveAndOpen).toHaveBeenCalledWith(insertDefaultBlockAtIndex.mock.results[0]!.value);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
    });
  });

  describe('backspace', () => {
    it('returns early when selection is not collapsed', () => {
      vi.spyOn(SelectionUtils, 'isCollapsed', 'get').mockReturnValue(false);
      const blockEvents = createBlockEvents();
      const event = createKeyboardEvent({ keyCode: keyCodes.BACKSPACE });

      (blockEvents as unknown as { backspace: (event: KeyboardEvent) => void }).backspace(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('merges blocks when previous block is mergeable', () => {
      const toolbarClose = vi.fn();
      const mergeableInput = document.createElement('div');
      const currentBlock = {
        currentInput: mergeableInput,
        firstInput: mergeableInput,
        isEmpty: false,
        hasMedia: false,
      } as unknown as Block;
      const previousBlock = {
        isEmpty: false,
      } as unknown as Block;

      vi.spyOn(SelectionUtils, 'isCollapsed', 'get').mockReturnValue(true);
      vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);
      vi.spyOn(blocksUtils, 'areBlocksMergeable').mockReturnValue(true);
      const blockEvents = createBlockEvents({
        Toolbar: {
          close: toolbarClose,
        } as unknown as BlokModules['Toolbar'],
        BlockManager: {
          currentBlock,
          previousBlock,
        } as unknown as BlokModules['BlockManager'],
      });
      const mergeSpy = vi
        .spyOn(blockEvents as unknown as { mergeBlocks: (target: Block, source: Block) => void }, 'mergeBlocks')
        .mockImplementation(() => undefined);
      const event = createKeyboardEvent({ keyCode: keyCodes.BACKSPACE });

      (blockEvents as unknown as { backspace: (event: KeyboardEvent) => void }).backspace(event);

      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(toolbarClose).toHaveBeenCalledTimes(1);
      expect(mergeSpy).toHaveBeenCalledWith(previousBlock, currentBlock);
    });
  });

  describe('delete', () => {
    it('merges with next block when mergeable', () => {
      const toolbarClose = vi.fn();
      const mergeableInput = document.createElement('div');
      const currentBlock = {
        currentInput: mergeableInput,
        lastInput: mergeableInput,
        isEmpty: false,
      } as unknown as Block;
      const nextBlock = {
        isEmpty: false,
      } as unknown as Block;

      vi.spyOn(SelectionUtils, 'isCollapsed', 'get').mockReturnValue(true);
      vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);
      vi.spyOn(blocksUtils, 'areBlocksMergeable').mockReturnValue(true);
      const blockEvents = createBlockEvents({
        Toolbar: {
          close: toolbarClose,
        } as unknown as BlokModules['Toolbar'],
        BlockManager: {
          currentBlock,
          nextBlock,
        } as unknown as BlokModules['BlockManager'],
      });
      const mergeSpy = vi
        .spyOn(blockEvents as unknown as { mergeBlocks: (target: Block, source: Block) => void }, 'mergeBlocks')
        .mockImplementation(() => undefined);
      const event = createKeyboardEvent({ keyCode: keyCodes.DELETE });

      (blockEvents as unknown as { delete: (event: KeyboardEvent) => void }).delete(event);

      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(toolbarClose).toHaveBeenCalledTimes(1);
      expect(mergeSpy).toHaveBeenCalledWith(currentBlock, nextBlock);
    });
  });

  describe('arrowRightAndDown', () => {
    it('returns early when toolbar handles the key combination', () => {
      const toolbarClose = vi.fn();
      const blockEvents = createBlockEvents({
        UI: {
          someToolbarOpened: true,
        } as unknown as BlokModules['UI'],
        Toolbar: {
          close: toolbarClose,
        } as unknown as BlokModules['Toolbar'],
      });
      const event = createKeyboardEvent({ keyCode: keyCodes.DOWN });

      (blockEvents as unknown as { arrowRightAndDown: (event: KeyboardEvent) => void }).arrowRightAndDown(event);

      expect(toolbarClose).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('toggles cross-block selection when extending selection with Shift+Down', () => {
      const toggleBlockSelectedState = vi.fn();
      const blockEvents = createBlockEvents({
        BlockSelection: {
          anyBlockSelected: true,
        } as unknown as BlokModules['BlockSelection'],
        CrossBlockSelection: {
          toggleBlockSelectedState,
        } as unknown as BlokModules['CrossBlockSelection'],
      });
      const event = createKeyboardEvent({ keyCode: keyCodes.DOWN,
        shiftKey: true });

      (blockEvents as unknown as { arrowRightAndDown: (event: KeyboardEvent) => void }).arrowRightAndDown(event);

      expect(toggleBlockSelectedState).toHaveBeenCalledTimes(1);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('prevents default when vertical caret navigation succeeds for DOWN key', () => {
      const toolbarClose = vi.fn();
      const navigateVerticalNext = vi.fn().mockReturnValue(true);
      const clearSelection = vi.fn();
      const blockEvents = createBlockEvents({
        Toolbar: {
          close: toolbarClose,
        } as unknown as BlokModules['Toolbar'],
        Caret: {
          navigateVerticalNext,
        } as unknown as BlokModules['Caret'],
        BlockSelection: {
          clearSelection,
        } as unknown as BlokModules['BlockSelection'],
      });
      const event = createKeyboardEvent({ keyCode: keyCodes.DOWN });

      (blockEvents as unknown as { arrowRightAndDown: (event: KeyboardEvent) => void }).arrowRightAndDown(event);

      expect(toolbarClose).toHaveBeenCalledTimes(1);
      expect(navigateVerticalNext).toHaveBeenCalledTimes(1);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(clearSelection).not.toHaveBeenCalled();
    });

    it('prevents default when horizontal caret navigation succeeds for RIGHT key', () => {
      const toolbarClose = vi.fn();
      const navigateNext = vi.fn().mockReturnValue(true);
      const clearSelection = vi.fn();
      const blockEvents = createBlockEvents({
        Toolbar: {
          close: toolbarClose,
        } as unknown as BlokModules['Toolbar'],
        Caret: {
          navigateNext,
        } as unknown as BlokModules['Caret'],
        BlockSelection: {
          clearSelection,
        } as unknown as BlokModules['BlockSelection'],
      });
      const event = createKeyboardEvent({ keyCode: keyCodes.RIGHT });

      (blockEvents as unknown as { arrowRightAndDown: (event: KeyboardEvent) => void }).arrowRightAndDown(event);

      expect(toolbarClose).toHaveBeenCalledTimes(1);
      expect(navigateNext).toHaveBeenCalledTimes(1);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(clearSelection).not.toHaveBeenCalled();
    });
  });

  describe('arrowLeftAndUp', () => {
    it('returns early when toolbar is opened and handles the key', () => {
      const closeAllToolbars = vi.fn();
      const blockEvents = createBlockEvents({
        UI: {
          someToolbarOpened: true,
          closeAllToolbars,
        } as unknown as BlokModules['UI'],
      });
      const event = createKeyboardEvent({ keyCode: keyCodes.LEFT });

      (blockEvents as unknown as { arrowLeftAndUp: (event: KeyboardEvent) => void }).arrowLeftAndUp(event);

      expect(closeAllToolbars).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('toggles cross-block selection when extending selection with Shift+Up', () => {
      const toggleBlockSelectedState = vi.fn();
      const blockEvents = createBlockEvents({
        BlockSelection: {
          anyBlockSelected: true,
        } as unknown as BlokModules['BlockSelection'],
        CrossBlockSelection: {
          toggleBlockSelectedState,
        } as unknown as BlokModules['CrossBlockSelection'],
      });
      const event = createKeyboardEvent({ keyCode: keyCodes.UP,
        shiftKey: true });

      (blockEvents as unknown as { arrowLeftAndUp: (event: KeyboardEvent) => void }).arrowLeftAndUp(event);

      expect(toggleBlockSelectedState).toHaveBeenCalledWith(false);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('prevents default when vertical navigation succeeds for UP key', () => {
      const toolbarClose = vi.fn();
      const navigateVerticalPrevious = vi.fn().mockReturnValue(true);
      const clearSelection = vi.fn();
      const blockEvents = createBlockEvents({
        Toolbar: {
          close: toolbarClose,
        } as unknown as BlokModules['Toolbar'],
        Caret: {
          navigateVerticalPrevious,
        } as unknown as BlokModules['Caret'],
        BlockSelection: {
          clearSelection,
        } as unknown as BlokModules['BlockSelection'],
      });
      const event = createKeyboardEvent({ keyCode: keyCodes.UP });

      (blockEvents as unknown as { arrowLeftAndUp: (event: KeyboardEvent) => void }).arrowLeftAndUp(event);

      expect(toolbarClose).toHaveBeenCalledTimes(1);
      expect(navigateVerticalPrevious).toHaveBeenCalledTimes(1);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(clearSelection).not.toHaveBeenCalled();
    });

    it('prevents default when horizontal navigation succeeds for LEFT key', () => {
      const toolbarClose = vi.fn();
      const navigatePrevious = vi.fn().mockReturnValue(true);
      const clearSelection = vi.fn();
      const blockEvents = createBlockEvents({
        Toolbar: {
          close: toolbarClose,
        } as unknown as BlokModules['Toolbar'],
        Caret: {
          navigatePrevious,
        } as unknown as BlokModules['Caret'],
        BlockSelection: {
          clearSelection,
        } as unknown as BlokModules['BlockSelection'],
      });
      const event = createKeyboardEvent({ keyCode: keyCodes.LEFT });

      (blockEvents as unknown as { arrowLeftAndUp: (event: KeyboardEvent) => void }).arrowLeftAndUp(event);

      expect(toolbarClose).toHaveBeenCalledTimes(1);
      expect(navigatePrevious).toHaveBeenCalledTimes(1);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(clearSelection).not.toHaveBeenCalled();
    });
  });

  describe('commandSlashPressed', () => {
    it('activates block settings when a single block is selected', () => {
      const blockEvents = createBlockEvents({
        BlockSelection: {
          selectedBlocks: [ {} ],
        } as unknown as BlokModules['BlockSelection'],
      });
      const activateSpy = vi
        .spyOn(blockEvents as unknown as { activateBlockSettings: () => void }, 'activateBlockSettings')
        .mockImplementation(() => undefined);

      (blockEvents as unknown as { commandSlashPressed: () => void }).commandSlashPressed();

      expect(activateSpy).toHaveBeenCalledTimes(1);
    });

    it('skips activation when multiple blocks are selected', () => {
      const blockEvents = createBlockEvents({
        BlockSelection: {
          selectedBlocks: [ {}, {} ],
        } as unknown as BlokModules['BlockSelection'],
      });
      const activateSpy = vi
        .spyOn(blockEvents as unknown as { activateBlockSettings: () => void }, 'activateBlockSettings')
        .mockImplementation(() => undefined);

      (blockEvents as unknown as { commandSlashPressed: () => void }).commandSlashPressed();

      expect(activateSpy).not.toHaveBeenCalled();
    });
  });

  describe('needToolbarClosing', () => {
    const createToolbarMocks = (): Partial<BlokModules> => ({
      Toolbar: {
        toolbox: {
          opened: false,
        },
      } as unknown as BlokModules['Toolbar'],
      BlockSettings: {
        opened: false,
      } as unknown as BlokModules['BlockSettings'],
      InlineToolbar: {
        opened: false,
      } as unknown as BlokModules['InlineToolbar'],
    });

    it('returns false when Shift is pressed', () => {
      const blockEvents = createBlockEvents(createToolbarMocks() as Partial<BlokModules>);
      const event = createKeyboardEvent({ shiftKey: true });

      const result = (blockEvents as unknown as { needToolbarClosing: (event: KeyboardEvent) => boolean })
        .needToolbarClosing(event);

      expect(result).toBe(false);
    });

    it('returns false when Tab is pressed', () => {
      const blockEvents = createBlockEvents(createToolbarMocks() as Partial<BlokModules>);
      const event = createKeyboardEvent({ keyCode: 9 });

      const result = (blockEvents as unknown as { needToolbarClosing: (event: KeyboardEvent) => boolean })
        .needToolbarClosing(event);

      expect(result).toBe(false);
    });

    it('returns false when toolbox item is selected and Enter pressed', () => {
      const blockEvents = createBlockEvents({
        Toolbar: {
          toolbox: {
            opened: true,
          },
        },
        BlockSettings: {
          opened: false,
        },
        InlineToolbar: {
          opened: false,
        },
      } as Partial<BlokModules>);
      const event = createKeyboardEvent({ keyCode: 13 });

      const result = (blockEvents as unknown as { needToolbarClosing: (event: KeyboardEvent) => boolean })
        .needToolbarClosing(event);

      expect(result).toBe(false);
    });

    it('returns true when none of the skip conditions met', () => {
      const blockEvents = createBlockEvents(createToolbarMocks() as Partial<BlokModules>);
      const event = createKeyboardEvent({ keyCode: 65 });

      const result = (blockEvents as unknown as { needToolbarClosing: (event: KeyboardEvent) => boolean })
        .needToolbarClosing(event);

      expect(result).toBe(true);
    });
  });

  describe('beforeKeydownProcessing', () => {
    it('closes toolbar and clears selection for printable keys without modifiers', () => {
      const close = vi.fn();
      const clearSelection = vi.fn();
      const blockEvents = createBlockEvents({
        Toolbar: {
          close,
        } as unknown as BlokModules['Toolbar'],
        BlockSelection: {
          clearSelection,
        } as unknown as BlokModules['BlockSelection'],
      });
      const event = createKeyboardEvent({ keyCode: 65 });

      vi.spyOn(blockEvents as unknown as { needToolbarClosing: (event: KeyboardEvent) => boolean }, 'needToolbarClosing')
        .mockReturnValue(true);

      blockEvents.beforeKeydownProcessing(event);

      expect(close).toHaveBeenCalledTimes(1);
      expect(clearSelection).toHaveBeenCalledWith(event);
    });

    it('keeps selection when shortcut modifier is pressed', () => {
      const close = vi.fn();
      const clearSelection = vi.fn();
      const blockEvents = createBlockEvents({
        Toolbar: {
          close,
        } as unknown as BlokModules['Toolbar'],
        BlockSelection: {
          clearSelection,
        } as unknown as BlokModules['BlockSelection'],
      });
      const event = createKeyboardEvent({ keyCode: 65,
        ctrlKey: true });

      vi.spyOn(blockEvents as unknown as { needToolbarClosing: (event: KeyboardEvent) => boolean }, 'needToolbarClosing')
        .mockReturnValue(true);

      blockEvents.beforeKeydownProcessing(event);

      expect(close).toHaveBeenCalledTimes(1);
      expect(clearSelection).not.toHaveBeenCalled();
    });

    it('skips processing when toolbar should not be closed', () => {
      const close = vi.fn();
      const clearSelection = vi.fn();
      const blockEvents = createBlockEvents({
        Toolbar: {
          close,
        } as unknown as BlokModules['Toolbar'],
        BlockSelection: {
          clearSelection,
        } as unknown as BlokModules['BlockSelection'],
      });

      vi.spyOn(blockEvents as unknown as { needToolbarClosing: (event: KeyboardEvent) => boolean }, 'needToolbarClosing')
        .mockReturnValue(false);

      blockEvents.beforeKeydownProcessing(createKeyboardEvent({ keyCode: 65 }));

      expect(close).not.toHaveBeenCalled();
      expect(clearSelection).not.toHaveBeenCalled();
    });
  });

  describe('activateToolbox', () => {
    it('opens toolbar when it is closed', () => {
      const moveAndOpen = vi.fn();
      const open = vi.fn();
      const toolbar = {
        opened: false,
        moveAndOpen,
        toolbox: {
          open,
        },
      };
      const blockEvents = createBlockEvents({
        Toolbar: toolbar as unknown as BlokModules['Toolbar'],
      });

      (blockEvents as unknown as { activateToolbox: () => void }).activateToolbox();

      expect(moveAndOpen).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledTimes(1);
    });

    it('skips moveAndOpen when toolbar already opened', () => {
      const moveAndOpen = vi.fn();
      const open = vi.fn();
      const toolbar = {
        opened: true,
        moveAndOpen,
        toolbox: {
          open,
        },
      };
      const blockEvents = createBlockEvents({
        Toolbar: toolbar as unknown as BlokModules['Toolbar'],
      });

      (blockEvents as unknown as { activateToolbox: () => void }).activateToolbox();

      expect(moveAndOpen).not.toHaveBeenCalled();
      expect(open).toHaveBeenCalledTimes(1);
    });
  });

  describe('activateBlockSettings', () => {
    it('opens toolbar and block settings when closed', () => {
      const moveAndOpen = vi.fn();
      const open = vi.fn();
      const blockEvents = createBlockEvents({
        Toolbar: {
          opened: false,
          moveAndOpen,
        } as unknown as BlokModules['Toolbar'],
        BlockSettings: {
          opened: false,
          open,
        } as unknown as BlokModules['BlockSettings'],
      });

      (blockEvents as unknown as { activateBlockSettings: () => void }).activateBlockSettings();

      expect(moveAndOpen).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledTimes(1);
    });

    it('skips reopening toolbar when it is already opened', () => {
      const moveAndOpen = vi.fn();
      const open = vi.fn();
      const blockEvents = createBlockEvents({
        Toolbar: {
          opened: true,
          moveAndOpen,
        } as unknown as BlokModules['Toolbar'],
        BlockSettings: {
          opened: false,
          open,
        } as unknown as BlokModules['BlockSettings'],
      });

      (blockEvents as unknown as { activateBlockSettings: () => void }).activateBlockSettings();

      expect(moveAndOpen).not.toHaveBeenCalled();
      expect(open).toHaveBeenCalledTimes(1);
    });

    it('does not reopen block settings when already opened', () => {
      const moveAndOpen = vi.fn();
      const open = vi.fn();
      const blockEvents = createBlockEvents({
        Toolbar: {
          opened: true,
          moveAndOpen,
        } as unknown as BlokModules['Toolbar'],
        BlockSettings: {
          opened: true,
          open,
        } as unknown as BlokModules['BlockSettings'],
      });

      (blockEvents as unknown as { activateBlockSettings: () => void }).activateBlockSettings();

      expect(open).not.toHaveBeenCalled();
    });
  });

  describe('mergeBlocks', () => {
    it('focuses the target block, merges blocks and closes toolbar', async () => {
      const focusSpy = vi.spyOn(caretUtils, 'focus').mockImplementation(() => undefined);
      const mergeBlocksFn = vi.fn().mockResolvedValue(undefined);
      const closeToolbar = vi.fn();
      const targetBlock = {
        lastInput: document.createElement('div'),
      } as unknown as Block;
      const blockToMerge = {} as Block;
      const blockEvents = createBlockEvents({
        BlockManager: {
          mergeBlocks: mergeBlocksFn,
        } as unknown as BlokModules['BlockManager'],
        Toolbar: {
          close: closeToolbar,
        } as unknown as BlokModules['Toolbar'],
      });

      (blockEvents as unknown as { mergeBlocks: (target: Block, source: Block) => void }).mergeBlocks(
        targetBlock,
        blockToMerge
      );
      await mergeBlocksFn.mock.results[0]!.value;
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(focusSpy).toHaveBeenCalledWith(targetBlock.lastInput, false);
      expect(mergeBlocksFn).toHaveBeenCalledWith(targetBlock, blockToMerge);
      expect(closeToolbar).toHaveBeenCalledTimes(1);
    });

    it('returns early when target block has no lastInput', () => {
      const focusSpy = vi.spyOn(caretUtils, 'focus').mockImplementation(() => undefined);
      const mergeBlocksFn = vi.fn().mockResolvedValue(undefined);
      const blockEvents = createBlockEvents({
        BlockManager: {
          mergeBlocks: mergeBlocksFn,
        } as unknown as BlokModules['BlockManager'],
        Toolbar: {
          close: vi.fn(),
        } as unknown as BlokModules['Toolbar'],
      });

      (blockEvents as unknown as { mergeBlocks: (target: Block, source: Block) => void }).mergeBlocks(
        {} as Block,
        {} as Block
      );

      expect(mergeBlocksFn).not.toHaveBeenCalled();
      expect(focusSpy).not.toHaveBeenCalled();
    });
  });

  describe('input', () => {
    const createInputEvent = (options: Partial<InputEvent> = {}): InputEvent => {
      return {
        inputType: 'insertText',
        data: ' ',
        ...options,
      } as InputEvent;
    };

    it('ignores non-insertText input types', () => {
      const blockEvents = createBlockEvents();
      const handleListShortcutSpy = vi
        .spyOn(blockEvents as unknown as { handleListShortcut: () => void }, 'handleListShortcut')
        .mockImplementation(() => undefined);
      const event = createInputEvent({ inputType: 'deleteContentBackward' });

      blockEvents.input(event);

      expect(handleListShortcutSpy).not.toHaveBeenCalled();
    });

    it('ignores input events that are not space characters', () => {
      const blockEvents = createBlockEvents();
      const handleListShortcutSpy = vi
        .spyOn(blockEvents as unknown as { handleListShortcut: () => void }, 'handleListShortcut')
        .mockImplementation(() => undefined);
      const event = createInputEvent({ data: 'a' });

      blockEvents.input(event);

      expect(handleListShortcutSpy).not.toHaveBeenCalled();
    });

    it('calls handleListShortcut when space is typed', () => {
      const blockEvents = createBlockEvents();
      const handleListShortcutSpy = vi
        .spyOn(blockEvents as unknown as { handleListShortcut: () => void }, 'handleListShortcut')
        .mockImplementation(() => undefined);
      const event = createInputEvent({ inputType: 'insertText', data: ' ' });

      blockEvents.input(event);

      expect(handleListShortcutSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleListShortcut', () => {
    it('does nothing when there is no current block', () => {
      const replace = vi.fn();
      const blockEvents = createBlockEvents({
        BlockManager: {
          currentBlock: undefined,
          replace,
        } as unknown as BlokModules['BlockManager'],
      });

      (blockEvents as unknown as { handleListShortcut: () => void }).handleListShortcut();

      expect(replace).not.toHaveBeenCalled();
    });

    it('does nothing when current block is not a default block', () => {
      const replace = vi.fn();
      const currentBlock = {
        tool: {
          isDefault: false,
        },
        currentInput: document.createElement('div'),
      } as unknown as Block;
      const blockEvents = createBlockEvents({
        BlockManager: {
          currentBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
      });

      (blockEvents as unknown as { handleListShortcut: () => void }).handleListShortcut();

      expect(replace).not.toHaveBeenCalled();
    });

    it('does nothing when list tool is not available', () => {
      const replace = vi.fn();
      const currentBlock = {
        tool: {
          isDefault: true,
        },
        currentInput: document.createElement('div'),
      } as unknown as Block;
      const blockEvents = createBlockEvents({
        BlockManager: {
          currentBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        Tools: {
          blockTools: new Map(),
        } as unknown as BlokModules['Tools'],
      });

      (blockEvents as unknown as { handleListShortcut: () => void }).handleListShortcut();

      expect(replace).not.toHaveBeenCalled();
    });

    it('converts to ordered list when "1. " pattern is detected', () => {
      const replace = vi.fn().mockReturnValue({ id: 'new-block' });
      const setToBlock = vi.fn();
      const currentInput = document.createElement('div');

      currentInput.textContent = '1. ';
      const currentBlock = {
        tool: {
          isDefault: true,
        },
        currentInput,
      } as unknown as Block;
      const listTool = { name: 'list' };
      const blockTools = new Map([['list', listTool]]);
      const blockEvents = createBlockEvents({
        BlockManager: {
          currentBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        Tools: {
          blockTools,
        } as unknown as BlokModules['Tools'],
        Caret: {
          setToBlock,
          positions: {
            START: 'start-position',
          },
        } as unknown as BlokModules['Caret'],
      });

      (blockEvents as unknown as { handleListShortcut: () => void }).handleListShortcut();

      expect(replace).toHaveBeenCalledWith(currentBlock, 'list', {
        style: 'ordered',
        items: [{ content: '', checked: false }],
      });
      expect(setToBlock).toHaveBeenCalledWith({ id: 'new-block' }, 'start-position');
    });

    it('converts to ordered list when "1) " pattern is detected', () => {
      const replace = vi.fn().mockReturnValue({ id: 'new-block' });
      const setToBlock = vi.fn();
      const currentInput = document.createElement('div');

      currentInput.textContent = '1) ';
      const currentBlock = {
        tool: {
          isDefault: true,
        },
        currentInput,
      } as unknown as Block;
      const listTool = { name: 'list' };
      const blockTools = new Map([['list', listTool]]);
      const blockEvents = createBlockEvents({
        BlockManager: {
          currentBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        Tools: {
          blockTools,
        } as unknown as BlokModules['Tools'],
        Caret: {
          setToBlock,
          positions: {
            START: 'start-position',
          },
        } as unknown as BlokModules['Caret'],
      });

      (blockEvents as unknown as { handleListShortcut: () => void }).handleListShortcut();

      expect(replace).toHaveBeenCalledWith(currentBlock, 'list', {
        style: 'ordered',
        items: [{ content: '', checked: false }],
      });
    });

    it('converts to ordered list when "42. " pattern is detected with start number', () => {
      const replace = vi.fn().mockReturnValue({ id: 'new-block' });
      const setToBlock = vi.fn();
      const currentInput = document.createElement('div');

      currentInput.textContent = '42. ';
      const currentBlock = {
        tool: {
          isDefault: true,
        },
        currentInput,
      } as unknown as Block;
      const listTool = { name: 'list' };
      const blockTools = new Map([['list', listTool]]);
      const blockEvents = createBlockEvents({
        BlockManager: {
          currentBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        Tools: {
          blockTools,
        } as unknown as BlokModules['Tools'],
        Caret: {
          setToBlock,
          positions: {
            START: 'start-position',
          },
        } as unknown as BlokModules['Caret'],
      });

      (blockEvents as unknown as { handleListShortcut: () => void }).handleListShortcut();

      expect(replace).toHaveBeenCalledWith(currentBlock, 'list', {
        style: 'ordered',
        items: [{ content: '', checked: false }],
        start: 42,
      });
    });

    it('does not convert when pattern is not at the start', () => {
      const replace = vi.fn();
      const currentInput = document.createElement('div');

      currentInput.textContent = 'hello 1. ';
      const currentBlock = {
        tool: {
          isDefault: true,
        },
        currentInput,
      } as unknown as Block;
      const listTool = { name: 'list' };
      const blockTools = new Map([['list', listTool]]);
      const blockEvents = createBlockEvents({
        BlockManager: {
          currentBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        Tools: {
          blockTools,
        } as unknown as BlokModules['Tools'],
      });

      (blockEvents as unknown as { handleListShortcut: () => void }).handleListShortcut();

      expect(replace).not.toHaveBeenCalled();
    });

    it('does not convert when there is no current input', () => {
      const replace = vi.fn();
      const currentBlock = {
        tool: {
          isDefault: true,
        },
        currentInput: undefined,
      } as unknown as Block;
      const listTool = { name: 'list' };
      const blockTools = new Map([['list', listTool]]);
      const blockEvents = createBlockEvents({
        BlockManager: {
          currentBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        Tools: {
          blockTools,
        } as unknown as BlokModules['Tools'],
      });

      (blockEvents as unknown as { handleListShortcut: () => void }).handleListShortcut();

      expect(replace).not.toHaveBeenCalled();
    });

    it('converts to unchecked checklist when "[] " pattern is detected', () => {
      const replace = vi.fn().mockReturnValue({ id: 'new-block' });
      const setToBlock = vi.fn();
      const currentInput = document.createElement('div');

      currentInput.textContent = '[] ';
      const currentBlock = {
        tool: {
          isDefault: true,
        },
        currentInput,
      } as unknown as Block;
      const listTool = { name: 'list' };
      const blockTools = new Map([['list', listTool]]);
      const blockEvents = createBlockEvents({
        BlockManager: {
          currentBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        Tools: {
          blockTools,
        } as unknown as BlokModules['Tools'],
        Caret: {
          setToBlock,
          positions: {
            START: 'start-position',
          },
        } as unknown as BlokModules['Caret'],
      });

      (blockEvents as unknown as { handleListShortcut: () => void }).handleListShortcut();

      expect(replace).toHaveBeenCalledWith(currentBlock, 'list', {
        style: 'checklist',
        items: [{ content: '', checked: false }],
      });
      expect(setToBlock).toHaveBeenCalledWith({ id: 'new-block' }, 'start-position');
    });

    it('converts to unchecked checklist when "[ ] " pattern is detected', () => {
      const replace = vi.fn().mockReturnValue({ id: 'new-block' });
      const setToBlock = vi.fn();
      const currentInput = document.createElement('div');

      currentInput.textContent = '[ ] ';
      const currentBlock = {
        tool: {
          isDefault: true,
        },
        currentInput,
      } as unknown as Block;
      const listTool = { name: 'list' };
      const blockTools = new Map([['list', listTool]]);
      const blockEvents = createBlockEvents({
        BlockManager: {
          currentBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        Tools: {
          blockTools,
        } as unknown as BlokModules['Tools'],
        Caret: {
          setToBlock,
          positions: {
            START: 'start-position',
          },
        } as unknown as BlokModules['Caret'],
      });

      (blockEvents as unknown as { handleListShortcut: () => void }).handleListShortcut();

      expect(replace).toHaveBeenCalledWith(currentBlock, 'list', {
        style: 'checklist',
        items: [{ content: '', checked: false }],
      });
      expect(setToBlock).toHaveBeenCalledWith({ id: 'new-block' }, 'start-position');
    });

    it('converts to checked checklist when "[x] " pattern is detected', () => {
      const replace = vi.fn().mockReturnValue({ id: 'new-block' });
      const setToBlock = vi.fn();
      const currentInput = document.createElement('div');

      currentInput.textContent = '[x] ';
      const currentBlock = {
        tool: {
          isDefault: true,
        },
        currentInput,
      } as unknown as Block;
      const listTool = { name: 'list' };
      const blockTools = new Map([['list', listTool]]);
      const blockEvents = createBlockEvents({
        BlockManager: {
          currentBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        Tools: {
          blockTools,
        } as unknown as BlokModules['Tools'],
        Caret: {
          setToBlock,
          positions: {
            START: 'start-position',
          },
        } as unknown as BlokModules['Caret'],
      });

      (blockEvents as unknown as { handleListShortcut: () => void }).handleListShortcut();

      expect(replace).toHaveBeenCalledWith(currentBlock, 'list', {
        style: 'checklist',
        items: [{ content: '', checked: true }],
      });
      expect(setToBlock).toHaveBeenCalledWith({ id: 'new-block' }, 'start-position');
    });

    it('converts to checked checklist when "[X] " pattern is detected (uppercase)', () => {
      const replace = vi.fn().mockReturnValue({ id: 'new-block' });
      const setToBlock = vi.fn();
      const currentInput = document.createElement('div');

      currentInput.textContent = '[X] ';
      const currentBlock = {
        tool: {
          isDefault: true,
        },
        currentInput,
      } as unknown as Block;
      const listTool = { name: 'list' };
      const blockTools = new Map([['list', listTool]]);
      const blockEvents = createBlockEvents({
        BlockManager: {
          currentBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        Tools: {
          blockTools,
        } as unknown as BlokModules['Tools'],
        Caret: {
          setToBlock,
          positions: {
            START: 'start-position',
          },
        } as unknown as BlokModules['Caret'],
      });

      (blockEvents as unknown as { handleListShortcut: () => void }).handleListShortcut();

      expect(replace).toHaveBeenCalledWith(currentBlock, 'list', {
        style: 'checklist',
        items: [{ content: '', checked: true }],
      });
      expect(setToBlock).toHaveBeenCalledWith({ id: 'new-block' }, 'start-position');
    });

    it('converts to bulleted list when "- " pattern is detected', () => {
      const replace = vi.fn().mockReturnValue({ id: 'new-block' });
      const setToBlock = vi.fn();
      const currentInput = document.createElement('div');

      currentInput.textContent = '- ';
      const currentBlock = {
        tool: {
          isDefault: true,
        },
        currentInput,
      } as unknown as Block;
      const listTool = { name: 'list' };
      const blockTools = new Map([['list', listTool]]);
      const blockEvents = createBlockEvents({
        BlockManager: {
          currentBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        Tools: {
          blockTools,
        } as unknown as BlokModules['Tools'],
        Caret: {
          setToBlock,
          positions: {
            START: 'start-position',
          },
        } as unknown as BlokModules['Caret'],
      });

      (blockEvents as unknown as { handleListShortcut: () => void }).handleListShortcut();

      expect(replace).toHaveBeenCalledWith(currentBlock, 'list', {
        style: 'unordered',
        items: [{ content: '', checked: false }],
      });
      expect(setToBlock).toHaveBeenCalledWith({ id: 'new-block' }, 'start-position');
    });

    it('converts to bulleted list when "* " pattern is detected', () => {
      const replace = vi.fn().mockReturnValue({ id: 'new-block' });
      const setToBlock = vi.fn();
      const currentInput = document.createElement('div');

      currentInput.textContent = '* ';
      const currentBlock = {
        tool: {
          isDefault: true,
        },
        currentInput,
      } as unknown as Block;
      const listTool = { name: 'list' };
      const blockTools = new Map([['list', listTool]]);
      const blockEvents = createBlockEvents({
        BlockManager: {
          currentBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        Tools: {
          blockTools,
        } as unknown as BlokModules['Tools'],
        Caret: {
          setToBlock,
          positions: {
            START: 'start-position',
          },
        } as unknown as BlokModules['Caret'],
      });

      (blockEvents as unknown as { handleListShortcut: () => void }).handleListShortcut();

      expect(replace).toHaveBeenCalledWith(currentBlock, 'list', {
        style: 'unordered',
        items: [{ content: '', checked: false }],
      });
      expect(setToBlock).toHaveBeenCalledWith({ id: 'new-block' }, 'start-position');
    });
  });
});
