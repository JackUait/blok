import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Toolbox, ToolboxEvent } from '../../../src/components/ui/toolbox';
import type { API, BlockToolData, ToolboxConfigEntry, BlockAPI } from '@/types';
import type { BlockToolAdapter } from '../../../src/components/tools/block';
import type { ToolsCollection } from '../../../src/components/tools/collection';
import type { Popover } from '../../../src/components/utils/popover';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import { BlokMobileLayoutToggled } from '../../../src/components/events';
import { Shortcuts } from '../../../src/components/utils/shortcuts';

/**
 * Creates a mock ToolsCollection with proper forEach implementation
 * instead of binding Map.prototype.forEach
 */
const createToolsCollection = <T extends BlockToolAdapter>(entries: [string, T][]): ToolsCollection<T> => {
  const map = new Map<string, T>(entries);

  return {
    get: (key: string) => map.get(key),
    set: (key: string, value: T) => map.set(key, value),
    has: (key: string) => map.has(key),
    delete: (key: string) => map.delete(key),
    clear: () => map.clear(),
    get size(): number {
      return map.size;
    },
    keys: () => map.keys(),
    values: () => map.values(),
    entries: () => map.entries(),
    forEach: (callbackfn: (value: T, key: string, map: Map<string, T>) => void, thisArg?: unknown) => {
      for (const [key, value] of map.entries()) {
        callbackfn.call(thisArg, value, key, map);
      }
    },
    [Symbol.iterator]: () => map[Symbol.iterator](),
  } as unknown as ToolsCollection<T>;
};

// Use vi.hoisted to create mock instance that can be shared between factory and tests
const mockPopoverInstance = vi.hoisted(() => ({
  show: vi.fn(),
  hide: vi.fn(),
  destroy: vi.fn(),
  getElement: vi.fn(() => document.createElement('div')),
  on: vi.fn(),
  off: vi.fn(),
  hasFocus: vi.fn(() => false),
  filterItems: vi.fn(),
}));

vi.mock('../../../src/components/dom', () => ({
  Dom: {
    make: vi.fn((tag: string, classNames: string) => {
      const el = document.createElement(tag);

      el.setAttribute('data-blok-testid', classNames);

      return el;
    }),
  },
}));

vi.mock('../../../src/components/utils/popover', () => {
  return {
    PopoverDesktop: class MockPopoverDesktop {
      public show = mockPopoverInstance.show;
      public hide = mockPopoverInstance.hide;
      public destroy = mockPopoverInstance.destroy;
      public getElement = mockPopoverInstance.getElement;
      public on = mockPopoverInstance.on;
      public off = mockPopoverInstance.off;
      public hasFocus = mockPopoverInstance.hasFocus;
      public filterItems = mockPopoverInstance.filterItems;
    },
    PopoverMobile: class MockPopoverMobile {
      public show = mockPopoverInstance.show;
      public hide = mockPopoverInstance.hide;
      public destroy = mockPopoverInstance.destroy;
      public getElement = mockPopoverInstance.getElement;
      public on = mockPopoverInstance.on;
      public off = mockPopoverInstance.off;
      public hasFocus = mockPopoverInstance.hasFocus;
      public filterItems = mockPopoverInstance.filterItems;
    },
  };
});

