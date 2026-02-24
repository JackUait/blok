import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockEvents } from '../../../../src/components/modules/blockEvents';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import type { BlokConfig } from '../../../../types';
import type { BlokEventMap } from '../../../../src/components/events';
import type { Block } from '../../../../src/components/block';
import { keyCodes } from '../../../../src/components/utils';
import { DATA_ATTR } from '../../../../src/components/constants';

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
    Tools: {
      blockTools: new Map(),
    } as unknown as BlokModules['Tools'],
    YjsManager: {
      stopCapturing: vi.fn(),
      markBoundary: vi.fn(),
      clearBoundary: vi.fn(),
      checkAndHandleBoundary: vi.fn(),
      hasPendingBoundary: vi.fn().mockReturnValue(false),
    } as unknown as BlokModules['YjsManager'],
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
      (mergedState as Record<PropertyKey, unknown>)[moduleName] = {
        ...(defaultModule as unknown as Record<PropertyKey, unknown>),
        ...(moduleOverrides as Record<PropertyKey, unknown>),
      } as unknown as BlokModules[typeof moduleName];
    } else if (moduleOverrides !== undefined) {
      (mergedState as Record<PropertyKey, unknown>)[moduleName] =
        moduleOverrides as unknown as BlokModules[typeof moduleName];
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
    it('sets empty attribute on wrapper when Shift is not pressed', () => {
      const wrapper = document.createElement('div');
      const checkEmptiness = vi.fn(function(this: BlokModules['UI']) {
        this.nodes.wrapper.setAttribute(DATA_ATTR.empty, 'true');
      });
      const blockEvents = createBlockEvents({
        UI: {
          checkEmptiness,
          nodes: {
            wrapper,
          },
        } as unknown as BlokModules['UI'],
      });

      blockEvents.keyup(createKeyboardEvent({ shiftKey: false }));

      expect(checkEmptiness).toHaveBeenCalledTimes(1);
      expect(wrapper).toHaveAttribute(DATA_ATTR.empty);
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
      const insertedBlock = {} as Block;
      const deleteSelectedBlocksAndInsertReplacement = vi.fn().mockReturnValue(insertedBlock);
      const clearSelection = vi.fn();
      const setToBlock = vi.fn();

      const blockEvents = createBlockEvents({
        BlockSelection: {
          anyBlockSelected: true,
          copySelectedBlocks,
          clearSelection,
        } as unknown as BlokModules['BlockSelection'],
        BlockManager: {
          deleteSelectedBlocksAndInsertReplacement,
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
      await copySelectedBlocks.mock.results[0].value;
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(copySelectedBlocks).toHaveBeenCalledWith(event);
      expect(deleteSelectedBlocksAndInsertReplacement).toHaveBeenCalledTimes(1);
      expect(setToBlock).toHaveBeenCalledWith(insertedBlock, 'start-position');
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
    it('processes Backspace key without throwing', () => {
      const blockEvents = createBlockEvents();
      const event = createKeyboardEvent({ keyCode: keyCodes.BACKSPACE });

      expect(() => blockEvents.keydown(event)).not.toThrow();
    });

    it('processes Delete key without throwing', () => {
      const blockEvents = createBlockEvents();
      const event = createKeyboardEvent({ keyCode: keyCodes.DELETE });

      expect(() => blockEvents.keydown(event)).not.toThrow();
    });

    it('processes Enter key without throwing', () => {
      const blockEvents = createBlockEvents();
      const event = createKeyboardEvent({ keyCode: keyCodes.ENTER });

      expect(() => blockEvents.keydown(event)).not.toThrow();
    });

    it('processes Arrow keys without throwing', () => {
      const blockEvents = createBlockEvents();

      expect(() => blockEvents.keydown(createKeyboardEvent({ keyCode: keyCodes.UP }))).not.toThrow();
      expect(() => blockEvents.keydown(createKeyboardEvent({ keyCode: keyCodes.DOWN }))).not.toThrow();
      expect(() => blockEvents.keydown(createKeyboardEvent({ keyCode: keyCodes.LEFT }))).not.toThrow();
      expect(() => blockEvents.keydown(createKeyboardEvent({ keyCode: keyCodes.RIGHT }))).not.toThrow();
    });

    it('processes Tab key without throwing', () => {
      const blockEvents = createBlockEvents();
      const event = createKeyboardEvent({ keyCode: keyCodes.TAB });

      expect(() => blockEvents.keydown(event)).not.toThrow();
    });

    it('activates toolbox and inserts slash when "/" key is pressed in empty block', () => {
      const currentBlock = {
        isEmpty: true,
      } as unknown as Block;
      const wrapper = document.createElement('div');
      const target = document.createElement('div');
      const insertContentAtCaretPosition = vi.fn();
      const moveAndOpen = vi.fn();
      const toolboxOpen = vi.fn();

      wrapper.appendChild(target);
      document.body.appendChild(wrapper);
      const blockEvents = createBlockEvents({
        BlockManager: {
          currentBlock,
        } as unknown as BlokModules['BlockManager'],
        UI: {
          nodes: {
            wrapper,
          },
        } as unknown as BlokModules['UI'],
        Caret: {
          insertContentAtCaretPosition,
        } as unknown as BlokModules['Caret'],
        Toolbar: {
          opened: false,
          moveAndOpen,
          toolbox: {
            open: toolboxOpen,
          },
        } as unknown as BlokModules['Toolbar'],
      });
      const event = createKeyboardEvent({
        keyCode: keyCodes.SLASH,
        key: '/',
        target,
      });

      blockEvents.keydown(event);

      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(insertContentAtCaretPosition).toHaveBeenCalledWith('/');
      expect(moveAndOpen).toHaveBeenCalledTimes(1);
      expect(toolboxOpen).toHaveBeenCalledTimes(1);

      wrapper.remove();
    });

    it('opens BlockSettings for Ctrl+Slash combination', () => {
      let blockSettingsOpened = false;
      const blockSettingsOpen = vi.fn().mockImplementation(async function(this: BlokModules['BlockSettings']) {
        this.opened = true;
        blockSettingsOpened = true;
      });
      const moveAndOpen = vi.fn();
      const blockEvents = createBlockEvents({
        BlockSelection: {
          selectedBlocks: [],
        } as unknown as BlokModules['BlockSelection'],
        BlockSettings: {
          opened: false,
          open: blockSettingsOpen,
        } as unknown as BlokModules['BlockSettings'],
        Toolbar: {
          opened: false,
          moveAndOpen,
        } as unknown as BlokModules['Toolbar'],
      });
      const event = createKeyboardEvent({ code: 'Slash', ctrlKey: true });

      blockEvents.keydown(event);

      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(moveAndOpen).toHaveBeenCalledTimes(1);
      expect(blockSettingsOpen).toHaveBeenCalledTimes(1);
      expect(blockSettingsOpened).toBe(true);
    });
  });

  describe('beforeKeydownProcessing', () => {
    it('closes Toolbar when typing a printable key in a regular block', () => {
      const closeSpy = vi.fn();
      const holder = document.createElement('div');
      const currentBlock = { holder } as unknown as Block;

      const blockEvents = createBlockEvents({
        Toolbar: {
          opened: true,
          close: closeSpy,
          toolbox: { open: vi.fn() },
        } as unknown as BlokModules['Toolbar'],
        BlockManager: {
          currentBlock,
        } as unknown as BlokModules['BlockManager'],
      });

      const event = createKeyboardEvent({ key: 'a', keyCode: 65 });

      blockEvents.beforeKeydownProcessing(event);

      expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    it('does not close Toolbar when typing a printable key inside a table cell', () => {
      const closeSpy = vi.fn();

      // Build a DOM hierarchy that includes a table cell container
      const tableCellBlocks = document.createElement('div');
      tableCellBlocks.setAttribute('data-blok-table-cell-blocks', '');
      const holder = document.createElement('div');
      tableCellBlocks.appendChild(holder);

      const currentBlock = { holder } as unknown as Block;

      const blockEvents = createBlockEvents({
        Toolbar: {
          opened: true,
          close: closeSpy,
          toolbox: { open: vi.fn() },
        } as unknown as BlokModules['Toolbar'],
        BlockManager: {
          currentBlock,
        } as unknown as BlokModules['BlockManager'],
      });

      const event = createKeyboardEvent({ key: 'a', keyCode: 65 });

      blockEvents.beforeKeydownProcessing(event);

      expect(closeSpy).not.toHaveBeenCalled();
    });

    it('still clears block selection when typing in a table cell', () => {
      const clearSelectionSpy = vi.fn();

      const tableCellBlocks = document.createElement('div');
      tableCellBlocks.setAttribute('data-blok-table-cell-blocks', '');
      const holder = document.createElement('div');
      tableCellBlocks.appendChild(holder);

      const currentBlock = { holder } as unknown as Block;

      const blockEvents = createBlockEvents({
        Toolbar: {
          opened: true,
          close: vi.fn(),
          toolbox: { open: vi.fn() },
        } as unknown as BlokModules['Toolbar'],
        BlockManager: {
          currentBlock,
        } as unknown as BlokModules['BlockManager'],
        BlockSelection: {
          anyBlockSelected: false,
          clearSelection: clearSelectionSpy,
          copySelectedBlocks: vi.fn(() => Promise.resolve()),
          selectedBlocks: [],
        } as unknown as BlokModules['BlockSelection'],
      });

      const event = createKeyboardEvent({ key: 'a', keyCode: 65 });

      blockEvents.beforeKeydownProcessing(event);

      expect(clearSelectionSpy).toHaveBeenCalledWith(event);
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

    it('processes input events without errors', () => {
      const blockEvents = createBlockEvents();
      const event = createInputEvent();

      expect(() => blockEvents.input(event)).not.toThrow();
    });

    it('processes space input events without errors', () => {
      const blockEvents = createBlockEvents();
      const event = createInputEvent({ inputType: 'insertText', data: ' ' });

      expect(() => blockEvents.input(event)).not.toThrow();
    });

    it('ignores non-insertText input types', () => {
      const blockEvents = createBlockEvents();
      const event = createInputEvent({ inputType: 'deleteContentBackward' });

      expect(() => blockEvents.input(event)).not.toThrow();
    });

    it('sets current block from event target before processing shortcuts', () => {
      const setCurrentBlockByChildNode = vi.fn();
      const target = document.createElement('div');
      const blockEvents = createBlockEvents({
        BlockManager: {
          setCurrentBlockByChildNode,
        } as unknown as BlokModules['BlockManager'],
      });

      const event = createInputEvent({ target } as unknown as Partial<InputEvent>);

      blockEvents.input(event);

      expect(setCurrentBlockByChildNode).toHaveBeenCalledWith(target);
    });

    describe('smart grouping', () => {
      it('marks boundary when space is typed', () => {
        let pendingBoundary = false;
        let boundaryTimestamp = 0;

        const markBoundarySpy = vi.fn(() => {
          pendingBoundary = true;
          boundaryTimestamp = Date.now();
        });
        const hasPendingBoundarySpy = vi.fn(() => pendingBoundary);

        const blockEvents = createBlockEvents({
          YjsManager: {
            markBoundary: markBoundarySpy,
            checkAndHandleBoundary: vi.fn(),
            hasPendingBoundary: hasPendingBoundarySpy,
            clearBoundary: vi.fn(),
          } as unknown as BlokModules['YjsManager'],
        });

        const event = {
          inputType: 'insertText',
          data: ' ',
        } as InputEvent;

        blockEvents.input(event);

        expect(markBoundarySpy).toHaveBeenCalled();
        expect(pendingBoundary).toBe(true);
        expect(boundaryTimestamp).toBeGreaterThan(0);
      });

      it('checks and handles boundary on non-boundary character', () => {
        let boundaryChecked = false;

        const checkAndHandleBoundarySpy = vi.fn(() => {
          boundaryChecked = true;
        });

        const blockEvents = createBlockEvents({
          YjsManager: {
            markBoundary: vi.fn(),
            checkAndHandleBoundary: checkAndHandleBoundarySpy,
            hasPendingBoundary: vi.fn().mockReturnValue(false),
            clearBoundary: vi.fn(),
          } as unknown as BlokModules['YjsManager'],
        });

        const event = {
          inputType: 'insertText',
          data: 'a',
        } as InputEvent;

        blockEvents.input(event);

        expect(checkAndHandleBoundarySpy).toHaveBeenCalled();
        expect(boundaryChecked).toBe(true);
      });

      it('clears boundary when non-boundary follows boundary quickly', () => {
        let boundaryCleared = false;
        const hasPendingBoundarySpy = vi.fn().mockReturnValue(true);

        const clearBoundarySpy = vi.fn(() => {
          boundaryCleared = true;
        });

        const blockEvents = createBlockEvents({
          YjsManager: {
            markBoundary: vi.fn(),
            checkAndHandleBoundary: vi.fn(),
            hasPendingBoundary: hasPendingBoundarySpy,
            clearBoundary: clearBoundarySpy,
          } as unknown as BlokModules['YjsManager'],
        });

        const event = {
          inputType: 'insertText',
          data: 'a',
        } as InputEvent;

        blockEvents.input(event);

        expect(clearBoundarySpy).toHaveBeenCalled();
        expect(boundaryCleared).toBe(true);
      });
    });
  });
});
