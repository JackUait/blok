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
  setActiveDescendantHost: vi.fn(),
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
      public setActiveDescendantHost = mockPopoverInstance.setActiveDescendantHost;
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
      public setActiveDescendantHost = mockPopoverInstance.setActiveDescendantHost;
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

const mockSelectionRect = vi.hoisted(() => ({
  value: new DOMRect(50, 300, 100, 20),
}));

vi.mock('../../../src/components/selection', () => ({
  SelectionUtils: {
    get rect() {
      return mockSelectionRect.value;
    },
  },
}));

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
            startBlockMutationWatching: vi.fn(),
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
      name: 'testTool',
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
        getById: vi.fn(() => null),
        convert: vi.fn(),
        composeBlockData: vi.fn(async () => ({})),
        insert: vi.fn(() => blockAPI),
        update: vi.fn(async () => blockAPI),
        setBlockParent: vi.fn(),
        transact: vi.fn((fn: () => void) => fn()),
        stopBlockMutationWatching: vi.fn(),
        startBlockMutationWatching: vi.fn(),
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

    it('should pass minWidth of 220px to the popover', () => {
      new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      expect(lastPopoverParams.value).toHaveProperty('minWidth', '220px');
    });

    it('should not pass scopeElement to the popover so it defaults to document.body', () => {
      new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      expect(lastPopoverParams.value).not.toHaveProperty('scopeElement');
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

    it('positions popover at caret rect when trigger element is off-screen above viewport', () => {
      const triggerElement = document.createElement('div');
      const holder = document.createElement('div');

      // Simulate a trigger element whose bottom is above the visible viewport (negative bottom)
      vi.spyOn(triggerElement, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(50, -2140, 24, 24)
      );

      const caretRect = new DOMRect(60, 320, 100, 20);

      mockSelectionRect.value = caretRect;
      vi.mocked(mocks.api.blocks.getBlockByIndex).mockReturnValue({
        ...mocks.blockAPI,
        holder,
      } as unknown as typeof mocks.blockAPI);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
        triggerElement,
      });

      toolbox.open();

      expect(mockPopoverInstance.updatePosition).toHaveBeenCalledWith(caretRect, {
        positionContext: holder,
      });
    });

    it('positions popover at caret rect when current block is inside a nested block (has parentId)', () => {
      /**
       * When a block is inside a toggle or callout (parentId is set), the toolbar's
       * trigger element (plus button) is positioned outside the nested container.
       * The toolbox must use the caret position instead of the trigger element position.
       */
      const triggerElement = document.createElement('div');

      // Trigger element (plus button) is visible and on-screen — but outside the nested container
      vi.spyOn(triggerElement, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(50, 100, 24, 24)
      );

      const caretRect = new DOMRect(260, 350, 100, 20);
      const holder = document.createElement('div');

      mockSelectionRect.value = caretRect;

      // Simulate a block that has a parentId — i.e., it is nested inside a toggle/callout
      const nestedBlock = {
        ...mocks.blockAPI,
        parentId: 'parent-toggle-id',
        holder,
      };

      vi.mocked(mocks.api.blocks.getBlockByIndex).mockReturnValue(nestedBlock as unknown as typeof mocks.blockAPI);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
        triggerElement,
      });

      toolbox.open();

      expect(mockPopoverInstance.updatePosition).toHaveBeenCalledWith(caretRect, {
        positionContext: holder,
      });
    });

    it('anchors slash-search popover at the slash-search pill rect (not caret) so gap matches plus-search', () => {
      /**
       * When a slash-search pill is present, the popover must sit below the
       * pill's actual bottom — the same way the plus-button flow anchors to
       * the block's bottom. Anchoring to the caret instead produces a smaller
       * (or even negative) visual gap vs. plus-search because the caret rect
       * is contained inside the pill's padding.
       */
      const caretRect = new DOMRect(60, 320, 0, 18);
      const pillRect = new DOMRect(50, 315, 130, 28);

      mockSelectionRect.value = caretRect;

      const pillElement = document.createElement('div');

      pillElement.setAttribute('data-blok-slash-search', 'Type to search');
      vi.spyOn(pillElement, 'getBoundingClientRect').mockReturnValue(pillRect);

      const holder = document.createElement('div');

      holder.appendChild(pillElement);

      vi.mocked(mocks.api.blocks.getBlockByIndex).mockReturnValue({
        ...mocks.blockAPI,
        holder,
      } as unknown as typeof mocks.blockAPI);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.open();

      const call = mockPopoverInstance.updatePosition.mock.calls[0]?.[0] as DOMRect | undefined;

      expect(call).toBeDefined();
      expect(call?.left).toBe(pillRect.left);
      expect(call?.top).toBe(pillRect.top);
      expect(call?.width).toBe(pillRect.width);
      // Anchor bottom shrinks by PILL_BOTTOM_INSET so the popover's own 8px offset
      // yields a slightly smaller visual gap below the pill.
      expect(call?.bottom).toBe(pillRect.bottom - 2);
    });

    it('plus-search (withSlash=false) anchors at the same pill rect as slash-search so the gap is identical', () => {
      /**
       * Parity regression: plus-button and slash both apply the search pill
       * attribute via startListeningToBlockInput. To ensure the popover-to-field
       * gap is the same, both flows must resolve to the same anchor — the pill
       * rect — not drift between "pill rect" (slash) and "block holder rect"
       * (plus).
       */
      const pillRect = new DOMRect(50, 315, 130, 28);
      const pillElement = document.createElement('div');

      pillElement.setAttribute('data-blok-slash-search', 'Type to search');
      vi.spyOn(pillElement, 'getBoundingClientRect').mockReturnValue(pillRect);

      const holder = document.createElement('div');

      holder.appendChild(pillElement);

      vi.mocked(mocks.api.blocks.getBlockByIndex).mockReturnValue({
        ...mocks.blockAPI,
        holder,
      } as unknown as typeof mocks.blockAPI);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.open(false);

      const call = mockPopoverInstance.updatePosition.mock.calls[0]?.[0] as DOMRect | undefined;

      expect(call).toBeDefined();
      expect(call?.left).toBe(pillRect.left);
      expect(call?.top).toBe(pillRect.top);
      expect(call?.width).toBe(pillRect.width);
      expect(call?.bottom).toBe(pillRect.bottom - 2);
    });

    it('applies the slash-search pill attribute BEFORE calling updatePosition so the pill rect is queryable', () => {
      /**
       * updatePosition relies on querying [data-blok-slash-search] inside the
       * block. If the attribute is applied after updatePosition, the query
       * returns null and the popover falls back to the caret rect — collapsing
       * the gap between pill and popover.
       */
      const contentEditable = document.createElement('div');

      contentEditable.setAttribute('contenteditable', 'true');

      const holder = document.createElement('div');

      holder.appendChild(contentEditable);

      // Spy on setAttribute so we can assert the attribute lands before updatePosition.
      let attributeSetAtCall = -1;

      const originalSetAttribute = contentEditable.setAttribute.bind(contentEditable);

      vi.spyOn(contentEditable, 'setAttribute').mockImplementation((name, value) => {
        if (name === 'data-blok-slash-search') {
          attributeSetAtCall = mockPopoverInstance.updatePosition.mock.calls.length;
        }
        originalSetAttribute(name, value);
      });

      vi.mocked(mocks.api.blocks.getBlockByIndex).mockReturnValue({
        ...mocks.blockAPI,
        holder,
      } as unknown as typeof mocks.blockAPI);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.open();

      // Attribute must be set before updatePosition fires (i.e. updatePosition call count was 0 at that moment).
      expect(attributeSetAtCall).toBe(0);
      expect(contentEditable.getAttribute('data-blok-slash-search')).toBe('Type to search');
    });
  });

  describe('close', () => {
    it('re-arms mutation watching on the block that open() silenced', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.open();
      expect(mocks.api.blocks.stopBlockMutationWatching).toHaveBeenCalledWith(0);

      toolbox.close();

      expect(mocks.api.blocks.startBlockMutationWatching).toHaveBeenCalledWith('test-block-id');
    });

    it('does not re-arm mutation watching when the toolbox was never opened', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.close();

      expect(mocks.api.blocks.startBlockMutationWatching).not.toHaveBeenCalled();
    });

    it('re-arms mutation watching only once per open/close cycle', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.open();
      toolbox.close();
      toolbox.close();

      expect(mocks.api.blocks.startBlockMutationWatching).toHaveBeenCalledTimes(1);
    });

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
      contentEditable.dispatchEvent(new Event('input', { bubbles: true }));  

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
      contentEditable.dispatchEvent(new Event('input', { bubbles: true }));  
      expect(contentEditable.getAttribute('data-blok-slash-search')).toBe('');

      // Clear query back to just "/"
      contentEditable.textContent = '/';
      contentEditable.dispatchEvent(new Event('input', { bubbles: true }));
      expect(contentEditable.getAttribute('data-blok-slash-search')).toBe('Type to search');
    });

    it('bounds the query at the caret, not the end of the block (Notion parity)', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      // The selection only persists in jsdom for an attached subtree, and
      // getCaretOffset reads the live selection to bound the query.
      document.body.appendChild(mocks.blockAPI.holder);

      toolbox.open();

      const contentEditable = mocks.blockAPI.holder.querySelector('[contenteditable="true"]') as HTMLElement;

      /**
       * The block already held "Hello world"; the user placed the caret after
       * "Hello", typed "/h" → "Hello/h world" with the caret right after "h".
       * The trailing " world" (content after the caret) must NOT pollute the
       * search query — it should filter by "h" only, not "h world".
       */
      contentEditable.textContent = 'Hello/h world';

      const textNode = contentEditable.firstChild as Text;
      const range = document.createRange();

      range.setStart(textNode, 7); // just after "Hello/h"
      range.collapse(true);

      const selection = window.getSelection();

      selection?.removeAllRanges();
      selection?.addRange(range);

      contentEditable.dispatchEvent(new Event('input', { bubbles: true }));

      expect(mockPopoverInstance.filterItems).toHaveBeenLastCalledWith('h');

      // Clean up the attached subtree + live selection so later tests that read
      // the global selection (e.g. shortcut-conversion caret offset) are not
      // affected by this one's lingering caret.
      window.getSelection()?.removeAllRanges();
      mocks.blockAPI.holder.remove();
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

    it('converts a non-empty block in place when "/" is typed after its text, stripping only the "/query" (Notion parity)', async () => {
      /**
       * Notion: typing "/" on a NON-empty block opens the menu; selecting a tool
       * TURNS the current block into the chosen type, folding the preceding text
       * into it and removing only the "/query" — it does NOT split into an orphan
       * paragraph + empty sibling.
       */
      const holderElement = document.createElement('div');
      const contentEditableElement = document.createElement('div');

      contentEditableElement.setAttribute('contenteditable', 'true');
      contentEditableElement.textContent = 'Hello/head';
      holderElement.appendChild(contentEditableElement);

      const nonEmptyBlock = {
        ...mocks.blockAPI,
        id: 'source-block-id',
        isEmpty: false,
        holder: holderElement,
      };

      vi.mocked(mocks.api.blocks.getCurrentBlockIndex).mockReturnValue(0);
      vi.mocked(mocks.api.blocks.getBlockByIndex).mockReturnValue(nonEmptyBlock as unknown as BlockAPI);
      vi.mocked(mocks.api.blocks.convert).mockResolvedValue({ id: 'converted-block-id' } as BlockAPI);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      // Open in slash mode (default), then pick a tool
      toolbox.open();
      await toolbox.toolButtonActivated('testTool', {});

      // The current block is converted in place — no sibling is inserted.
      expect(mocks.api.blocks.convert).toHaveBeenCalledWith('source-block-id', 'testTool', {});
      expect(mocks.api.blocks.insert).not.toHaveBeenCalled();

      // Only the "/head" slash query is removed; "Hello" stays in the current block
      expect(contentEditableElement.textContent).toBe('Hello');
    });

    it('replaces in place (no stripping needed) when the block contains only "/query"', async () => {
      const holderElement = document.createElement('div');
      const contentEditableElement = document.createElement('div');

      contentEditableElement.setAttribute('contenteditable', 'true');
      contentEditableElement.textContent = '/head';
      holderElement.appendChild(contentEditableElement);

      const slashOnlyBlock = {
        ...mocks.blockAPI,
        isEmpty: false,
        holder: holderElement,
      };

      vi.mocked(mocks.api.blocks.getCurrentBlockIndex).mockReturnValue(0);
      vi.mocked(mocks.api.blocks.getBlockByIndex).mockReturnValue(slashOnlyBlock as unknown as BlockAPI);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.open();
      await toolbox.toolButtonActivated('testTool', {});

      // Slash-only block is replaced in place (index 0, shouldReplace=true)
      expect(mocks.api.blocks.insert).toHaveBeenCalledWith(
        'testTool',
        undefined,
        undefined,
        0,
        undefined,
        true
      );
    });

    it('converts in place (keeping content) when "/" is typed BEFORE existing content', async () => {
      /**
       * The block already held "Hello"; the user placed the caret at the START
       * and typed "/head" → "/headHello" with the caret right after "/head".
       * The leading "/head" is a slash query but "Hello" is real content, so the
       * block must be CONVERTED in place — folding "Hello" into the new tool —
       * not split into a separate empty block. The "Hello" content must NOT be
       * discarded.
       */
      const holderElement = document.createElement('div');
      const contentEditableElement = document.createElement('div');

      contentEditableElement.setAttribute('contenteditable', 'true');
      contentEditableElement.textContent = '/headHello';
      holderElement.appendChild(contentEditableElement);
      document.body.appendChild(holderElement);

      const nonEmptyBlock = {
        ...mocks.blockAPI,
        id: 'source-block-id',
        isEmpty: false,
        holder: holderElement,
      };

      vi.mocked(mocks.api.blocks.getCurrentBlockIndex).mockReturnValue(0);
      vi.mocked(mocks.api.blocks.getBlockByIndex).mockReturnValue(nonEmptyBlock as unknown as BlockAPI);
      vi.mocked(mocks.api.blocks.convert).mockResolvedValue({ id: 'converted-block-id' } as BlockAPI);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.open();

      // Caret right after "/head" (offset 5) so the query span is bounded there.
      const textNode = contentEditableElement.firstChild as Text;
      const range = document.createRange();

      range.setStart(textNode, 5);
      range.collapse(true);

      const selection = window.getSelection();

      selection?.removeAllRanges();
      selection?.addRange(range);

      contentEditableElement.dispatchEvent(new Event('input', { bubbles: true }));

      await toolbox.toolButtonActivated('testTool', {});

      // The current block is converted in place — no sibling is inserted.
      expect(mocks.api.blocks.convert).toHaveBeenCalledWith('source-block-id', 'testTool', {});
      expect(mocks.api.blocks.insert).not.toHaveBeenCalled();

      // Only the "/head" slash query is removed; "Hello" stays in the current block
      expect(contentEditableElement.textContent).toBe('Hello');

      window.getSelection()?.removeAllRanges();
      holderElement.remove();
    });

    it('strips only the slash-query span and converts in place, preserving content typed after the caret', async () => {
      /**
       * The block held "Hello world"; the user placed the caret after "Hello"
       * and typed "/head" → "Hello/head world" with the caret after "/head".
       * Selecting a tool must CONVERT the block in place and remove ONLY the
       * "/head" span — the trailing " world" content must NOT be discarded.
       */
      const holderElement = document.createElement('div');
      const contentEditableElement = document.createElement('div');

      contentEditableElement.setAttribute('contenteditable', 'true');
      contentEditableElement.textContent = 'Hello/head world';
      holderElement.appendChild(contentEditableElement);
      document.body.appendChild(holderElement);

      const nonEmptyBlock = {
        ...mocks.blockAPI,
        id: 'source-block-id',
        isEmpty: false,
        holder: holderElement,
      };

      vi.mocked(mocks.api.blocks.getCurrentBlockIndex).mockReturnValue(0);
      vi.mocked(mocks.api.blocks.getBlockByIndex).mockReturnValue(nonEmptyBlock as unknown as BlockAPI);
      vi.mocked(mocks.api.blocks.convert).mockResolvedValue({ id: 'converted-block-id' } as BlockAPI);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.open();

      // Caret right after "Hello/head" (offset 10).
      const textNode = contentEditableElement.firstChild as Text;
      const range = document.createRange();

      range.setStart(textNode, 10);
      range.collapse(true);

      const selection = window.getSelection();

      selection?.removeAllRanges();
      selection?.addRange(range);

      contentEditableElement.dispatchEvent(new Event('input', { bubbles: true }));

      await toolbox.toolButtonActivated('testTool', {});

      // The current block is converted in place — no sibling is inserted.
      expect(mocks.api.blocks.convert).toHaveBeenCalledWith('source-block-id', 'testTool', {});
      expect(mocks.api.blocks.insert).not.toHaveBeenCalled();

      // Only "/head" is removed; the leading "Hello" and trailing " world" remain.
      expect(contentEditableElement.textContent).toBe('Hello world');

      window.getSelection()?.removeAllRanges();
      holderElement.remove();
    });

    it('converts the current block IN PLACE (folding leading text) when "/" follows real content (Notion parity M-1)', async () => {
      /**
       * Notion: typing "Hello/bullet" then picking the tool TURNS the current
       * block into the chosen type, keeping "Hello" as its content and deleting
       * only the "/bullet" query. Blok must convert in place — NOT strip the
       * query and insert an empty sibling (which left an orphan paragraph).
       */
      const holderElement = document.createElement('div');
      const contentEditableElement = document.createElement('div');

      contentEditableElement.setAttribute('contenteditable', 'true');
      contentEditableElement.textContent = 'Hello/bullet';
      holderElement.appendChild(contentEditableElement);
      document.body.appendChild(holderElement);

      const convertedBlock = {
        ...mocks.blockAPI,
        id: 'converted-block-id',
        name: 'list',
      } as unknown as BlockAPI;

      const nonEmptyBlock = {
        ...mocks.blockAPI,
        id: 'source-block-id',
        isEmpty: false,
        holder: holderElement,
      };

      vi.mocked(mocks.api.blocks.getCurrentBlockIndex).mockReturnValue(0);
      vi.mocked(mocks.api.blocks.getBlockByIndex).mockReturnValue(nonEmptyBlock as unknown as BlockAPI);
      vi.mocked(mocks.api.blocks.convert).mockResolvedValue(convertedBlock);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      const emitSpy = vi.spyOn(toolbox, 'emit');

      toolbox.open();
      await toolbox.toolButtonActivated('testTool', {});

      // The current block is converted in place — NOT inserted as a sibling.
      expect(mocks.api.blocks.convert).toHaveBeenCalledWith('source-block-id', 'testTool', {});
      expect(mocks.api.blocks.insert).not.toHaveBeenCalled();

      // Only the "/bullet" query is stripped; "Hello" is folded into the block.
      expect(contentEditableElement.textContent).toBe('Hello');

      // The converted block is announced so listeners (toolbar) clear their state.
      expect(emitSpy).toHaveBeenCalledWith(ToolboxEvent.BlockAdded, { block: convertedBlock });

      holderElement.remove();
    });

    it('falls back to inserting a sibling when the in-place conversion is not possible', async () => {
      /**
       * Some target tools cannot accept the current text (no conversionConfig).
       * `convert` throws in that case; the toolbox must fall back to stripping
       * the "/query" and inserting the new block as the next sibling so the tool
       * is still created and no content is lost.
       */
      const holderElement = document.createElement('div');
      const contentEditableElement = document.createElement('div');

      contentEditableElement.setAttribute('contenteditable', 'true');
      contentEditableElement.textContent = 'Hello/embed';
      holderElement.appendChild(contentEditableElement);
      document.body.appendChild(holderElement);

      const nonEmptyBlock = {
        ...mocks.blockAPI,
        id: 'source-block-id',
        isEmpty: false,
        holder: holderElement,
      };

      vi.mocked(mocks.api.blocks.getCurrentBlockIndex).mockReturnValue(0);
      vi.mocked(mocks.api.blocks.getBlockByIndex).mockReturnValue(nonEmptyBlock as unknown as BlockAPI);
      vi.mocked(mocks.api.blocks.convert).mockRejectedValue(new Error('not convertable'));

      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.open();
      await toolbox.toolButtonActivated('testTool', {});

      // Conversion was attempted, then the sibling-insert fallback ran.
      expect(mocks.api.blocks.convert).toHaveBeenCalledWith('source-block-id', 'testTool', {});
      expect(mocks.api.blocks.insert).toHaveBeenCalledWith(
        'testTool',
        undefined,
        undefined,
        1,
        undefined,
        false
      );

      // The "/embed" query is stripped regardless of which path runs.
      expect(contentEditableElement.textContent).toBe('Hello');

      holderElement.remove();
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

  describe('column_list nesting inside a column', () => {
    /**
     * Builds a column block adapter and wires the blocks API so getById walks a
     * paragraph -> column chain, putting the current block inside a column.
     */
    const wireInsideColumn = (): void => {
      vi.mocked(mocks.api.blocks.getById).mockImplementation((id: string) => {
        if (id === mocks.blockAPI.id) {
          return { id, name: 'paragraph', parentId: 'col-1' } as unknown as BlockAPI;
        }
        if (id === 'col-1') {
          return { id, name: 'column', parentId: 'cl-1' } as unknown as BlockAPI;
        }

        return null;
      });
    };

    const columnListTools = (): ToolsCollection<BlockToolAdapter> => {
      const columnListAdapter = {
        name: 'column_list',
        toolbox: [
          { title: 'Columns', icon: '<svg>cols</svg>', name: 'column_list' },
          { title: '2 columns', icon: '<svg>cols</svg>', name: 'column_list-2', data: { columnCount: 2 } },
          { title: '3 columns', icon: '<svg>cols</svg>', name: 'column_list-3', data: { columnCount: 3 } },
        ],
      } as unknown as BlockToolAdapter;

      return createToolsCollection([
        ['testTool', mocks.blockToolAdapter],
        ['column_list', columnListAdapter],
      ]);
    };

    it('does not hide any column_list preset when opened inside a column', () => {
      wireInsideColumn();

      const toolbox = new Toolbox({
        api: mocks.api,
        tools: columnListTools(),
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.open();

      // Columns inside columns are allowed: no preset is hidden.
      expect(mockPopoverInstance.toggleItemHiddenByName).not.toHaveBeenCalledWith('column_list', true);
      expect(mockPopoverInstance.toggleItemHiddenByName).not.toHaveBeenCalledWith('column_list-2', true);
      expect(mockPopoverInstance.toggleItemHiddenByName).not.toHaveBeenCalledWith('column_list-3', true);
    });

    it('inserts a column_list when the current block is inside a column', async () => {
      wireInsideColumn();

      const toolbox = new Toolbox({
        api: mocks.api,
        tools: columnListTools(),
        i18nLabels,
        i18n: mockI18n,
      });

      await toolbox.toolButtonActivated('column_list', {});

      const columnListInsert = vi
        .mocked(mocks.api.blocks.insert)
        .mock.calls.find(call => call[0] === 'column_list');

      expect(columnListInsert).toBeDefined();
    });

    it('still inserts other block types when inside a column', async () => {
      wireInsideColumn();

      const toolbox = new Toolbox({
        api: mocks.api,
        tools: columnListTools(),
        i18nLabels,
        i18n: mockI18n,
      });

      await toolbox.toolButtonActivated('testTool', {});

      expect(mocks.api.blocks.insert).toHaveBeenCalled();
    });
  });

  describe('column_list restriction inside a table cell', () => {
    const columnListAdapter = {
      name: 'column_list',
      toolbox: [
        { title: 'Columns', icon: '<svg>cols</svg>', name: 'column_list' },
        { title: '2 columns', icon: '<svg>cols</svg>', name: 'column_list-2', data: { columnCount: 2 } },
        { title: '3 columns', icon: '<svg>cols</svg>', name: 'column_list-3', data: { columnCount: 3 } },
      ],
    } as unknown as BlockToolAdapter;

    it('hides all column_list presets when opened inside a table cell', () => {
      const tools = createToolsCollection([
        ['testTool', mocks.blockToolAdapter],
        ['column_list', columnListAdapter],
      ]);

      // Wrap the block holder in a table cell container.
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

      expect(mockPopoverInstance.toggleItemHiddenByName).toHaveBeenCalledWith('column_list', true);
      expect(mockPopoverInstance.toggleItemHiddenByName).toHaveBeenCalledWith('column_list-2', true);
      expect(mockPopoverInstance.toggleItemHiddenByName).toHaveBeenCalledWith('column_list-3', true);

      cellBlocksContainer.remove();
    });

    it('does not hide column_list presets when opened outside a table cell', () => {
      const tools = createToolsCollection([
        ['testTool', mocks.blockToolAdapter],
        ['column_list', columnListAdapter],
      ]);

      const toolbox = new Toolbox({
        api: mocks.api,
        tools,
        i18nLabels,
        i18n: mockI18n,
      });

      toolbox.open();

      expect(mockPopoverInstance.toggleItemHiddenByName).not.toHaveBeenCalledWith('column_list', true);
      expect(mockPopoverInstance.toggleItemHiddenByName).not.toHaveBeenCalledWith('column_list-2', true);
      expect(mockPopoverInstance.toggleItemHiddenByName).not.toHaveBeenCalledWith('column_list-3', true);
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
        expect(mocks.api.caret.setToBlock).toHaveBeenCalledWith(convertedBlock, 'default', 0);
      }
    });

    it('preserves the caret offset when converting via shortcut (Notion parity)', async () => {
      new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      const convertedBlock = { id: 'converted-block' } as BlockAPI;

      vi.mocked(mocks.api.blocks.convert).mockResolvedValue(convertedBlock);

      /**
       * Place a collapsed caret in the middle of a contenteditable block input.
       * Turn-into must keep the caret at this offset, not jump it to the end.
       */
      const editable = document.createElement('div');

      editable.setAttribute('contenteditable', 'true');
      editable.textContent = 'Hello world';
      document.body.appendChild(editable);

      const range = document.createRange();

      range.setStart(editable.firstChild as Node, 3);
      range.collapse(true);

      const selection = window.getSelection();

      selection?.removeAllRanges();
      selection?.addRange(range);

      const addCalls = vi.mocked(Shortcuts.add).mock.calls;
      const addCall = addCalls[0]?.[0];

      if (addCall && addCall.handler) {
        const event = { preventDefault: vi.fn() } as unknown as KeyboardEvent;

        await addCall.handler(event);

        expect(mocks.api.caret.setToBlock).toHaveBeenCalledWith(convertedBlock, 'default', 3);
      }

      editable.remove();
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
      contentEditable.dispatchEvent(new Event('input', { bubbles: true }));  

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
      contentEditable.dispatchEvent(new Event('input', { bubbles: true }));  

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
      contentEditable.dispatchEvent(new Event('input', { bubbles: true }));  

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
      contentEditable.dispatchEvent(new Event('input', { bubbles: true }));  

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

  describe('searchTermKeys resolution', () => {
    it('should resolve searchTermKeys via i18n and merge into searchTerms', () => {
      const i18n = {
        t: vi.fn((key: string) => {
          const translations: Record<string, string> = {
            'toolNames.divider': 'Séparateur',
            'searchTerms.divider': 'diviseur',
            'searchTerms.separator': 'séparateur',
            'searchTerms.delimiter': 'délimiteur',
            'searchTerms.splitter': 'sépareur',
          };

          return translations[key] ?? key;
        }),
        has: vi.fn((key: string) => key.startsWith('toolNames.') || key.startsWith('searchTerms.')),
      };

      const dividerTool = {
        name: 'divider',
        toolbox: {
          icon: '<svg>divider</svg>',
          titleKey: 'divider',
          searchTerms: ['hr', 'line'],
          searchTermKeys: ['divider', 'separator', 'delimiter', 'splitter'],
        },
        shortcut: undefined,
        searchTerms: undefined,
      } as unknown as BlockToolAdapter;

      const tools = createToolsCollection([['divider', dividerTool]]);

      const api = {
        ...mocks.api,
        i18n: {
          t: vi.fn(),
          has: vi.fn(),
          getEnglishTranslation: vi.fn((key: string) => {
            const en: Record<string, string> = {
              'toolNames.divider': 'Divider',
              'searchTerms.divider': 'divider',
              'searchTerms.separator': 'separator',
              'searchTerms.delimiter': 'delimiter',
              'searchTerms.splitter': 'splitter',
            };

            return en[key] ?? '';
          }),
          getLocale: vi.fn(() => 'fr'),
        },
      } as unknown as API;

      new Toolbox({
        api,
        tools,
        i18nLabels,
        i18n,
      });

      const items = lastPopoverItems.value as Array<{ searchTerms?: string[] }>;

      expect(items).toHaveLength(1);
      // Should contain original searchTerms + resolved translations
      expect(items[0].searchTerms).toContain('hr');
      expect(items[0].searchTerms).toContain('line');
      expect(items[0].searchTerms).toContain('diviseur');
      expect(items[0].searchTerms).toContain('séparateur');
      expect(items[0].searchTerms).toContain('délimiteur');
      expect(items[0].searchTerms).toContain('sépareur');
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

      expect(popoverEl.style.getPropertyValue('--blok-search-input-bg')).toBe('light-dark(color-mix(in srgb, var(--blok-color-brown-bg) 70%, white), color-mix(in srgb, var(--blok-color-brown-bg) 85%, white))');
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

  describe('block-color slash commands', () => {
    /**
     * A color-capable tool declares the color data fields in its sanitize config
     * (real paragraph/header spread BLOCK_COLOR_SANITIZE in). Only then does the
     * toolbox surface the flat block-color commands.
     */
    const createColorCapableTool = (textContent: string): {
      tools: ToolsCollection<BlockToolAdapter>;
      block: BlockAPI;
      contentEditable: HTMLDivElement;
    } => {
      const holderElement = document.createElement('div');
      const contentEditableElement = document.createElement('div');

      contentEditableElement.setAttribute('contenteditable', 'true');
      contentEditableElement.textContent = textContent;
      holderElement.appendChild(contentEditableElement);
      document.body.appendChild(holderElement);

      const colorTool = {
        name: 'paragraph',
        toolbox: { title: 'Text', icon: '<svg></svg>' },
        sanitizeConfig: { textColor: false, backgroundColor: false, text: {} },
      } as unknown as BlockToolAdapter;

      const block = {
        ...mocks.blockAPI,
        id: 'colored-block',
        name: 'paragraph',
        isEmpty: false,
        holder: holderElement,
      } as unknown as BlockAPI;

      return {
        tools: createToolsCollection([['paragraph', colorTool]]),
        block,
        contentEditable: contentEditableElement,
      };
    };

    it('surfaces flat block-color commands when a color-capable tool is registered', () => {
      const { tools } = createColorCapableTool('');

      new Toolbox({ api: mocks.api, tools, i18nLabels, i18n: mockI18n });

      const items = lastPopoverItems.value as Array<{ name?: string; title?: string }>;
      const colorItems = items.filter((item) => item.name?.startsWith('block-color-'));

      // 9 presets × 2 axes + 2 default resets
      expect(colorItems).toHaveLength(20);
      expect(colorItems.some((item) => item.name === 'block-color-bg-red')).toBe(true);
    });

    it('does NOT surface color commands when no registered tool supports block color', () => {
      const tools = createToolsCollection([['testTool', mocks.blockToolAdapter]]);

      new Toolbox({ api: mocks.api, tools, i18nLabels, i18n: mockI18n });

      const items = lastPopoverItems.value as Array<{ name?: string }>;

      expect(items.some((item) => item.name?.startsWith('block-color-'))).toBe(false);
    });

    it('recolors the CURRENT block (does not insert) and strips the "/query"', async () => {
      const { tools, block, contentEditable } = createColorCapableTool('Hello/red');

      vi.mocked(mocks.api.blocks.getCurrentBlockIndex).mockReturnValue(0);
      vi.mocked(mocks.api.blocks.getBlockByIndex).mockReturnValue(block);

      const toolbox = new Toolbox({ api: mocks.api, tools, i18nLabels, i18n: mockI18n });

      toolbox.open();

      // Caret right after "Hello/red" so the slash span is bounded there.
      const textNode = contentEditable.firstChild as Text;
      const range = document.createRange();

      range.setStart(textNode, 'Hello/red'.length);
      range.collapse(true);

      const selection = window.getSelection();

      selection?.removeAllRanges();
      selection?.addRange(range);

      contentEditable.dispatchEvent(new Event('input', { bubbles: true }));

      const items = lastPopoverItems.value as Array<{ name?: string; onActivate?: () => void }>;
      const redBackground = items.find((item) => item.name === 'block-color-bg-red');

      expect(redBackground).toBeDefined();

      redBackground?.onActivate?.();
      await Promise.resolve();
      await Promise.resolve();

      // Recolors the current block in place; never inserts a new one.
      expect(mocks.api.blocks.update).toHaveBeenCalledWith('colored-block', { backgroundColor: 'red' });
      expect(mocks.api.blocks.insert).not.toHaveBeenCalled();

      // The literal "/red" slash query is removed; "Hello" stays.
      expect(contentEditable.textContent).toBe('Hello');

      window.getSelection()?.removeAllRanges();
      block.holder.remove();
    });

    it('Default reset command clears the field (value undefined)', async () => {
      const { tools, block } = createColorCapableTool('');

      vi.mocked(mocks.api.blocks.getCurrentBlockIndex).mockReturnValue(0);
      vi.mocked(mocks.api.blocks.getBlockByIndex).mockReturnValue(block);

      const toolbox = new Toolbox({ api: mocks.api, tools, i18nLabels, i18n: mockI18n });

      toolbox.open();

      const items = lastPopoverItems.value as Array<{ name?: string; onActivate?: () => void }>;
      const defaultBackground = items.find((item) => item.name === 'block-color-bg-default');

      defaultBackground?.onActivate?.();
      await Promise.resolve();
      await Promise.resolve();

      expect(mocks.api.blocks.update).toHaveBeenCalledWith('colored-block', { backgroundColor: undefined });

      block.holder.remove();
    });

    it('hides color commands on open when the current block does NOT support block color', () => {
      // Color-capable paragraph IS registered (so commands exist), but the
      // current block is a non-color tool → the commands must be hidden.
      const { tools } = createColorCapableTool('');
      const plainBlock = {
        ...mocks.blockAPI,
        name: 'testTool',
        isEmpty: false,
      } as unknown as BlockAPI;

      vi.mocked(mocks.api.blocks.getBlockByIndex).mockReturnValue(plainBlock);

      const toolbox = new Toolbox({ api: mocks.api, tools, i18nLabels, i18n: mockI18n });

      toolbox.open();

      expect(mockPopoverInstance.toggleItemHiddenByName).toHaveBeenCalledWith('block-color-bg-red', true);
    });
  });

  describe('accessibility (combobox + listbox)', () => {
    it('constructs the popover as a listbox with the provided listboxId', () => {
       
      new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
        listboxId: 'blok-toolbox-popover',
      });

      expect(lastPopoverParams.value.listbox).toBe(true);
      expect(lastPopoverParams.value.listboxId).toBe('blok-toolbox-popover');
    });

    it('passes a searchResults announcement template (from i18n) to the popover', () => {
       
      new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
      });

      const messages = lastPopoverParams.value.messages as { searchResults?: string } | undefined;

      // mockI18n.t echoes the key back
      expect(messages?.searchResults).toBe('a11y.searchResults');
    });

    it('marks the block contentEditable as a combobox and wires activeDescendant on open', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
        listboxId: 'blok-toolbox-popover',
      });

      toolbox.open();

      const ce = mocks.blockAPI.holder.querySelector<HTMLElement>('[contenteditable="true"]');

      expect(ce?.getAttribute('role')).toBe('combobox');
      expect(ce?.getAttribute('aria-expanded')).toBe('true');
      expect(ce?.getAttribute('aria-autocomplete')).toBe('list');
      expect(ce?.getAttribute('aria-haspopup')).toBe('listbox');
      expect(ce?.getAttribute('aria-controls')).toBe('blok-toolbox-popover');
      expect(mockPopoverInstance.setActiveDescendantHost).toHaveBeenCalledWith(ce);
    });

    it('clears combobox roles and activeDescendant host on close', () => {
      const toolbox = new Toolbox({
        api: mocks.api,
        tools: mocks.tools,
        i18nLabels,
        i18n: mockI18n,
        listboxId: 'blok-toolbox-popover',
      });

      toolbox.open();

      const ce = mocks.blockAPI.holder.querySelector<HTMLElement>('[contenteditable="true"]');

      // Simulate a stale aria-activedescendant left by the flipper's virtual focus
      ce?.setAttribute('aria-activedescendant', 'blok-flipper-item-stale');

      toolbox.close();

      expect(ce?.hasAttribute('role')).toBe(false);
      expect(ce?.hasAttribute('aria-expanded')).toBe(false);
      expect(ce?.hasAttribute('aria-activedescendant')).toBe(false);
      expect(mockPopoverInstance.setActiveDescendantHost).toHaveBeenLastCalledWith(null);
    });
  });

});