vi.mock('../../../src/components/utils/shortcuts', () => ({
  Shortcuts: {
    add: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock('../../../src/components/utils', async () => {
  const actual = await vi.importActual('../../../src/components/utils');

  return {
    ...actual,
    isMobileScreen: vi.fn(() => false),
    cacheable: (target: unknown, propertyKey: string, descriptor: PropertyDescriptor) => descriptor,
  };
});

/**
 * Unit tests for toolbox.ts
 *
 * Tests internal functionality and edge cases not covered by E2E tests
 */
describe('Toolbox', () => {
  const i18nLabels: Record<'filter' | 'nothingFound', string> = {
    filter: 'Filter',
    nothingFound: 'Nothing found',
  };

  // Mock i18n instance for Toolbox
  const mockI18n = {
    t: vi.fn((key: string) => key),
    has: vi.fn(() => false),
  };

  const mocks = {
    api: undefined as unknown as API,
    tools: undefined as unknown as ToolsCollection<BlockToolAdapter>,
    blockToolAdapter: undefined as unknown as BlockToolAdapter,
    blockAPI: undefined as unknown as BlockAPI,
  };

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock BlockAPI
    const holderElement = document.createElement('div');
    const contentEditableElement = document.createElement('div');

    contentEditableElement.setAttribute('contenteditable', 'true');
    contentEditableElement.textContent = '';
    holderElement.appendChild(contentEditableElement);

    const blockAPI = {
      id: 'test-block-id',
      isEmpty: true,
      call: vi.fn(),
      holder: holderElement,
    } as unknown as BlockAPI;

    // Mock BlockToolAdapter
    const blockToolAdapter = {
      name: 'testTool',
      toolbox: {
        title: 'Test Tool',
        icon: '<svg>test</svg>',
      },
      shortcut: 'CMD+T',
    } as unknown as BlockToolAdapter;

    // Mock ToolsCollection using helper
    const tools = createToolsCollection([
      ['testTool', blockToolAdapter],
    ]);

    // Mock API
    const api = {
      blocks: {
        getCurrentBlockIndex: vi.fn(() => 0),
        getBlockByIndex: vi.fn(() => blockAPI),
        convert: vi.fn(),
        composeBlockData: vi.fn(async () => ({})),
        insert: vi.fn(() => blockAPI),
        stopBlockMutationWatching: vi.fn(),
      },
      caret: {
        setToBlock: vi.fn(),
      },
      toolbar: {
        close: vi.fn(),
      },
      ui: {
        nodes: {
          redactor: document.createElement('div'),
        },
      },
      events: {
        on: vi.fn(),
        off: vi.fn(),
      },
    } as unknown as API;

    // Update mocks object (mutation instead of reassignment)
    mocks.blockAPI = blockAPI;
    mocks.blockToolAdapter = blockToolAdapter;
    mocks.tools = tools;
    mocks.api = api;
  });

  describe('constructor', () => {
    it('should initialize toolbox with correct structure', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      const element = toolbox.getElement();

      expect(element).not.toBeNull();
      expect(element?.getAttribute('data-blok-testid')).toBe('toolbox');
    });

    it('should set data-blok-testid attribute in test mode', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      const element = toolbox.getElement();

      expect(element?.getAttribute('data-blok-testid')).toBe('toolbox');
    });

    it('should initialize with opened = false', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      expect(toolbox.opened).toBe(false);
    });

    it('should register BlokMobileLayoutToggled event listener', () => {
      new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      expect(mocks.api.events.on).toHaveBeenCalledWith(
        BlokMobileLayoutToggled,
        expect.any(Function)
      );
    });
  });

  describe('isEmpty', () => {
    it('should return true when no tools have toolbox configuration', () => {
      const emptyTools = createToolsCollection([]);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools: emptyTools,
        i18nLabels,
        i18n: mockI18n,
      });

      expect(toolbox.isEmpty).toBe(true);
    });

    it('should return false when tools have toolbox configuration', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      expect(toolbox.isEmpty).toBe(false);
    });

    it('should return true when tool has toolbox set to undefined', () => {
      const toolWithoutToolbox = {
        name: 'noToolboxTool',
        toolbox: undefined,
      } as unknown as BlockToolAdapter;

      const tools = createToolsCollection([
        ['noToolboxTool', toolWithoutToolbox],
      ]);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools,
        i18nLabels,
        i18n: mockI18n,
      });

      expect(toolbox.isEmpty).toBe(true);
    });
  });

  describe('getElement', () => {
    it('should return the toolbox element', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      const element = toolbox.getElement();

      expect(element).not.toBeNull();
      expect(element?.tagName).toBe('DIV');
    });
  });

  describe('hasFocus', () => {
    it('should return undefined when popover is not initialized', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      // Access private popover and set to null
      (toolbox as unknown as { popover: Popover | null }).popover = null;

      expect(toolbox.hasFocus()).toBeUndefined();
    });

    it('should return popover hasFocus result when popover exists', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      mockPopoverInstance.hasFocus.mockReturnValue(true);

      expect(toolbox.hasFocus()).toBe(true);
    });
  });

  describe('open', () => {
    it('should open popover and set opened to true', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      const emitSpy = vi.spyOn(toolbox, 'emit');

      toolbox.open();

      expect(mockPopoverInstance.show).toHaveBeenCalled();
      expect(toolbox.opened).toBe(true);
      expect(emitSpy).toHaveBeenCalledWith(ToolboxEvent.Opened);
    });

    it('should not open when toolbox is empty', () => {
      const emptyTools = createToolsCollection([]);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools: emptyTools,
        i18nLabels,
        i18n: mockI18n,
      });

      const emitSpy = vi.spyOn(toolbox, 'emit');

      toolbox.open();

      expect(mockPopoverInstance.show).not.toHaveBeenCalled();
      expect(toolbox.opened).toBe(false);
      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('should close popover and set opened to false', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.opened = true;
      const emitSpy = vi.spyOn(toolbox, 'emit');

      toolbox.close();

      expect(mockPopoverInstance.hide).toHaveBeenCalled();
      expect(toolbox.opened).toBe(false);
      expect(emitSpy).toHaveBeenCalledWith(ToolboxEvent.Closed);
    });
  });

  describe('toggle', () => {
    it('should open when closed', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.opened = false;
      toolbox.toggle();

      // Verify actual outcome - toolbox should be opened
      expect(toolbox.opened).toBe(true);
      expect(mockPopoverInstance.show).toHaveBeenCalled();
    });

    it('should close when opened', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.opened = true;
      toolbox.toggle();

      // Verify actual outcome - toolbox should be closed
      expect(toolbox.opened).toBe(false);
      expect(mockPopoverInstance.hide).toHaveBeenCalled();
    });
  });

  describe('toolButtonActivated', () => {
    it('should call insertNewBlock with tool name and data overrides', async () => {
      // Ensure mocks return valid values before creating toolbox
      vi.mocked(mocks.api.blocks.getCurrentBlockIndex).mockReturnValue(0);
      vi.mocked(mocks.api.blocks.getBlockByIndex).mockReturnValue(mocks.blockAPI);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      const blockDataOverrides: BlockToolData = { test: 'data' };

      await toolbox.toolButtonActivated('testTool', blockDataOverrides);

      // Verify actual outcome - block should be inserted with correct parameters
      // Since blockAPI.isEmpty is true, it replaces at index 0
      // blockDataOverrides is merged with composeBlockData result
      expect(mocks.api.blocks.insert).toHaveBeenCalledWith(
        'testTool',
        { test: 'data' },
        undefined,
        0,
        undefined,
        true
      );
    });

    it('should insert block with overridden data', async () => {
      // Ensure mocks return valid values before creating toolbox
      vi.mocked(mocks.api.blocks.getCurrentBlockIndex).mockReturnValue(0);
      vi.mocked(mocks.api.blocks.getBlockByIndex).mockReturnValue(mocks.blockAPI);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      const blockDataOverrides: BlockToolData = { customProp: 'value' };

      await toolbox.toolButtonActivated('testTool', blockDataOverrides);

      // Verify actual outcome - composeBlockData should be called and insert should happen
      expect(mocks.api.blocks.composeBlockData).toHaveBeenCalledWith('testTool');
      expect(mocks.api.blocks.insert).toHaveBeenCalled();
    });
  });

  describe('handleMobileLayoutToggle', () => {
    it('should destroy and reinitialize popover', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      // First open the toolbox to establish initial state
      toolbox.open();
      expect(toolbox.opened).toBe(true);
      expect(mockPopoverInstance.show).toHaveBeenCalled();

      // Clear the mock to track fresh calls
      vi.clearAllMocks();

      toolbox.handleMobileLayoutToggle();

      // Verify actual outcome - popover should be destroyed and reinitialized
      expect(mockPopoverInstance.hide).toHaveBeenCalled();
      expect(mockPopoverInstance.destroy).toHaveBeenCalled();
      // Note: opened state remains true since handleMobileLayoutToggle only reinitializes the popover
      expect(toolbox.opened).toBe(true);
    });
  });

  describe('destroy', () => {
    it('should remove toolbox element from DOM', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      const element = toolbox.getElement();

      if (element) {
        document.body.appendChild(element);

        expect(document.body.contains(element)).toBe(true);

        toolbox.destroy();

        expect(document.body.contains(element)).toBe(false);
      }
    });

    it('should remove popover event listener', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.destroy();

      expect(mockPopoverInstance.off).toHaveBeenCalledWith(
        PopoverEvent.Closed,
        expect.any(Function)
      );
    });

    it('should remove BlokMobileLayoutToggled event listener', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.destroy();

      expect(mocks.api.events.off).toHaveBeenCalledWith(
        BlokMobileLayoutToggled,
        expect.any(Function)
      );
    });

    it('should call super.destroy()', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      const element = toolbox.getElement();
      if (element) {
        document.body.appendChild(element);

        toolbox.destroy();

        // Verify actual outcome - element should be removed from DOM (side effect of super.destroy())
        expect(document.body.contains(element)).toBe(false);
      }
    });
  });

  describe('onPopoverClose', () => {
    it('should set opened to false and emit Closed event when popover closes', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.opened = true;
      const emitSpy = vi.spyOn(toolbox, 'emit');

      // Simulate popover close event
      const closeHandler = (mockPopoverInstance.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (call): call is [string, () => void] => call[0] === PopoverEvent.Closed
      )?.[1];

      if (closeHandler) {
        closeHandler();
      }

      expect(toolbox.opened).toBe(false);
      expect(emitSpy).toHaveBeenCalledWith(ToolboxEvent.Closed);
    });
  });

  describe('toolbox items with multiple entries', () => {
    it('should handle tool with array toolbox config', () => {
      const toolWithMultipleEntries = {
        name: 'multiTool',
        toolbox: [
          {
            title: 'Entry 1',
            icon: '<svg>1</svg>',
          },
          {
            title: 'Entry 2',
            icon: '<svg>2</svg>',
          },
        ] as ToolboxConfigEntry[],
      } as unknown as BlockToolAdapter;

      const tools = createToolsCollection([
        ['multiTool', toolWithMultipleEntries],
      ]);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools,
        i18nLabels,
        i18n: mockI18n,
      });

      expect(toolbox.isEmpty).toBe(false);
    });
  });

  describe('shortcuts', () => {
    it('should enable shortcuts for tools with shortcut configuration', () => {
      new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      // Verify actual outcome - shortcut should be registered with correct name and handler
      const addCalls = vi.mocked(Shortcuts.add).mock.calls;
      expect(addCalls.length).toBeGreaterThan(0);
      const shortcutConfig = addCalls[0]?.[0];
      expect(shortcutConfig).toMatchObject({
        name: 'CMD+T',
        on: mocks.api.ui.nodes.redactor,
      });
      expect(shortcutConfig.handler).toBeInstanceOf(Function);
    });

    it('should not enable shortcuts for tools without shortcut', () => {
      const toolWithoutShortcut = {
        name: 'noShortcutTool',
        toolbox: {
          title: 'Tool',
          icon: '<svg></svg>',
        },
        shortcut: undefined,
      } as unknown as BlockToolAdapter;

      const tools = createToolsCollection([
        ['noShortcutTool', toolWithoutShortcut],
      ]);

      vi.clearAllMocks();

      new Toolbox({
        api: mocks.api,
        tools,
        i18nLabels,
        i18n: mockI18n,
      });

      // Should not be called for tools without shortcuts
      expect(Shortcuts.add).not.toHaveBeenCalled();
    });
  });

  describe('insertNewBlock', () => {
    it('should insert block at current index when block is empty', async () => {
      const emptyBlock = {
        ...mocks.blockAPI,
        isEmpty: true,
      };

      vi.mocked(mocks.api.blocks.getCurrentBlockIndex).mockReturnValue(0);
      vi.mocked(mocks.api.blocks.getBlockByIndex).mockReturnValue(emptyBlock as BlockAPI);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      await toolbox.toolButtonActivated('testTool', {});

      expect(mocks.api.blocks.insert).toHaveBeenCalledWith(
        'testTool',
        undefined,
        undefined,
        0,
        undefined,
        true
      );
    });

    it('should insert block at next index when block is not empty', async () => {
      const nonEmptyBlock = {
        ...mocks.blockAPI,
        isEmpty: false,
      };

      vi.mocked(mocks.api.blocks.getCurrentBlockIndex).mockReturnValue(0);
      vi.mocked(mocks.api.blocks.getBlockByIndex).mockReturnValue(nonEmptyBlock as BlockAPI);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      await toolbox.toolButtonActivated('testTool', {});

      expect(mocks.api.blocks.insert).toHaveBeenCalledWith(
        'testTool',
        undefined,
        undefined,
        1,
        undefined,
        false
      );
    });

    it('should emit BlockAdded event after inserting block', async () => {
      vi.mocked(mocks.api.blocks.getCurrentBlockIndex).mockReturnValue(0);
      vi.mocked(mocks.api.blocks.getBlockByIndex).mockReturnValue(mocks.blockAPI);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      const emitSpy = vi.spyOn(toolbox, 'emit');

      await toolbox.toolButtonActivated('testTool', {});

      // Verify actual outcome - event should be emitted AND block should be inserted
      expect(emitSpy).toHaveBeenCalledWith(ToolboxEvent.BlockAdded, {
        block: mocks.blockAPI,
      });
      expect(mocks.api.blocks.insert).toHaveBeenCalled();
    });

    it('should close toolbar after inserting block', async () => {
      vi.mocked(mocks.api.blocks.getCurrentBlockIndex).mockReturnValue(0);
      vi.mocked(mocks.api.blocks.getBlockByIndex).mockReturnValue(mocks.blockAPI);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      const emitSpy = vi.spyOn(toolbox, 'emit');
      await toolbox.toolButtonActivated('testTool', {});

      // Verify actual outcome - toolbar should be closed, block should be inserted, and event should be emitted
      expect(mocks.api.toolbar.close).toHaveBeenCalled();
      expect(mocks.api.blocks.insert).toHaveBeenCalled();
      expect(emitSpy).toHaveBeenCalledWith(ToolboxEvent.BlockAdded, expect.anything());
    });

    it('should not insert block when current block is null', async () => {
      vi.mocked(mocks.api.blocks.getCurrentBlockIndex).mockReturnValue(0);
      vi.mocked(mocks.api.blocks.getBlockByIndex).mockReturnValue(undefined);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      await toolbox.toolButtonActivated('testTool', {});

      expect(mocks.api.blocks.insert).not.toHaveBeenCalled();
    });
  });

  describe('shortcut handler', () => {
    it('should convert block when conversion is possible', async () => {
      new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      const convertedBlock = { id: 'converted-block' } as BlockAPI;

      vi.mocked(mocks.api.blocks.convert).mockResolvedValue(convertedBlock);

      const addCalls = vi.mocked(Shortcuts.add).mock.calls;
      const addCall = addCalls[0]?.[0];

      if (addCall && addCall.handler) {
        const event = { preventDefault: vi.fn() } as unknown as KeyboardEvent;

        await addCall.handler(event);

        expect(event.preventDefault).toHaveBeenCalled();
        expect(mocks.api.blocks.convert).toHaveBeenCalled();
        expect(mocks.api.caret.setToBlock).toHaveBeenCalledWith(convertedBlock, 'end');
      }
    });

    it('should insert new block when conversion fails', async () => {
      new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      vi.mocked(mocks.api.blocks.convert).mockRejectedValue(new Error('Conversion failed'));
      vi.mocked(mocks.api.blocks.getCurrentBlockIndex).mockReturnValue(0);
      vi.mocked(mocks.api.blocks.getBlockByIndex).mockReturnValue(mocks.blockAPI);

      const addCalls = vi.mocked(Shortcuts.add).mock.calls;
      const addCall = addCalls[0]?.[0];

      if (addCall && addCall.handler) {
        const event = { preventDefault: vi.fn() } as unknown as KeyboardEvent;

        await addCall.handler(event);

        // Verify actual outcome - block should be inserted when conversion fails
        // Since blockAPI.isEmpty is true, it replaces at index 0
        expect(mocks.api.blocks.insert).toHaveBeenCalledWith(
          'testTool',
          undefined,
          undefined,
          0,
          undefined,
          true
        );
        expect(event.preventDefault).toHaveBeenCalled();
      }
    });

    it('should call insertNewBlock when current block is null but it returns early', async () => {
      new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      vi.mocked(mocks.api.blocks.getCurrentBlockIndex).mockReturnValue(0);
      vi.mocked(mocks.api.blocks.getBlockByIndex).mockReturnValue(undefined);

      const addCalls = vi.mocked(Shortcuts.add).mock.calls;
      const addCall = addCalls[0]?.[0];

      if (addCall && addCall.handler) {
        const event = { preventDefault: vi.fn() } as unknown as KeyboardEvent;

        await addCall.handler(event);

        // insertNewBlock is called but returns early when currentBlock is null
        // so blocks.insert should not be called
        expect(mocks.api.blocks.insert).not.toHaveBeenCalled();
      }
    });
  });
});
