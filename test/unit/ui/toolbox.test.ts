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
  toggleItemHiddenByName: vi.fn(),
  updatePosition: vi.fn(),
  setLeftAlignElement: vi.fn(),
}));

/**
 * Captures items passed to the last PopoverDesktop constructor call
 */
const lastPopoverItems = vi.hoisted(() => ({ value: [] as unknown[] }));

/**
 * Captures all params passed to the last PopoverDesktop constructor call
 */
const lastPopoverParams = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

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
      constructor(params: { items?: unknown[]; [key: string]: unknown }) {
        lastPopoverItems.value = params.items ?? [];
        lastPopoverParams.value = params;
      }
      public show = mockPopoverInstance.show;
      public hide = mockPopoverInstance.hide;
      public destroy = mockPopoverInstance.destroy;
      public getElement = mockPopoverInstance.getElement;
      public on = mockPopoverInstance.on;
      public off = mockPopoverInstance.off;
      public hasFocus = mockPopoverInstance.hasFocus;
      public filterItems = mockPopoverInstance.filterItems;
      public toggleItemHiddenByName = mockPopoverInstance.toggleItemHiddenByName;
      public updatePosition = mockPopoverInstance.updatePosition;
      public setLeftAlignElement = mockPopoverInstance.setLeftAlignElement;
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
      public toggleItemHiddenByName = mockPopoverInstance.toggleItemHiddenByName;
      public updatePosition = mockPopoverInstance.updatePosition;
      public setLeftAlignElement = mockPopoverInstance.setLeftAlignElement;
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
  describe('updateLeftAlignElement', () => {
    it('forwards new element to the popover via setLeftAlignElement', () => {
      const newElement = document.createElement('div');

      const toolbox = new Toolbox({
        api: {
          blocks: {
            getCurrentBlockIndex: vi.fn(() => 0),
            getBlockByIndex: vi.fn(() => undefined),
            convert: vi.fn(),
            composeBlockData: vi.fn(async () => ({})),
            insert: vi.fn(),
            setBlockParent: vi.fn(),
            transact: vi.fn((fn: () => void) => fn()),
            stopBlockMutationWatching: vi.fn(),
          },
          caret: { setToBlock: vi.fn() },
          toolbar: { close: vi.fn() },
          ui: { nodes: { redactor: document.createElement('div') } },
          events: { on: vi.fn(), off: vi.fn() },
        } as unknown as API,
        tools: createToolsCollection([]),
        i18nLabels: { filter: 'Filter', nothingFound: 'Nothing found', slashSearchPlaceholder: 'Type to search' },
        i18n: { t: vi.fn((key: string) => key), has: vi.fn(() => false) },
      });

      toolbox.updateLeftAlignElement(newElement);

      expect(mockPopoverInstance.setLeftAlignElement).toHaveBeenCalledWith(newElement);
    });
  });

  const i18nLabels: Record<'filter' | 'nothingFound' | 'slashSearchPlaceholder', string> = {
    filter: 'Filter',
    nothingFound: 'Nothing found',
    slashSearchPlaceholder: 'Type to search',
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
        setBlockParent: vi.fn(),
        transact: vi.fn((fn: () => void) => fn()),
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

    it('should pass minWidth of 250px to the popover', () => {
      new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      expect(lastPopoverParams.value).toHaveProperty('minWidth', '250px');
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

  describe('slash search styling', () => {
    it('should set data-blok-slash-search attribute on contenteditable when opened', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.open();

      const contentEditable = mocks.blockAPI.holder.querySelector('[contenteditable="true"]');

      expect(contentEditable?.hasAttribute('data-blok-slash-search')).toBe(true);
    });

    it('should remove data-blok-slash-search attribute when popover closes', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.open();

      const contentEditable = mocks.blockAPI.holder.querySelector('[contenteditable="true"]');

      expect(contentEditable?.hasAttribute('data-blok-slash-search')).toBe(true);

      // Simulate popover close event
      const closeHandler = (mockPopoverInstance.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (call): call is [string, () => void] => call[0] === PopoverEvent.Closed
      )?.[1];

      if (closeHandler) {
        closeHandler();
      }

      expect(contentEditable?.hasAttribute('data-blok-slash-search')).toBe(false);
    });

    it('should remove data-blok-slash-search attribute when toolbox.close() is called', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.open();

      const contentEditable = mocks.blockAPI.holder.querySelector('[contenteditable="true"]');

      expect(contentEditable?.hasAttribute('data-blok-slash-search')).toBe(true);

      toolbox.close();

      expect(contentEditable?.hasAttribute('data-blok-slash-search')).toBe(false);
    });

    it('should set data-blok-slash-search attribute value to i18n slash search placeholder', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.open();

      const contentEditable = mocks.blockAPI.holder.querySelector('[contenteditable="true"]');

      expect(contentEditable?.getAttribute('data-blok-slash-search')).toBe('Type to search');
    });

    it('should clear data-blok-slash-search value when user types a query', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.open();

      const contentEditable = mocks.blockAPI.holder.querySelector('[contenteditable="true"]') as HTMLElement;

      // Simulate typing "/head"
      contentEditable.textContent = '/head';
      contentEditable.dispatchEvent(new Event('input', { bubbles: true })); // eslint-disable-line internal-unit-test/no-direct-event-dispatch -- no DOM API to programmatically trigger input events on contenteditable

      expect(contentEditable.getAttribute('data-blok-slash-search')).toBe('');
    });

    it('should restore data-blok-slash-search value when query is cleared back to just "/"', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.open();

      const contentEditable = mocks.blockAPI.holder.querySelector('[contenteditable="true"]') as HTMLElement;

      // Type query
      contentEditable.textContent = '/head';
      contentEditable.dispatchEvent(new Event('input', { bubbles: true })); // eslint-disable-line internal-unit-test/no-direct-event-dispatch -- no DOM API to programmatically trigger input events on contenteditable
      expect(contentEditable.getAttribute('data-blok-slash-search')).toBe('');

      // Clear query back to just "/"
      contentEditable.textContent = '/';
      contentEditable.dispatchEvent(new Event('input', { bubbles: true })); // eslint-disable-line internal-unit-test/no-direct-event-dispatch -- no DOM API to programmatically trigger input events on contenteditable
      expect(contentEditable.getAttribute('data-blok-slash-search')).toBe('Type to search');
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

    it('should wrap parent-clear, insert, and parent-restore in a single transaction for child blocks', async () => {
      const parentId = 'parent-toggle-id';
      const newBlockAPI = {
        id: 'new-block-id',
        isEmpty: false,
        call: vi.fn(),
        holder: document.createElement('div'),
      } as unknown as BlockAPI;

      const childBlock = {
        ...mocks.blockAPI,
        id: 'child-block-id',
        isEmpty: true,
        parentId,
      };

      vi.mocked(mocks.api.blocks.getCurrentBlockIndex).mockReturnValue(0);
      vi.mocked(mocks.api.blocks.getBlockByIndex).mockReturnValue(childBlock as unknown as BlockAPI);
      vi.mocked(mocks.api.blocks.insert).mockReturnValue(newBlockAPI);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      await toolbox.toolButtonActivated('testTool', {});

      // transact should have been called to group the operations
      expect(mocks.api.blocks.transact).toHaveBeenCalledTimes(1);

      // All three block operations should have been called inside the transaction
      const transactFn = vi.mocked(mocks.api.blocks.transact!).mock.calls[0]?.[0];

      expect(transactFn).toBeTypeOf('function');

      // Verify the operations were called: clear parent, insert, restore parent
      expect(mocks.api.blocks.setBlockParent).toHaveBeenCalledWith('child-block-id', null);
      expect(mocks.api.blocks.insert).toHaveBeenCalled();
      expect(mocks.api.blocks.setBlockParent).toHaveBeenCalledWith('new-block-id', parentId);
    });

    it('should not use transaction when block has no parent', async () => {
      const blockWithoutParent = {
        ...mocks.blockAPI,
        isEmpty: true,
        parentId: undefined,
      };

      vi.mocked(mocks.api.blocks.getCurrentBlockIndex).mockReturnValue(0);
      vi.mocked(mocks.api.blocks.getBlockByIndex).mockReturnValue(blockWithoutParent as unknown as BlockAPI);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      await toolbox.toolButtonActivated('testTool', {});

      // transact should NOT have been called since the block has no parent
      expect(mocks.api.blocks.transact).not.toHaveBeenCalled();
      expect(mocks.api.blocks.setBlockParent).not.toHaveBeenCalled();
    });

    it('should replace block containing search text when toolbox was opened without slash (plus button)', async () => {
      /**
       * Simulate the plus-button flow:
       * 1. Plus button creates an empty block and opens toolbox without slash
       * 2. User types "head" to search — this goes into the block's contentEditable
       * 3. Block is no longer empty (contains "head") but should still be replaced
       */
      const holderElement = document.createElement('div');
      const contentEditableElement = document.createElement('div');

      contentEditableElement.setAttribute('contenteditable', 'true');
      contentEditableElement.textContent = 'head';
      holderElement.appendChild(contentEditableElement);

      const blockWithSearchText = {
        ...mocks.blockAPI,
        isEmpty: false,
        holder: holderElement,
      };

      vi.mocked(mocks.api.blocks.getCurrentBlockIndex).mockReturnValue(0);
      vi.mocked(mocks.api.blocks.getBlockByIndex).mockReturnValue(blockWithSearchText as unknown as BlockAPI);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      // Open toolbox without slash (plus button mode)
      toolbox.open(false);

      await toolbox.toolButtonActivated('testTool', {});

      // Block should be replaced (index 0, shouldReplace=true) despite containing search text
      expect(mocks.api.blocks.insert).toHaveBeenCalledWith(
        'testTool',
        undefined,
        undefined,
        0,
        undefined,
        true
      );
    });
  });

  describe('table tool filtering inside table cells', () => {
    it('should hide table item when opening inside a table cell', () => {
      // Create a table tool adapter
      const tableToolAdapter = {
        name: 'table',
        toolbox: {
          title: 'Table',
          icon: '<svg>table</svg>',
        },
      } as unknown as BlockToolAdapter;

      const tools = createToolsCollection([
        ['testTool', mocks.blockToolAdapter],
        ['table', tableToolAdapter],
      ]);

      // Wrap the block holder in a table cell container
      const cellBlocksContainer = document.createElement('div');

      cellBlocksContainer.setAttribute('data-blok-table-cell-blocks', '');
      cellBlocksContainer.appendChild(mocks.blockAPI.holder);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.open();

      expect(mockPopoverInstance.toggleItemHiddenByName).toHaveBeenCalledWith('table', true);
    });

    it('should not hide table item when opening outside a table cell', () => {
      const tableToolAdapter = {
        name: 'table',
        toolbox: {
          title: 'Table',
          icon: '<svg>table</svg>',
        },
      } as unknown as BlockToolAdapter;

      const tools = createToolsCollection([
        ['testTool', mocks.blockToolAdapter],
        ['table', tableToolAdapter],
      ]);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.open();

      expect(mockPopoverInstance.toggleItemHiddenByName).not.toHaveBeenCalled();
    });

    it('should not hide table item when opening outside cell after previously opening inside cell', () => {
      const tableToolAdapter = {
        name: 'table',
        toolbox: {
          title: 'Table',
          icon: '<svg>table</svg>',
        },
      } as unknown as BlockToolAdapter;

      const tools = createToolsCollection([
        ['testTool', mocks.blockToolAdapter],
        ['table', tableToolAdapter],
      ]);

      // First, wrap the block holder in a table cell container
      const cellBlocksContainer = document.createElement('div');

      cellBlocksContainer.setAttribute('data-blok-table-cell-blocks', '');
      cellBlocksContainer.appendChild(mocks.blockAPI.holder);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools,
        i18nLabels,
        i18n: mockI18n,
      });

      // Open inside cell
      toolbox.open();
      expect(mockPopoverInstance.toggleItemHiddenByName).toHaveBeenCalledWith('table', true);

      // Close
      toolbox.close();
      expect(mockPopoverInstance.toggleItemHiddenByName).toHaveBeenCalledWith('table', false);
      mockPopoverInstance.toggleItemHiddenByName.mockClear();

      // Remove holder from cell container so it's no longer inside a table cell
      cellBlocksContainer.removeChild(mocks.blockAPI.holder);

      // Open outside cell
      toolbox.open();

      // Should NOT have called toggleItemHiddenByName since we're outside a cell now
      expect(mockPopoverInstance.toggleItemHiddenByName).not.toHaveBeenCalled();
    });

    it('should restore table item when popover closes via external trigger (e.g. Escape)', () => {
      const tableToolAdapter = {
        name: 'table',
        toolbox: {
          title: 'Table',
          icon: '<svg>table</svg>',
        },
      } as unknown as BlockToolAdapter;

      const tools = createToolsCollection([
        ['testTool', mocks.blockToolAdapter],
        ['table', tableToolAdapter],
      ]);

      // Wrap the block holder in a table cell container
      const cellBlocksContainer = document.createElement('div');

      cellBlocksContainer.setAttribute('data-blok-table-cell-blocks', '');
      cellBlocksContainer.appendChild(mocks.blockAPI.holder);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.open();
      expect(mockPopoverInstance.toggleItemHiddenByName).toHaveBeenCalledWith('table', true);

      mockPopoverInstance.toggleItemHiddenByName.mockClear();

      // Simulate popover close event (e.g. user presses Escape)
      const closeHandler = (mockPopoverInstance.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (call): call is [string, () => void] => call[0] === PopoverEvent.Closed
      )?.[1];

      if (closeHandler) {
        closeHandler();
      }

      expect(mockPopoverInstance.toggleItemHiddenByName).toHaveBeenCalledWith('table', false);
    });

    it('should show table item again when closing after being inside a table cell', () => {
      const tableToolAdapter = {
        name: 'table',
        toolbox: {
          title: 'Table',
          icon: '<svg>table</svg>',
        },
      } as unknown as BlockToolAdapter;

      const tools = createToolsCollection([
        ['testTool', mocks.blockToolAdapter],
        ['table', tableToolAdapter],
      ]);

      // Wrap the block holder in a table cell container
      const cellBlocksContainer = document.createElement('div');

      cellBlocksContainer.setAttribute('data-blok-table-cell-blocks', '');
      cellBlocksContainer.appendChild(mocks.blockAPI.holder);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.open();

      // Clear to track close-time calls
      mockPopoverInstance.toggleItemHiddenByName.mockClear();

      toolbox.close();

      expect(mockPopoverInstance.toggleItemHiddenByName).toHaveBeenCalledWith('table', false);
    });

    it('hides all header entries when opened inside table cell', () => {
      const headerToolAdapter = {
        name: 'header',
        toolbox: [
          { title: 'Heading 1', icon: '<svg>h1</svg>', name: 'header-1', data: { level: 1 } },
          { title: 'Heading 2', icon: '<svg>h2</svg>', name: 'header-2', data: { level: 2 } },
          { title: 'Heading 3', icon: '<svg>h3</svg>', name: 'header-3', data: { level: 3 } },
        ],
      } as unknown as BlockToolAdapter;

      const tools = createToolsCollection([
        ['testTool', mocks.blockToolAdapter],
        ['header', headerToolAdapter],
      ]);

      // Wrap the block holder in a table cell container
      const cellBlocksContainer = document.createElement('div');

      cellBlocksContainer.setAttribute('data-blok-table-cell-blocks', '');
      cellBlocksContainer.appendChild(mocks.blockAPI.holder);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.open();

      expect(mockPopoverInstance.toggleItemHiddenByName).toHaveBeenCalledWith('header-1', true);
      expect(mockPopoverInstance.toggleItemHiddenByName).toHaveBeenCalledWith('header-2', true);
      expect(mockPopoverInstance.toggleItemHiddenByName).toHaveBeenCalledWith('header-3', true);

      cellBlocksContainer.remove();
    });

    it('does not hide header entries when opened outside table cell', () => {
      const headerToolAdapter = {
        name: 'header',
        toolbox: [
          { title: 'Heading 1', icon: '<svg>h1</svg>', name: 'header-1', data: { level: 1 } },
          { title: 'Heading 2', icon: '<svg>h2</svg>', name: 'header-2', data: { level: 2 } },
        ],
      } as unknown as BlockToolAdapter;

      const tools = createToolsCollection([
        ['testTool', mocks.blockToolAdapter],
        ['header', headerToolAdapter],
      ]);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.open();

      expect(mockPopoverInstance.toggleItemHiddenByName).not.toHaveBeenCalledWith('header-1', true);
      expect(mockPopoverInstance.toggleItemHiddenByName).not.toHaveBeenCalledWith('header-2', true);
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

  describe('open without slash mode (plus button)', () => {
    it('should set data-blok-slash-search placeholder immediately on open (before any typing)', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.open(false);

      const contentEditable = mocks.blockAPI.holder.querySelector('[contenteditable="true"]');

      expect(contentEditable?.getAttribute('data-blok-slash-search')).toBe('Type to search');
    });

    it('should NOT close toolbox when user types without a "/" character', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.open(false);

      const contentEditable = mocks.blockAPI.holder.querySelector('[contenteditable="true"]') as HTMLElement;

      contentEditable.textContent = 'head';
      contentEditable.dispatchEvent(new Event('input', { bubbles: true })); // eslint-disable-line internal-unit-test/no-direct-event-dispatch -- no DOM API to programmatically trigger input events on contenteditable

      expect(toolbox.opened).toBe(true);
      expect(mockPopoverInstance.hide).not.toHaveBeenCalled();
    });

    it('should filter by full text content when no "/" is present', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.open(false);
      vi.clearAllMocks();

      const contentEditable = mocks.blockAPI.holder.querySelector('[contenteditable="true"]') as HTMLElement;

      contentEditable.textContent = 'head';
      contentEditable.dispatchEvent(new Event('input', { bubbles: true })); // eslint-disable-line internal-unit-test/no-direct-event-dispatch -- no DOM API to programmatically trigger input events on contenteditable

      expect(mockPopoverInstance.filterItems).toHaveBeenCalledWith('head');
    });

    it('should filter by empty string when block content is empty', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.open(false);
      vi.clearAllMocks();

      const contentEditable = mocks.blockAPI.holder.querySelector('[contenteditable="true"]') as HTMLElement;

      contentEditable.textContent = '';
      contentEditable.dispatchEvent(new Event('input', { bubbles: true })); // eslint-disable-line internal-unit-test/no-direct-event-dispatch -- no DOM API to programmatically trigger input events on contenteditable

      expect(toolbox.opened).toBe(true);
      expect(mockPopoverInstance.filterItems).toHaveBeenCalledWith('');
    });
  });

  describe('open with slash mode (regression)', () => {
    it('should close when block content has no "/" character', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.open();

      const contentEditable = mocks.blockAPI.holder.querySelector('[contenteditable="true"]') as HTMLElement;

      contentEditable.textContent = 'head';
      contentEditable.dispatchEvent(new Event('input', { bubbles: true })); // eslint-disable-line internal-unit-test/no-direct-event-dispatch -- no DOM API to programmatically trigger input events on contenteditable

      expect(toolbox.opened).toBe(false);
      expect(mockPopoverInstance.hide).toHaveBeenCalled();
    });
  });

  describe('englishTitle for multilingual search', () => {
    it('should resolve englishTitle correctly for tools with dotted titleKey', () => {
      const headerTool = {
        name: 'header',
        toolbox: [
          {
            title: 'Heading 1',
            titleKey: 'tools.header.heading1',
            icon: '<svg>h1</svg>',
            name: 'header-1',
            data: { level: 1 },
          },
        ],
      } as unknown as BlockToolAdapter;

      const apiWithI18n = {
        ...mocks.api,
        i18n: {
          t: vi.fn((key: string) => key),
          has: vi.fn(() => false),
          getEnglishTranslation: vi.fn((key: string) => {
            const translations: Record<string, string> = {
              'tools.header.heading1': 'Heading 1',
              'toolNames.heading': 'Heading',
            };

            return translations[key] ?? '';
          }),
        },
      } as unknown as typeof mocks.api;

      new Toolbox({
        api: apiWithI18n,
        tools: createToolsCollection([['header', headerTool]]),
        i18nLabels,
        i18n: mockI18n,
      });

      const items = lastPopoverItems.value as Array<{ englishTitle?: string }>;
      const headerItem = items.find(item => item.englishTitle !== undefined);

      expect(headerItem).toBeDefined();
      expect(headerItem?.englishTitle).toBe('Heading 1');
    });

    it('should resolve englishTitle correctly for tools with short titleKey', () => {
      const textTool = {
        name: 'paragraph',
        toolbox: {
          title: 'Text',
          titleKey: 'text',
          icon: '<svg>text</svg>',
        },
      } as unknown as BlockToolAdapter;

      const apiWithI18n = {
        ...mocks.api,
        i18n: {
          t: vi.fn((key: string) => key),
          has: vi.fn(() => false),
          getEnglishTranslation: vi.fn((key: string) => {
            const translations: Record<string, string> = {
              'toolNames.text': 'Text',
            };

            return translations[key] ?? '';
          }),
        },
      } as unknown as typeof mocks.api;

      new Toolbox({
        api: apiWithI18n,
        tools: createToolsCollection([['paragraph', textTool]]),
        i18nLabels,
        i18n: mockI18n,
      });

      const items = lastPopoverItems.value as Array<{ englishTitle?: string }>;
      const textItem = items.find(item => item.englishTitle !== undefined);

      expect(textItem).toBeDefined();
      expect(textItem?.englishTitle).toBe('Text');
    });
  });

  describe('setCalloutBackground', () => {
    it('sets --blok-search-input-bg on popover element when color is provided', () => {
      const popoverEl = document.createElement('div');

      mockPopoverInstance.getElement.mockReturnValue(popoverEl);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools: createToolsCollection([]),
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.setCalloutBackground('var(--blok-color-brown-bg)');

      expect(popoverEl.style.getPropertyValue('--blok-search-input-bg')).toBe('light-dark(color-mix(in srgb, var(--blok-color-brown-bg) 70%, white), color-mix(in srgb, var(--blok-color-brown-bg) 95%, white))');
    });

    it('removes overrides from popover element when color is null', () => {
      const popoverEl = document.createElement('div');

      popoverEl.style.setProperty('--blok-search-input-bg', 'var(--blok-color-brown-bg)');

      mockPopoverInstance.getElement.mockReturnValue(popoverEl);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools: createToolsCollection([]),
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.setCalloutBackground(null);

      expect(popoverEl.style.getPropertyValue('--blok-search-input-bg')).toBe('');
    });
  });

});
