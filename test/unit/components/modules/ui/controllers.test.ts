import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardController } from '../../../../../src/components/modules/uiControllers/controllers/keyboard';
import { SelectionUtils as Selection } from '../../../../../src/components/selection';
import type { Block } from '../../../../../src/components/block';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { BlokConfig } from '../../../../../types';
import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import { PopoverRegistry } from '../../../../../src/components/utils/popover/popover-registry';
import type { PopoverAbstract } from '../../../../../src/components/utils/popover/popover-abstract';
import { getCaretOffset } from '../../../../../src/components/utils/caret/selection';
import type * as CaretSelectionModule from '../../../../../src/components/utils/caret/selection';

vi.mock('../../../../../src/components/utils/caret/selection', async (importOriginal) => {
  const actual = await importOriginal<typeof CaretSelectionModule>();

  return {
    ...actual,
    getCaretOffset: vi.fn(() => 0),
  };
});

const createBlokStub = (): BlokModules => {
  const blockSettingsWrapper = document.createElement('div');
  const toolbarWrapper = document.createElement('div');
  const toolbarSettingsToggler = document.createElement('button');
  const toolbarPlusButton = document.createElement('button');

  const editorWrapper = document.createElement('div');

  return {
    UI: {
      nodes: {
        wrapper: editorWrapper,
      },
      someToolbarOpened: false,
      someFlipperButtonFocused: false,
    },
    BlockManager: {
      isBlokEmpty: false,
      currentBlock: null,
      currentBlockIndex: -1,
      lastBlock: null,
      insert: vi.fn(() => ({})),
      insertAtEnd: vi.fn(),
      unsetCurrentBlock: vi.fn(),
      setCurrentBlockByChildNode: vi.fn(),
      getBlockByChildNode: vi.fn(),
      deleteSelectedBlocksAndInsertReplacement: vi.fn(),
      convert: vi.fn(() => Promise.resolve({ id: 'converted' })),
    },
    BlockSelection: {
      anyBlockSelected: false,
      navigationModeEnabled: false,
      clearSelection: vi.fn(),
      enableNavigationMode: vi.fn(),
      disableNavigationMode: vi.fn(),
    },
    CrossBlockSelection: {
      isCrossBlockSelectionStarted: false,
    },
    RectangleSelection: {
      isRectActivated: vi.fn(() => false),
    },
    InlineToolbar: {
      opened: false,
      close: vi.fn(),
      hasNestedPopoverOpen: false,
      closeNestedPopover: vi.fn(),
    },
    BlockSettings: {
      opened: false,
      close: vi.fn(),
      contains: vi.fn(() => false),
      nodes: {
        wrapper: blockSettingsWrapper,
      },
    },
    Toolbar: {
      moveAndOpen: vi.fn(),
      close: vi.fn(),
      nodes: {
        wrapper: toolbarWrapper,
        settingsToggler: toolbarSettingsToggler,
        plusButton: toolbarPlusButton,
      },
      toolbox: {
        opened: false,
        close: vi.fn(),
      },
    },
    BlockEvents: {
      keydown: vi.fn(),
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
      markCaretBeforeChange: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      stopCapturing: vi.fn(),
    },
    DragManager: {
      isDragging: false,
    },
  } as unknown as BlokModules;
};

