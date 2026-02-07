import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardController } from '../../../../../src/components/modules/uiControllers/controllers/keyboard';
import { SelectionUtils as Selection } from '../../../../../src/components/selection';
import type { Block } from '../../../../../src/components/block';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { BlokConfig } from '../../../../../types';
import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import { PopoverRegistry } from '../../../../../src/components/utils/popover/popover-registry';
import type { PopoverAbstract } from '../../../../../src/components/utils/popover/popover-abstract';

const createBlokStub = (): BlokModules => {
  const blockSettingsWrapper = document.createElement('div');
  const toolbarWrapper = document.createElement('div');
  const toolbarSettingsToggler = document.createElement('button');
  const toolbarPlusButton = document.createElement('button');

  return {
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
      },
    },
    YjsManager: {
      markCaretBeforeChange: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
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

    // Register for cleanup
    controllers.push(controller);

    return { controller, blok, redactor, eventsDispatcher };
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

    it('closes Toolbox when open and sets caret', () => {
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
      expect(blok.Caret.setToBlock).toHaveBeenCalledWith(blok.BlockManager.currentBlock, blok.Caret.positions.END);
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
});