describe('KeyboardController', () => {
  const controllers: KeyboardController[] = [];

  const createKeyboardController = (options?: {
    someToolbarOpened?: () => boolean;
    blokOverrides?: Partial<BlokModules>;
    configOverrides?: Partial<BlokConfig>;
  }): {
    controller: KeyboardController;
    blok: BlokModules;
    redactor: HTMLElement;
    wrapper: HTMLElement;
    eventsDispatcher: ModuleConfig['eventsDispatcher'];
  } => {
    const redactor = document.createElement('div');
    document.body.appendChild(redactor);

    const eventsDispatcher = {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    } as unknown as ModuleConfig['eventsDispatcher'];

    const blok = createBlokStub();

    if (options?.blokOverrides) {
      Object.assign(blok, options.blokOverrides);
    }

    // Set up the editor wrapper with the test id used for instance detection
    const wrapper = (blok as unknown as { UI: { nodes: { wrapper: HTMLElement } } }).UI.nodes.wrapper;

    wrapper.setAttribute('data-blok-testid', 'blok-editor');
    document.body.appendChild(wrapper);

    const controller = new KeyboardController({
      config: {
        holder: document.createElement('div'),
        minHeight: 50,
        ...options?.configOverrides,
      } as BlokConfig,
      eventsDispatcher: eventsDispatcher,
      someToolbarOpened: options?.someToolbarOpened ?? (() => false),
    });

    controller.state = blok;
    controller.setRedactorElement(redactor);
    controller.setWrapperElement(wrapper);

    // Register for cleanup
    controllers.push(controller);

    return { controller, blok, redactor, wrapper, eventsDispatcher };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    PopoverRegistry.resetForTests();
  });

  afterEach(() => {
    // Disable all controllers to remove event listeners
    controllers.forEach((controller) => {
      (controller as unknown as { disable: () => void }).disable();
    });
    controllers.length = 0;

    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('creates controller with dependencies', () => {
      const { controller } = createKeyboardController();

      expect(controller).toBeInstanceOf(KeyboardController);
    });

    it('can be enabled and disabled', () => {
      const { controller } = createKeyboardController();

      expect(() => {
        (controller as unknown as { disable: () => void }).disable();
      }).not.toThrow();
    });
  });

  describe('Enter key handling', () => {
    it('skips handling when any toolbar opened', () => {
      const { controller } = createKeyboardController({
        someToolbarOpened: () => true,
      });

      (controller as unknown as { enable: () => void }).enable();

      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      document.dispatchEvent(event);

      // Should not insert block when toolbar is open
      expect((controller as unknown as { Blok: BlokModules }).Blok.BlockManager.insert).not.toHaveBeenCalled();
    });

    it('clears selected blocks on enter when selection absent', () => {
      const { controller, blok } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      Object.assign(blok.BlockSelection, { anyBlockSelected: true });
      vi.spyOn(Selection, 'isSelectionExists', 'get').mockReturnValue(false);
      vi.spyOn(Selection, 'isCollapsed', 'get').mockReturnValue(true);

      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      Object.defineProperty(event, 'target', { value: document.body });
      document.dispatchEvent(event);

      expect(blok.BlockSelection.clearSelection).toHaveBeenCalledWith(event);
    });

    it('inserts new block when enter pressed on body without selection', () => {
      const { controller, blok } = createKeyboardController();
      const newBlock = { id: 'new' } as unknown as Block;

      (controller as unknown as { enable: () => void }).enable();

      Object.assign(blok.BlockSelection, { anyBlockSelected: false });
      blok.BlockManager.currentBlockIndex = 1;
      vi.mocked(blok.BlockManager.insert).mockReturnValue(newBlock);
      vi.spyOn(Selection, 'isSelectionExists', 'get').mockReturnValue(true);
      vi.spyOn(Selection, 'isCollapsed', 'get').mockReturnValue(false);

      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      Object.defineProperty(event, 'target', { value: document.body });
      document.dispatchEvent(event);

      expect(blok.BlockManager.insert).toHaveBeenCalledTimes(1);
      expect(blok.Caret.setToBlock).toHaveBeenCalledWith(newBlock);
      expect(blok.Toolbar.moveAndOpen).toHaveBeenCalledWith(newBlock);
    });
  });

  describe('Backspace/Delete handling', () => {
    it('ignores backspace from inside BlockSettings', () => {
      const { controller, blok } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      vi.mocked(blok.BlockSettings.contains).mockReturnValue(true);

      const event = new KeyboardEvent('keydown', { key: 'Backspace' });
      Object.defineProperty(event, 'target', { value: document.createElement('div') });
      document.dispatchEvent(event);

      expect(blok.BlockManager.deleteSelectedBlocksAndInsertReplacement).not.toHaveBeenCalled();
    });

    it('deletes selected blocks when conditions met', () => {
      const { controller, blok } = createKeyboardController();
      const insertedBlock = { id: 'inserted' } as unknown as Block;

      (controller as unknown as { enable: () => void }).enable();

      Object.assign(blok.BlockSelection, { anyBlockSelected: true });
      (blok.CrossBlockSelection as { isCrossBlockSelectionStarted: boolean }).isCrossBlockSelectionStarted = false;
      vi.spyOn(Selection, 'isSelectionExists', 'get').mockReturnValue(false);
      vi.spyOn(Selection, 'isCollapsed', 'get').mockReturnValue(true);
      vi.mocked(blok.BlockManager.deleteSelectedBlocksAndInsertReplacement).mockReturnValue(insertedBlock);
      vi.mocked(blok.BlockSettings.contains).mockReturnValue(false);

      const event = new KeyboardEvent('keydown', { key: 'Backspace' });
      Object.defineProperty(event, 'target', { value: document.body });
      document.dispatchEvent(event);

      expect(blok.BlockManager.deleteSelectedBlocksAndInsertReplacement).toHaveBeenCalledTimes(1);
      expect(blok.Caret.setToBlock).toHaveBeenCalledWith(insertedBlock, blok.Caret.positions.START);
      expect(blok.BlockSelection.clearSelection).toHaveBeenCalledWith(event);
    });
  });

  describe('Escape key handling', () => {
    it('disables navigation mode when enabled', () => {
      const { controller, blok } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      Object.assign(blok.BlockSelection, { navigationModeEnabled: true });

      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(event);

      expect(blok.BlockSelection.disableNavigationMode).toHaveBeenCalledWith(false);
    });

    it('closes popover via registry when a popover is open (e.g. BlockSettings)', () => {
      const { controller } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      const mockPopover = {
        hide: vi.fn(),
        hasNode: vi.fn(() => false),
      } as unknown as PopoverAbstract;

      PopoverRegistry.instance.register(mockPopover, document.createElement('button'));

      const event = new KeyboardEvent('keydown', { key: 'Escape' });

      document.dispatchEvent(event);

      expect(mockPopover.hide).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(false);
    });

    it('closes Toolbox when open via Escape', () => {
      const { controller, blok } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      blok.BlockSettings.opened = false;
      blok.Toolbar.toolbox.opened = true;
      blok.BlockManager.currentBlock = {
        id: 'test',
        name: 'paragraph',
        holder: document.createElement('div'),
      } as unknown as typeof blok.BlockManager.currentBlock;

      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(event);

      expect(blok.Toolbar.toolbox.close).toHaveBeenCalledTimes(1);
      // Caret restoration is handled by ToolboxEvent.Closed in toolbar/index.ts,
      // not directly in the keyboard controller.
      expect(blok.Caret.setToBlock).not.toHaveBeenCalled();
      // Toolbox.close() is called without preventing default - event propagates normally
      expect(event.defaultPrevented).toBe(false);
    });

    it('closes nested popover when inline toolbar has one open', () => {
      const { controller, blok } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      blok.BlockSettings.opened = false;
      blok.Toolbar.toolbox.opened = false;
      blok.InlineToolbar.opened = true;
      (blok.InlineToolbar as { hasNestedPopoverOpen: boolean }).hasNestedPopoverOpen = true;

      // Use a spy that also sets defaultPrevented to true
      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      const preventDefaultSpy = vi.fn().mockImplementation(() => {
        Object.defineProperty(event, 'defaultPrevented', { value: true, configurable: true });
      });
      Object.defineProperty(event, 'preventDefault', { value: preventDefaultSpy });

      document.dispatchEvent(event);

      expect(blok.InlineToolbar.closeNestedPopover).toHaveBeenCalledTimes(1);
      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
    });

    it('closes inline toolbar when open', () => {
      const { controller, blok } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      Object.assign(blok.BlockSettings, { opened: false });
      Object.assign(blok.Toolbar.toolbox, { opened: false });
      Object.assign(blok.BlockSelection, { anyBlockSelected: false });
      blok.BlockManager.currentBlock = undefined;
      blok.InlineToolbar.opened = true;
      (blok.InlineToolbar as { hasNestedPopoverOpen: boolean }).hasNestedPopoverOpen = false;

      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      Object.defineProperty(event, 'target', { value: document.body });
      document.dispatchEvent(event);

      expect(blok.InlineToolbar.close).toHaveBeenCalledTimes(1);
      // InlineToolbar.close() is called without preventing default - event propagates normally
      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe('Tab key handling', () => {
    it('delegates to default handler when no blocks selected', () => {
      const { controller } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      const event = new KeyboardEvent('keydown', { key: 'Tab' });
      document.dispatchEvent(event);

      // Tab key has shiftKey which is a meta key, so handleDefault returns early
      expect(event.defaultPrevented).toBe(false);
    });

    it('prevents default when blocks are selected', () => {
      const { controller, blok } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      Object.assign(blok.BlockSelection, { anyBlockSelected: true });

      const event = new KeyboardEvent('keydown', { key: 'Tab' });
      const preventDefaultSpy = vi.fn().mockImplementation(() => {
        Object.defineProperty(event, 'defaultPrevented', { value: true, configurable: true });
      });
      Object.defineProperty(event, 'preventDefault', { value: preventDefaultSpy });
      document.dispatchEvent(event);

      expect(blok.BlockEvents.keydown).toHaveBeenCalled();
      // When blocks are selected, Tab is handled to prevent focus navigation (line 358)
      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe('Z key (undo/redo) handling', () => {
    it('does nothing when Z pressed without meta key', () => {
      const { controller, blok } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      const event = new KeyboardEvent('keydown', { key: 'z' });
      document.dispatchEvent(event);

      expect(blok.YjsManager.undo).not.toHaveBeenCalled();
    });

    it('calls undo when Cmd+Z pressed', () => {
      const { controller, blok } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true });
      const preventDefaultSpy = vi.fn().mockImplementation(() => {
        Object.defineProperty(event, 'defaultPrevented', { value: true, configurable: true });
      });
      Object.defineProperty(event, 'preventDefault', { value: preventDefaultSpy });
      const stopPropagationSpy = vi.fn();
      Object.defineProperty(event, 'stopPropagation', { value: stopPropagationSpy });
      document.dispatchEvent(event);

      expect(blok.YjsManager.undo).toHaveBeenCalledTimes(1);
      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(stopPropagationSpy).toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
    });

    it('calls redo when Cmd+Shift+Z pressed', () => {
      const { controller, blok } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true });
      const preventDefaultSpy = vi.fn().mockImplementation(() => {
        Object.defineProperty(event, 'defaultPrevented', { value: true, configurable: true });
      });
      Object.defineProperty(event, 'preventDefault', { value: preventDefaultSpy });
      const stopPropagationSpy = vi.fn();
      Object.defineProperty(event, 'stopPropagation', { value: stopPropagationSpy });
      document.dispatchEvent(event);

      expect(blok.YjsManager.redo).toHaveBeenCalledTimes(1);
      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(stopPropagationSpy).toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
    });

    it('does NOT call undo while a drag is active (regression: wrong-block-dropped)', () => {
      const { controller, blok } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      Object.assign(blok.DragManager, { isDragging: true });

      const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true });

      document.dispatchEvent(event);

      expect(blok.YjsManager.undo).not.toHaveBeenCalled();
    });

    it('does NOT call redo while a drag is active (regression: wrong-block-dropped)', () => {
      const { controller, blok } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      Object.assign(blok.DragManager, { isDragging: true });

      const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true });

      document.dispatchEvent(event);

      expect(blok.YjsManager.redo).not.toHaveBeenCalled();
    });

    it('still fires redo when Cmd+Shift+Z follows Cmd+Z within 50ms (regression: redo-after-undo swallowed)', () => {
      // The double-fire guard must dedupe only an IDENTICAL repeated action
      // (one physical keypress emitting duplicate keydowns), never a genuinely
      // distinct follow-up. A user undoing then immediately redoing fires two
      // DIFFERENT actions back-to-back; sharing one timestamp across undo+redo
      // wrongly swallowed the redo, so redo of a just-undone column creation
      // silently did nothing. Distinct actions must never be debounced.
      const { controller, blok } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      const undoEvent = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true });
      const redoEvent = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true });

      document.dispatchEvent(undoEvent);
      document.dispatchEvent(redoEvent);

      expect(blok.YjsManager.undo).toHaveBeenCalledTimes(1);
      expect(blok.YjsManager.redo).toHaveBeenCalledTimes(1);
    });

    it('prevents double-firing within 50ms', () => {
      const { controller, blok } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      const event1 = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true });
      const event2 = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true });
      const preventDefaultSpy1 = vi.fn().mockImplementation(() => {
        Object.defineProperty(event1, 'defaultPrevented', { value: true, configurable: true });
      });
      const preventDefaultSpy2 = vi.fn().mockImplementation(() => {
        Object.defineProperty(event2, 'defaultPrevented', { value: true, configurable: true });
      });
      Object.defineProperty(event1, 'preventDefault', { value: preventDefaultSpy1 });
      Object.defineProperty(event2, 'preventDefault', { value: preventDefaultSpy2 });

      document.dispatchEvent(event1);
      document.dispatchEvent(event2);

      expect(blok.YjsManager.undo).toHaveBeenCalledTimes(1);
      expect(preventDefaultSpy1).toHaveBeenCalled();
      expect(preventDefaultSpy2).toHaveBeenCalled();
      expect(event1.defaultPrevented).toBe(true);
      expect(event2.defaultPrevented).toBe(true);
    });
  });

  describe('Turn into shortcuts (D5)', () => {
    const isMac = process.platform === 'darwin';

    const createTurnIntoEvent = (code: string): KeyboardEvent => {
      // Mac: Cmd+Opt+N, Win/Linux: Ctrl+Shift+N
      const modifiers = isMac
        ? { metaKey: true, altKey: true }
        : { ctrlKey: true, shiftKey: true };

      return new KeyboardEvent('keydown', { key: code.replace('Digit', ''), code, ...modifiers });
    };

    const makeBlock = (): Block => ({
      id: 'block-1',
      name: 'paragraph',
      holder: document.createElement('div'),
    } as unknown as Block);

    it('converts the current block to Heading 1 with Cmd+Opt+1 / Ctrl+Shift+1', () => {
      const { controller, blok } = createKeyboardController({
        configOverrides: { defaultBlock: 'paragraph' },
      });

      (controller as unknown as { enable: () => void }).enable();

      const block = makeBlock();
      blok.BlockManager.currentBlock = block as unknown as typeof blok.BlockManager.currentBlock;

      const event = createTurnIntoEvent('Digit1');
      Object.defineProperty(event, 'target', { value: document.body });
      document.dispatchEvent(event);

      expect(blok.BlockManager.convert).toHaveBeenCalledWith(block, 'header', { level: 1 });
    });

    it('converts the current block to Heading 2 with the digit-2 combo', () => {
      const { controller, blok } = createKeyboardController({
        configOverrides: { defaultBlock: 'paragraph' },
      });

      (controller as unknown as { enable: () => void }).enable();

      const block = makeBlock();
      blok.BlockManager.currentBlock = block as unknown as typeof blok.BlockManager.currentBlock;

      const event = createTurnIntoEvent('Digit2');
      Object.defineProperty(event, 'target', { value: document.body });
      document.dispatchEvent(event);

      expect(blok.BlockManager.convert).toHaveBeenCalledWith(block, 'header', { level: 2 });
    });

    it('converts the current block to Heading 3 with the digit-3 combo', () => {
      const { controller, blok } = createKeyboardController({
        configOverrides: { defaultBlock: 'paragraph' },
      });

      (controller as unknown as { enable: () => void }).enable();

      const block = makeBlock();
      blok.BlockManager.currentBlock = block as unknown as typeof blok.BlockManager.currentBlock;

      const event = createTurnIntoEvent('Digit3');
      Object.defineProperty(event, 'target', { value: document.body });
      document.dispatchEvent(event);

      expect(blok.BlockManager.convert).toHaveBeenCalledWith(block, 'header', { level: 3 });
    });

    // On Mac the heading combo is Cmd+Opt+digit, so 4/5/6 are collision-free.
    // On Win/Linux it is Ctrl+Shift+digit, which for 5/6 now belongs to the list
    // shortcut (Ctrl+Shift+5/6), so only Digit4 stays a heading there.
    const headingLevelCases: [string, number][] = isMac
      ? [['Digit4', 4], ['Digit5', 5], ['Digit6', 6]]
      : [['Digit4', 4]];

    it.each(headingLevelCases)('converts the current block to the matching heading with %s (levels 4-6)', (code, level) => {
      const { controller, blok } = createKeyboardController({
        configOverrides: { defaultBlock: 'paragraph' },
      });

      (controller as unknown as { enable: () => void }).enable();

      const block = makeBlock();
      blok.BlockManager.currentBlock = block as unknown as typeof blok.BlockManager.currentBlock;

      const event = createTurnIntoEvent(code);
      Object.defineProperty(event, 'target', { value: document.body });
      document.dispatchEvent(event);

      expect(blok.BlockManager.convert).toHaveBeenCalledWith(block, 'header', { level });
    });

    it('converts the current block back to Text (paragraph) with the digit-0 combo', () => {
      const { controller, blok } = createKeyboardController({
        configOverrides: { defaultBlock: 'paragraph' },
      });

      (controller as unknown as { enable: () => void }).enable();

      const block = makeBlock();
      blok.BlockManager.currentBlock = block as unknown as typeof blok.BlockManager.currentBlock;

      const event = createTurnIntoEvent('Digit0');
      Object.defineProperty(event, 'target', { value: document.body });
      document.dispatchEvent(event);

      expect(blok.BlockManager.convert).toHaveBeenCalledWith(block, 'paragraph', {});
    });

    it('wraps the conversion in stopCapturing so it is its own undo step', () => {
      const { controller, blok } = createKeyboardController({
        configOverrides: { defaultBlock: 'paragraph' },
      });

      (controller as unknown as { enable: () => void }).enable();

      blok.BlockManager.currentBlock = makeBlock() as unknown as typeof blok.BlockManager.currentBlock;

      const event = createTurnIntoEvent('Digit1');
      Object.defineProperty(event, 'target', { value: document.body });
      document.dispatchEvent(event);

      expect(blok.YjsManager.stopCapturing).toHaveBeenCalled();
    });

    it('prevents the browser from inserting the digit', () => {
      const { controller, blok } = createKeyboardController({
        configOverrides: { defaultBlock: 'paragraph' },
      });

      (controller as unknown as { enable: () => void }).enable();

      blok.BlockManager.currentBlock = makeBlock() as unknown as typeof blok.BlockManager.currentBlock;

      const event = createTurnIntoEvent('Digit1');
      const preventDefaultSpy = vi.fn().mockImplementation(() => {
        Object.defineProperty(event, 'defaultPrevented', { value: true, configurable: true });
      });
      Object.defineProperty(event, 'preventDefault', { value: preventDefaultSpy });
      Object.defineProperty(event, 'target', { value: document.body });
      document.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('does NOT convert when the digit is pressed without the turn-into modifiers', () => {
      const { controller, blok } = createKeyboardController({
        configOverrides: { defaultBlock: 'paragraph' },
      });

      (controller as unknown as { enable: () => void }).enable();

      blok.BlockManager.currentBlock = makeBlock() as unknown as typeof blok.BlockManager.currentBlock;

      const event = new KeyboardEvent('keydown', { key: '1', code: 'Digit1' });
      Object.defineProperty(event, 'target', { value: document.body });
      document.dispatchEvent(event);

      expect(blok.BlockManager.convert).not.toHaveBeenCalled();
    });

    it('preserves the caret offset across the conversion (Notion parity)', async () => {
      vi.mocked(getCaretOffset).mockReturnValue(3);

      const { controller, blok } = createKeyboardController({
        configOverrides: { defaultBlock: 'paragraph' },
      });

      (controller as unknown as { enable: () => void }).enable();

      const block = makeBlock();
      blok.BlockManager.currentBlock = block as unknown as typeof blok.BlockManager.currentBlock;

      const newBlock = { id: 'converted' };
      (blok.BlockManager.convert as ReturnType<typeof vi.fn>).mockResolvedValue(newBlock);

      const event = createTurnIntoEvent('Digit1');
      Object.defineProperty(event, 'target', { value: document.body });
      document.dispatchEvent(event);

      // setToBlock runs after the awaited convert() resolves
      await Promise.resolve();
      await Promise.resolve();

      expect(blok.Caret.setToBlock).toHaveBeenCalledWith(newBlock, 'default', 3);
    });

    it('does nothing when there is no current block', () => {
      const { controller, blok } = createKeyboardController({
        configOverrides: { defaultBlock: 'paragraph' },
      });

      (controller as unknown as { enable: () => void }).enable();

      blok.BlockManager.currentBlock = undefined;

      const event = createTurnIntoEvent('Digit1');
      Object.defineProperty(event, 'target', { value: document.body });
      document.dispatchEvent(event);

      expect(blok.BlockManager.convert).not.toHaveBeenCalled();
    });
  });

  describe('List creation shortcuts (BUG A/B)', () => {
    const isMac = process.platform === 'darwin';

    // Mac: Cmd+Shift+N, Win/Linux: Ctrl+Shift+N (per style-config advertised combos).
    const createListEvent = (code: string): KeyboardEvent => {
      const modifiers = isMac
        ? { metaKey: true, shiftKey: true }
        : { ctrlKey: true, shiftKey: true };

      return new KeyboardEvent('keydown', { key: code.replace('Digit', ''), code, ...modifiers });
    };

    const makeBlock = (): Block => ({
      id: 'block-1',
      name: 'paragraph',
      holder: document.createElement('div'),
    } as unknown as Block);

    it.each([
      ['Digit5', 'unordered'],
      ['Digit6', 'ordered'],
      ['Digit7', 'checklist'],
    ])('converts the current block to a list with %s', (code, style) => {
      const { controller, blok } = createKeyboardController({
        configOverrides: { defaultBlock: 'paragraph' },
      });

      (controller as unknown as { enable: () => void }).enable();

      const block = makeBlock();
      blok.BlockManager.currentBlock = block as unknown as typeof blok.BlockManager.currentBlock;

      const event = createListEvent(code);
      Object.defineProperty(event, 'target', { value: document.body });
      document.dispatchEvent(event);

      expect(blok.BlockManager.convert).toHaveBeenCalledWith(block, 'list', { style });
    });

    it('converts the current block into a to-do list (BUG B)', () => {
      const { controller, blok } = createKeyboardController({
        configOverrides: { defaultBlock: 'paragraph' },
      });

      (controller as unknown as { enable: () => void }).enable();

      const block = makeBlock();
      blok.BlockManager.currentBlock = block as unknown as typeof blok.BlockManager.currentBlock;

      const event = createListEvent('Digit7');
      Object.defineProperty(event, 'target', { value: document.body });
      document.dispatchEvent(event);

      expect(blok.BlockManager.convert).toHaveBeenCalledWith(block, 'list', { style: 'checklist' });
    });

    it('wraps the list conversion in stopCapturing so it is its own undo step', () => {
      const { controller, blok } = createKeyboardController({
        configOverrides: { defaultBlock: 'paragraph' },
      });

      (controller as unknown as { enable: () => void }).enable();

      blok.BlockManager.currentBlock = makeBlock() as unknown as typeof blok.BlockManager.currentBlock;

      const event = createListEvent('Digit5');
      Object.defineProperty(event, 'target', { value: document.body });
      document.dispatchEvent(event);

      expect(blok.YjsManager.stopCapturing).toHaveBeenCalled();
    });

    it('prevents the browser from inserting the digit', () => {
      const { controller, blok } = createKeyboardController({
        configOverrides: { defaultBlock: 'paragraph' },
      });

      (controller as unknown as { enable: () => void }).enable();

      blok.BlockManager.currentBlock = makeBlock() as unknown as typeof blok.BlockManager.currentBlock;

      const event = createListEvent('Digit5');
      const preventDefaultSpy = vi.fn();
      Object.defineProperty(event, 'preventDefault', { value: preventDefaultSpy });
      Object.defineProperty(event, 'target', { value: document.body });
      document.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('does nothing when there is no current block', () => {
      const { controller, blok } = createKeyboardController({
        configOverrides: { defaultBlock: 'paragraph' },
      });

      (controller as unknown as { enable: () => void }).enable();

      blok.BlockManager.currentBlock = undefined;

      const event = createListEvent('Digit5');
      Object.defineProperty(event, 'target', { value: document.body });
      document.dispatchEvent(event);

      expect(blok.BlockManager.convert).not.toHaveBeenCalled();
    });

    it('is a no-op in read-only mode (controller disabled)', () => {
      const { controller, blok } = createKeyboardController({
        configOverrides: { defaultBlock: 'paragraph' },
      });

      (controller as unknown as { enable: () => void }).enable();
      // Read-only toggle disables the controller.
      (controller as unknown as { disable: () => void }).disable();

      blok.BlockManager.currentBlock = makeBlock() as unknown as typeof blok.BlockManager.currentBlock;

      const event = createListEvent('Digit5');
      Object.defineProperty(event, 'target', { value: document.body });
      document.dispatchEvent(event);

      expect(blok.BlockManager.convert).not.toHaveBeenCalled();
    });

    it.skipIf(isMac)('lets the list combo win over Heading 5/6 on Win/Linux (Ctrl+Shift+5/6 collision)', () => {
      const { controller, blok } = createKeyboardController({
        configOverrides: { defaultBlock: 'paragraph' },
      });

      (controller as unknown as { enable: () => void }).enable();

      const block = makeBlock();
      blok.BlockManager.currentBlock = block as unknown as typeof blok.BlockManager.currentBlock;

      const event = new KeyboardEvent('keydown', { key: '5', code: 'Digit5', ctrlKey: true, shiftKey: true });
      Object.defineProperty(event, 'target', { value: document.body });
      document.dispatchEvent(event);

      expect(blok.BlockManager.convert).toHaveBeenCalledWith(block, 'list', { style: 'unordered' });
      expect(blok.BlockManager.convert).not.toHaveBeenCalledWith(block, 'header', { level: 5 });
    });
  });

  describe('Ctrl+Y redo alias (D9)', () => {
    it('calls redo when Ctrl+Y is pressed', () => {
      const { controller, blok } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      const event = new KeyboardEvent('keydown', { key: 'y', ctrlKey: true });
      const preventDefaultSpy = vi.fn().mockImplementation(() => {
        Object.defineProperty(event, 'defaultPrevented', { value: true, configurable: true });
      });
      Object.defineProperty(event, 'preventDefault', { value: preventDefaultSpy });
      const stopPropagationSpy = vi.fn();
      Object.defineProperty(event, 'stopPropagation', { value: stopPropagationSpy });
      document.dispatchEvent(event);

      expect(blok.YjsManager.redo).toHaveBeenCalledTimes(1);
      expect(blok.YjsManager.undo).not.toHaveBeenCalled();
      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('calls redo when Ctrl+Y is pressed with uppercase Y', () => {
      const { controller, blok } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      const event = new KeyboardEvent('keydown', { key: 'Y', ctrlKey: true });
      document.dispatchEvent(event);

      expect(blok.YjsManager.redo).toHaveBeenCalledTimes(1);
    });

    it('does nothing when Y is pressed without a modifier', () => {
      const { controller, blok } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      const event = new KeyboardEvent('keydown', { key: 'y' });
      document.dispatchEvent(event);

      expect(blok.YjsManager.redo).not.toHaveBeenCalled();
    });

    it('does NOT redo via Ctrl+Y while a drag is active', () => {
      const { controller, blok } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      Object.assign(blok.DragManager, { isDragging: true });

      const event = new KeyboardEvent('keydown', { key: 'y', ctrlKey: true });
      document.dispatchEvent(event);

      expect(blok.YjsManager.redo).not.toHaveBeenCalled();
    });
  });

  describe('Default key handling', () => {
    it('ignores keydowns from inside BlockSettings', () => {
      const { controller, blok } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      const target = document.createElement('div');
      vi.mocked(blok.BlockSettings.contains).mockReturnValue(true);

      const event = new KeyboardEvent('keydown', { key: 'a' });
      Object.defineProperty(event, 'target', { value: target });
      document.dispatchEvent(event);

      expect(blok.BlockManager.unsetCurrentBlock).not.toHaveBeenCalled();
    });

    it('handles navigation mode keys when enabled', () => {
      const { controller, blok } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      Object.assign(blok.BlockSelection, { navigationModeEnabled: true });

      const event = new KeyboardEvent('keydown', { key: 'a' });
      document.dispatchEvent(event);

      expect(blok.BlockEvents.keydown).toHaveBeenCalled();
      // The event is delegated to BlockEvents.keydown which handles prevention
      // The controller doesn't call preventDefault itself for navigation mode (see line 418-419)
      expect(event.defaultPrevented).toBe(false);
    });

    it('calls BlockEvents.keydown when current block is set and keydown outside blok', () => {
      const { controller, blok } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      blok.BlockManager.currentBlock = {
        id: 'test',
        name: 'paragraph',
        holder: document.createElement('div'),
      } as unknown as typeof blok.BlockManager.currentBlock;
      Object.assign(blok.BlockSelection, { navigationModeEnabled: false, anyBlockSelected: false });

      const outsideTarget = document.createElement('div');
      document.body.appendChild(outsideTarget);

      const event = new KeyboardEvent('keydown', { key: 'a' });
      Object.defineProperty(event, 'target', { value: outsideTarget });
      document.dispatchEvent(event);

      // When currentBlock is set and keydown is outside blok, delegate to BlockEvents
      expect(blok.BlockEvents.keydown).toHaveBeenCalledWith(event);
      expect(blok.BlockManager.unsetCurrentBlock).not.toHaveBeenCalled();
    });
  });

  describe('caret capture', () => {
    it('captures caret before input', () => {
      const { controller, blok, redactor } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      const event = new InputEvent('beforeinput');
      redactor.dispatchEvent(event);

      expect(blok.YjsManager.markCaretBeforeChange).toHaveBeenCalledTimes(1);
      // The beforeinput event is not prevented - it's allowed to bubble
      expect(event.defaultPrevented).toBe(false);
    });

    it('captures caret for keys requiring capture', () => {
      const { controller, blok, redactor } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      redactor.dispatchEvent(event);

      // markCaretBeforeChange is called from the redactor capture listener for Enter key
      expect(blok.YjsManager.markCaretBeforeChange).toHaveBeenCalled();
      // Event is not prevented in the capture phase
      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe('nested editor instance guard', () => {
    it('skips handleKeydown when event target is inside a different editor instance', () => {
      const { controller, blok } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      // Create a second (inner) editor wrapper inside the DOM but NOT inside the outer wrapper
      const innerEditorWrapper = document.createElement('div');

      innerEditorWrapper.setAttribute('data-blok-testid', 'blok-editor');
      document.body.appendChild(innerEditorWrapper);

      const innerContentEditable = document.createElement('div');

      innerContentEditable.setAttribute('contenteditable', 'true');
      innerEditorWrapper.appendChild(innerContentEditable);

      // Dispatch Cmd+Z from inside the inner editor
      const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true });

      Object.defineProperty(event, 'target', { value: innerContentEditable });
      document.dispatchEvent(event);

      // The outer editor should NOT process this event
      expect(blok.YjsManager.undo).not.toHaveBeenCalled();
    });

    it('processes handleKeydown when event target is inside this editor instance', () => {
      const { controller, blok, wrapper } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      // Create a contenteditable inside the outer editor wrapper
      const contentEditable = document.createElement('div');

      contentEditable.setAttribute('contenteditable', 'true');
      wrapper.appendChild(contentEditable);

      // Dispatch Cmd+Z from inside this editor
      const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true });

      Object.defineProperty(event, 'target', { value: contentEditable });

      const preventDefaultSpy = vi.fn().mockImplementation(() => {
        Object.defineProperty(event, 'defaultPrevented', { value: true, configurable: true });
      });

      Object.defineProperty(event, 'preventDefault', { value: preventDefaultSpy });
      const stopPropagationSpy = vi.fn();

      Object.defineProperty(event, 'stopPropagation', { value: stopPropagationSpy });
      document.dispatchEvent(event);

      // The outer editor SHOULD process this event
      expect(blok.YjsManager.undo).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it('processes handleKeydown when event target has no editor ancestor', () => {
      const { controller, blok } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      // Dispatch Cmd+Z with target as document.body (no editor ancestor)
      const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true });

      Object.defineProperty(event, 'target', { value: document.body });

      const preventDefaultSpy = vi.fn().mockImplementation(() => {
        Object.defineProperty(event, 'defaultPrevented', { value: true, configurable: true });
      });

      Object.defineProperty(event, 'preventDefault', { value: preventDefaultSpy });
      const stopPropagationSpy = vi.fn();

      Object.defineProperty(event, 'stopPropagation', { value: stopPropagationSpy });
      document.dispatchEvent(event);

      // Should process normally when there is no editor ancestor
      expect(blok.YjsManager.undo).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it('skips redactor keydown caret capture when event target is inside a different editor', () => {
      const { controller, blok, redactor } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      // Create a nested editor wrapper inside the redactor element
      const innerEditorWrapper = document.createElement('div');

      innerEditorWrapper.setAttribute('data-blok-testid', 'blok-editor');
      redactor.appendChild(innerEditorWrapper);

      const innerContentEditable = document.createElement('div');

      innerContentEditable.setAttribute('contenteditable', 'true');
      innerEditorWrapper.appendChild(innerContentEditable);

      // Dispatch Enter keydown from the inner editor's contenteditable on the redactor
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });

      innerContentEditable.dispatchEvent(event);

      // The outer editor's caret capture should NOT fire for the inner editor's events
      expect(blok.YjsManager.markCaretBeforeChange).not.toHaveBeenCalled();
    });
  });

  describe('native input element guard', () => {
    it('skips handleKeydown when event target is an input element', () => {
      const { controller, blok, wrapper } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      const input = document.createElement('input');

      wrapper.appendChild(input);

      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });

      input.dispatchEvent(event);

      expect(blok.BlockManager.insert).not.toHaveBeenCalled();
      expect(blok.BlockSelection.clearSelection).not.toHaveBeenCalled();
    });

    it('skips handleKeydown when event target is a textarea element', () => {
      const { controller, blok, wrapper } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      const textarea = document.createElement('textarea');

      wrapper.appendChild(textarea);

      const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true });

      textarea.dispatchEvent(event);

      expect(blok.BlockManager.deleteSelectedBlocksAndInsertReplacement).not.toHaveBeenCalled();
    });

    it('skips redactor keydown caret capture when event target is an input element', () => {
      const { controller, blok, redactor } = createKeyboardController();

      (controller as unknown as { enable: () => void }).enable();

      const input = document.createElement('input');

      redactor.appendChild(input);

      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });

      input.dispatchEvent(event);

      expect(blok.YjsManager.markCaretBeforeChange).not.toHaveBeenCalled();
    });
  });
});
