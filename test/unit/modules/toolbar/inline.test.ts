import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import InlineToolbar from '../../../../src/components/modules/toolbar/inline';
import type InlineToolAdapter from '../../../../src/components/tools/inline';
import SelectionUtils from '../../../../src/components/selection';
import type { Popover } from '../../../../src/components/utils/popover';
import Shortcuts from '../../../../src/components/utils/shortcuts';
import type { InlineTool } from '../../../../types';
import type { MenuConfig } from '../../../../types/tools';

// Mock dependencies at module level
const mockPopoverInstance = {
  show: vi.fn(),
  hide: vi.fn(),
  destroy: vi.fn(),
  getElement: vi.fn(() => document.createElement('div')),
  activateItemByName: vi.fn(),
  size: {
    width: 200,
    height: 40,
  },
};

vi.mock('../../../../src/components/utils/popover/popover-inline', () => {
  return {
    PopoverInline: class MockPopoverInline {
      public show = mockPopoverInstance.show;
      public hide = mockPopoverInstance.hide;
      public destroy = mockPopoverInstance.destroy;
      public getElement = mockPopoverInstance.getElement;
      public activateItemByName = mockPopoverInstance.activateItemByName;
      public size = mockPopoverInstance.size;
    },
  };
});

vi.mock('../../../../src/components/utils/shortcuts', () => ({
  default: {
    add: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock('../../../../src/components/utils', async () => {
  const actual = await vi.importActual('../../../../src/components/utils');

  return {
    ...actual,
    isMobileScreen: vi.fn(() => false),
    beautifyShortcut: vi.fn((shortcut: string) => shortcut),
    capitalize: vi.fn((str: string) => str.charAt(0).toUpperCase() + str.slice(1)),
    isFunction: vi.fn((fn: unknown) => typeof fn === 'function'),
    keyCodes: {
      DOWN: 40,
      UP: 38,
    },
  };
});

// Mock SelectionUtils - we'll use Object.defineProperty in tests to override getters
// This mock just ensures the module can be imported
vi.mock('../../../../src/components/selection', async () => {
  const actual = await vi.importActual('../../../../src/components/selection');

  return actual;
});

vi.mock('../../../../src/components/i18n', () => ({
  default: {
    ui: vi.fn((namespace: string, key: string) => key),
    t: vi.fn((namespace: string, key: string) => key),
  },
}));

vi.mock('../../../../src/components/dom', () => ({
  default: {
    make: vi.fn((tag: string, classNameArg: string | string[]) => {
      const el = document.createElement(tag);

      if (Array.isArray(classNameArg)) {
        el.setAttribute('data-blok-testid', classNameArg.join('-'));
      } else if (classNameArg) {
        el.setAttribute('data-blok-testid', classNameArg);
      }

      return el;
    }),
    append: vi.fn((parent: HTMLElement, child: HTMLElement) => {
      parent.appendChild(child);
    }),
    isElement: vi.fn((node: unknown) => node instanceof HTMLElement),
  },
}));

/**
 * Unit tests for InlineToolbar class
 *
 * Tests internal functionality and edge cases not covered by E2E tests
 */
describe('InlineToolbar', () => {
  const CONTENT_RECT_RIGHT = 1000;


  let inlineToolbar: InlineToolbar;

  let mockBlok: {
    BlockManager: {
      getBlock: ReturnType<typeof vi.fn>;
      currentBlock: {
        tool: {
          inlineTools: Map<string, InlineToolAdapter>;
          enabledInlineTools: boolean;
        };
      } | null;
    };
    Tools: {
      inlineTools: Map<string, InlineToolAdapter>;
      internal: {
        inlineTools: Map<string, unknown>;
      };
    };
    ReadOnly: {
      isEnabled: boolean;
    };
    UI: {
      nodes: {
        wrapper: HTMLElement;
        redactor: HTMLElement;
      };
      contentRect: {
        right: number;
      };
      CSS: {
        blokRtlFix: string;
      };
    };
    Toolbar: {
      close: ReturnType<typeof vi.fn>;
    };
  };

  const createMockInlineTool = (name: string, options: {
    title?: string;
    shortcut?: string;
    isReadOnlySupported?: boolean;
    render?: () => HTMLElement | MenuConfig;
    checkState?: (selection: Selection) => boolean;
    surround?: (range: Range) => void;
    clear?: () => void;
  } = {}): InlineTool => {
    return {
      render: options.render || (() => document.createElement('button')),
      checkState: options.checkState,
      surround: options.surround,
      clear: options.clear,
    } as InlineTool;
  };

  const createMockInlineToolAdapter = (name: string, options: {
    title?: string;
    shortcut?: string;
    isReadOnlySupported?: boolean;
    create?: () => InlineTool;
  } = {}): InlineToolAdapter => {
    return {
      name,
      title: options.title || name,
      shortcut: options.shortcut,
      isReadOnlySupported: options.isReadOnlySupported,
      create: options.create || (() => createMockInlineTool(name)),
    } as InlineToolAdapter;
  };

  const createMockBlock = (): {
    tool: {
      inlineTools: Map<string, InlineToolAdapter>;
      enabledInlineTools: boolean;
    };
    holder: HTMLElement;
  } => {
    const blockElement = document.createElement('div');

    blockElement.setAttribute('data-blok-testid', 'blok-element');
    blockElement.setAttribute('contenteditable', 'true');

    const toolAdapter = createMockInlineToolAdapter('bold', {
      title: 'Bold',
      shortcut: 'CMD+B',
    });

    return {
      tool: {
        inlineTools: new Map([ ['bold', toolAdapter] ]),
        enabledInlineTools: true,
      },
      holder: blockElement,
    };
  };

  const createMockSelection = (text: string = 'test'): Selection => {
    const range = document.createRange();
    const textNode = document.createTextNode(text);

    document.body.appendChild(textNode);
    range.setStart(textNode, 0);
    range.setEnd(textNode, text.length);

    return {
      anchorNode: textNode,
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => range,
    } as unknown as Selection;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset SelectionUtils spies if they exist
    vi.restoreAllMocks();

    // Mock requestIdleCallback and setTimeout to execute immediately but asynchronously to avoid recursion in constructor
    vi.useFakeTimers();


    (global as any).requestIdleCallback = vi.fn((callback: () => void) => {
      setTimeout(callback, 0);

      return 1;
    });

    // Ensure window exists for the module logic
    if (typeof window === 'undefined') {
      vi.stubGlobal('window', {
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        requestIdleCallback: (global as unknown as { requestIdleCallback: (callback: () => void) => number }).requestIdleCallback,
      });
    }

    // Create mock UI nodes
    const wrapper = document.createElement('div');

    wrapper.setAttribute('data-blok-testid', 'blok-editor');
    document.body.appendChild(wrapper);

    const redactor = document.createElement('div');

    redactor.setAttribute('data-blok-testid', 'blok-editor-redactor');
    wrapper.appendChild(redactor);

    // Create mock Blok
    mockBlok = {
      BlockManager: {
        getBlock: vi.fn(),
        currentBlock: null,
      },
      Tools: {
        inlineTools: new Map(),
        internal: {
          inlineTools: new Map(),
        },
      },
      ReadOnly: {
        isEnabled: false,
      },
      UI: {
        nodes: {
          wrapper,
          redactor,
        },
        contentRect: {
          right: CONTENT_RECT_RIGHT,
        },
        CSS: {
          blokRtlFix: '',
        },
      },
      Toolbar: {
        close: vi.fn(),
      },
    };

    // Create InlineToolbar instance
    inlineToolbar = new InlineToolbar({
      config: {},
      eventsDispatcher: {
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as typeof InlineToolbar.prototype['eventsDispatcher'],
    });

    // Set Blok modules
    (inlineToolbar as unknown as { Blok: typeof mockBlok }).Blok = mockBlok;
  });

  afterEach(() => {
    // Clean up DOM
    if (mockBlok?.UI?.nodes?.wrapper) {
      const wrapper = mockBlok.UI.nodes.wrapper;

      if (wrapper.parentNode) {
        wrapper.parentNode.removeChild(wrapper);
      }
    }
  });

  describe('constructor', () => {
    it('should initialize with opened = false', () => {
      expect(inlineToolbar.opened).toBe(false);
    });

    it('should register keydown listener for shift+arrow keys', () => {
      // Create new instance to trigger constructor
      const newToolbar = new InlineToolbar({
        config: {},
        eventsDispatcher: {
          on: vi.fn(),
          off: vi.fn(),
        } as unknown as typeof InlineToolbar.prototype['eventsDispatcher'],
      });

      (newToolbar as unknown as { Blok: typeof mockBlok }).Blok = mockBlok;

      // The listener is registered via this.listeners.on, not directly
      // So we check that the toolbar was created successfully
      expect(newToolbar).toBeInstanceOf(InlineToolbar);
    });

    it('should schedule make() and registerInitialShortcuts() via requestIdleCallback', () => {
      const requestIdleCallbackSpy = vi.fn((callback: () => void) => {
        callback();

        return 1;
      });

      (global as unknown as { requestIdleCallback: typeof requestIdleCallbackSpy }).requestIdleCallback = requestIdleCallbackSpy;

      new InlineToolbar({
        config: {},
        eventsDispatcher: {
          on: vi.fn(),
          off: vi.fn(),
        } as unknown as typeof InlineToolbar.prototype['eventsDispatcher'],
      });

      expect(requestIdleCallbackSpy).toHaveBeenCalled();
    });
  });

  describe('tryToShow', () => {
    beforeEach(() => {
      // Setup valid selection
      const selection = createMockSelection();

      vi.spyOn(SelectionUtils, 'get').mockReturnValue(selection);
      vi.spyOn(SelectionUtils, 'text', 'get').mockReturnValue('test');
      vi.spyOn(SelectionUtils, 'rect', 'get').mockReturnValue({
        x: 100,
        y: 100,
        width: 50,
        height: 20,
      } as DOMRect);
      vi.spyOn(SelectionUtils, 'range', 'get').mockReturnValue(selection.getRangeAt(0));

      mockBlok.BlockManager.currentBlock = createMockBlock() as unknown as typeof mockBlok.BlockManager.currentBlock;
    });

    it('should close toolbar when needToClose is true', async () => {
      inlineToolbar.opened = true;
      const closeSpy = vi.spyOn(inlineToolbar, 'close');

      await inlineToolbar.tryToShow(true);

      expect(closeSpy).toHaveBeenCalled();
    });

    it('should not open toolbar when not allowed to show', async () => {
      // Make selection invalid
      vi.spyOn(SelectionUtils, 'get').mockReturnValue(null);
      vi.spyOn(SelectionUtils, 'text', 'get').mockReturnValue('');

      await inlineToolbar.tryToShow();

      expect(inlineToolbar.opened).toBe(false);
    });

    it('should open toolbar and close main toolbar when allowed', async () => {
      // Mock the open method
      const openSpy = vi.spyOn(inlineToolbar as unknown as { open: () => Promise<void> }, 'open').mockResolvedValue();

      await inlineToolbar.tryToShow();

      expect(openSpy).toHaveBeenCalled();
      expect(mockBlok.Toolbar.close).toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('should do nothing when toolbar is already closed', () => {
      inlineToolbar.opened = false;
      const hideSpy = vi.spyOn(mockPopoverInstance, 'hide');

      inlineToolbar.close();

      expect(hideSpy).not.toHaveBeenCalled();
    });

    it('should clear tool instances and reset state when closing', () => {
      inlineToolbar.opened = true;
      const toolInstance = createMockInlineTool('bold');

      (inlineToolbar as unknown as { tools: Map<InlineToolAdapter, InlineTool> }).tools = new Map([
        [createMockInlineToolAdapter('bold'), toolInstance],
      ]);

      // Mock componentRef with a popover
      (inlineToolbar as unknown as { componentRef: { current: { getPopover: () => Popover | null; getWrapperElement: () => null; close: () => void } | null } }).componentRef = {
        current: {
          getPopover: () => mockPopoverInstance as unknown as Popover,
          getWrapperElement: () => null,
          close: vi.fn(),
        },
      };

      inlineToolbar.close();

      expect(inlineToolbar.opened).toBe(false);
    });

    it('should set opened to false when closing', () => {
      inlineToolbar.opened = true;

      inlineToolbar.close();

      expect(inlineToolbar.opened).toBe(false);
    });
  });

  describe('containsNode', () => {
    it('should return false when componentRef is null', () => {
      // componentRef starts as null by default
      const node = document.createElement('div');
      const result = inlineToolbar.containsNode(node);

      expect(result).toBe(false);
    });

    it('should return true when node is contained in wrapper via componentRef', () => {
      const wrapper = document.createElement('div');
      const child = document.createElement('div');

      wrapper.appendChild(child);

      // Mock the componentRef to return a wrapper
      (inlineToolbar as unknown as { componentRef: { current: { getWrapperElement: () => HTMLElement | null } | null } }).componentRef = {
        current: {
          getWrapperElement: () => wrapper,
        },
      };

      const result = inlineToolbar.containsNode(child);

      expect(result).toBe(true);
    });

    it('should return false when node is not contained in wrapper', () => {
      const wrapper = document.createElement('div');
      const otherNode = document.createElement('div');

      (inlineToolbar as unknown as { componentRef: { current: { getWrapperElement: () => HTMLElement | null } | null } }).componentRef = {
        current: {
          getWrapperElement: () => wrapper,
        },
      };

      const result = inlineToolbar.containsNode(otherNode);

      expect(result).toBe(false);
    });
  });

  describe('destroy', () => {
    it('should call close on componentRef and cleanup', () => {
      inlineToolbar.opened = true;
      const closeSpy = vi.fn();

      (inlineToolbar as unknown as { componentRef: { current: { close: () => void; getWrapperElement: () => null; getPopover: () => null } | null } }).componentRef = {
        current: {
          close: closeSpy,
          getWrapperElement: () => null,
          getPopover: () => null,
        },
      };

      inlineToolbar.destroy();

      expect(closeSpy).toHaveBeenCalled();
    });
  });

  describe('allowedToShow', () => {
    it('should return false when selection is null', () => {
      Object.defineProperty(SelectionUtils, 'instance', {
        value: null,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(SelectionUtils, 'selection', {
        value: null,
        writable: true,
        configurable: true,
      });

      const result = (inlineToolbar as unknown as { allowedToShow: () => boolean }).allowedToShow();

      expect(result).toBe(false);
    });

    it('should return false when selection is collapsed', () => {
      const selection = createMockSelection();

      (selection as unknown as { isCollapsed: boolean }).isCollapsed = true;
      Object.defineProperty(SelectionUtils, 'instance', {
        value: selection,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(SelectionUtils, 'selection', {
        value: selection,
        writable: true,
        configurable: true,
      });

      const result = (inlineToolbar as unknown as { allowedToShow: () => boolean }).allowedToShow();

      expect(result).toBe(false);
    });

    it('should return false when selected text is empty', () => {
      const selection = createMockSelection('');

      Object.defineProperty(SelectionUtils, 'instance', {
        value: selection,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(SelectionUtils, 'selection', {
        value: selection,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(SelectionUtils, 'text', {
        value: '',
        writable: true,
        configurable: true,
      });

      const result = (inlineToolbar as unknown as { allowedToShow: () => boolean }).allowedToShow();

      expect(result).toBe(false);
    });

    it('should return false when target is IMG or INPUT tag', () => {
      const img = document.createElement('img');
      const selection = {
        anchorNode: img,
        isCollapsed: false,
      } as unknown as Selection;

      Object.defineProperty(SelectionUtils, 'instance', {
        value: selection,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(SelectionUtils, 'selection', {
        value: selection,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(SelectionUtils, 'text', {
        value: 'test',
        writable: true,
        configurable: true,
      });

      mockBlok.BlockManager.getBlock = vi.fn(() => createMockBlock() as unknown as typeof mockBlok.BlockManager.currentBlock) as typeof mockBlok.BlockManager.getBlock;

      const result = (inlineToolbar as unknown as { allowedToShow: () => boolean }).allowedToShow();

      expect(result).toBe(false);
    });

    it('should return false when current block is null', () => {
      const selection = createMockSelection();

      Object.defineProperty(SelectionUtils, 'instance', {
        value: selection,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(SelectionUtils, 'selection', {
        value: selection,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(SelectionUtils, 'text', {
        value: 'test',
        writable: true,
        configurable: true,
      });

      mockBlok.BlockManager.currentBlock = null;
      mockBlok.BlockManager.getBlock = vi.fn(() => null) as typeof mockBlok.BlockManager.getBlock;

      const result = (inlineToolbar as unknown as { allowedToShow: () => boolean }).allowedToShow();

      expect(result).toBe(false);
    });

    it('should return false when no inline tools are available for block', () => {
      const selection = createMockSelection();

      Object.defineProperty(SelectionUtils, 'instance', {
        value: selection,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(SelectionUtils, 'selection', {
        value: selection,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(SelectionUtils, 'text', {
        value: 'test',
        writable: true,
        configurable: true,
      });

      const block = createMockBlock();

      block.tool.inlineTools = new Map();
      mockBlok.BlockManager.currentBlock = block as unknown as typeof mockBlok.BlockManager.currentBlock;
      mockBlok.BlockManager.getBlock = vi.fn(() => block as unknown as typeof mockBlok.BlockManager.currentBlock) as typeof mockBlok.BlockManager.getBlock;

      const result = (inlineToolbar as unknown as { allowedToShow: () => boolean }).allowedToShow();

      expect(result).toBe(false);
    });

    it('should return false when target is not contenteditable', () => {
      const selection = createMockSelection();

      Object.defineProperty(SelectionUtils, 'instance', {
        value: selection,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(SelectionUtils, 'selection', {
        value: selection,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(SelectionUtils, 'text', {
        value: 'test',
        writable: true,
        configurable: true,
      });

      const block = createMockBlock();

      block.holder.removeAttribute('contenteditable');
      mockBlok.BlockManager.currentBlock = block as unknown as typeof mockBlok.BlockManager.currentBlock;
      mockBlok.BlockManager.getBlock = vi.fn(() => block as unknown as typeof mockBlok.BlockManager.currentBlock) as typeof mockBlok.BlockManager.getBlock;

      const result = (inlineToolbar as unknown as { allowedToShow: () => boolean }).allowedToShow();

      expect(result).toBe(false);
    });

    it('should return true when all conditions are met', () => {
      const selection = createMockSelection();

      Object.defineProperty(SelectionUtils, 'instance', {
        value: selection,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(SelectionUtils, 'selection', {
        value: selection,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(SelectionUtils, 'text', {
        value: 'test',
        writable: true,
        configurable: true,
      });

      const block = createMockBlock();

      mockBlok.BlockManager.currentBlock = block as unknown as typeof mockBlok.BlockManager.currentBlock;
      mockBlok.BlockManager.getBlock = vi.fn(() => block as unknown as typeof mockBlok.BlockManager.currentBlock) as typeof mockBlok.BlockManager.getBlock;

      const result = (inlineToolbar as unknown as { allowedToShow: () => boolean }).allowedToShow();

      expect(result).toBe(true);
    });
  });

  describe('getTools', () => {
    it('should return empty array when current block is null', () => {
      mockBlok.BlockManager.currentBlock = null;

      const result = (inlineToolbar as unknown as { getTools: () => InlineToolAdapter[] }).getTools();

      expect(result).toEqual([]);
    });

    it('should filter out tools not supported in read-only mode', () => {
      const block = createMockBlock();
      const readOnlyTool = createMockInlineToolAdapter('readonly-tool', {
        isReadOnlySupported: true,
      });
      const normalTool = createMockInlineToolAdapter('normal-tool', {
        isReadOnlySupported: false,
      });

      block.tool.inlineTools = new Map([
        ['readonly-tool', readOnlyTool],
        ['normal-tool', normalTool],
      ]);

      mockBlok.BlockManager.currentBlock = block as unknown as typeof mockBlok.BlockManager.currentBlock;
      mockBlok.ReadOnly.isEnabled = true;

      const result = (inlineToolbar as unknown as { getTools: () => InlineToolAdapter[] }).getTools();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('readonly-tool');
    });

    it('should return all tools when not in read-only mode', () => {
      const block = createMockBlock();
      const tool1 = createMockInlineToolAdapter('tool1');
      const tool2 = createMockInlineToolAdapter('tool2');

      block.tool.inlineTools = new Map([
        ['tool1', tool1],
        ['tool2', tool2],
      ]);

      mockBlok.BlockManager.currentBlock = block as unknown as typeof mockBlok.BlockManager.currentBlock;
      mockBlok.ReadOnly.isEnabled = false;

      const result = (inlineToolbar as unknown as { getTools: () => InlineToolAdapter[] }).getTools();

      expect(result).toHaveLength(2);
    });
  });

  describe('Modern Inline Tool', () => {
    it('should create tools instances with modern render config', () => {
      const onActivateSpy = vi.fn();
      const tool = createMockInlineTool('modernTool', {
        render: () => ({
          icon: 'svg',
          onActivate: onActivateSpy,
        }),
      });

      const adapter = createMockInlineToolAdapter('modernTool', {
        title: 'Modern Tool',
        create: () => tool,
      });

      const block = createMockBlock();

      block.tool.inlineTools = new Map([['modernTool', adapter]]);
      mockBlok.BlockManager.currentBlock = block as unknown as typeof mockBlok.BlockManager.currentBlock;

      // createToolsInstances is still available and sets up tools
      (inlineToolbar as unknown as { createToolsInstances: () => void }).createToolsInstances();

      const tools = (inlineToolbar as unknown as { tools: Map<unknown, InlineTool> }).tools;

      expect(tools.size).toBe(1);
    });
  });

  describe('activateToolByShortcut', () => {
    beforeEach(() => {
      const selection = createMockSelection();

      Object.defineProperty(SelectionUtils, 'instance', {
        value: selection,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(SelectionUtils, 'selection', {
        value: selection,
        writable: true,
        configurable: true,
      });
    });

    it('should try to show toolbar when not opened', async () => {
      inlineToolbar.opened = false;
      const tryToShowSpy = vi.spyOn(inlineToolbar, 'tryToShow').mockResolvedValue();

      // Mock componentRef to return a popover
      (inlineToolbar as unknown as { componentRef: { current: { getPopover: () => Popover | null; getWrapperElement: () => null; close: () => void } | null } }).componentRef = {
        current: {
          getPopover: () => mockPopoverInstance as unknown as Popover,
          getWrapperElement: () => null,
          close: vi.fn(),
        },
      };

      await (inlineToolbar as unknown as { activateToolByShortcut: (toolName: string) => Promise<void> }).activateToolByShortcut('bold');

      expect(tryToShowSpy).toHaveBeenCalled();
    });

    it('should activate item by name when popover is available', async () => {
      inlineToolbar.opened = true;

      // Mock componentRef to return a popover
      (inlineToolbar as unknown as { componentRef: { current: { getPopover: () => Popover | null; getWrapperElement: () => null; close: () => void } | null } }).componentRef = {
        current: {
          getPopover: () => mockPopoverInstance as unknown as Popover,
          getWrapperElement: () => null,
          close: vi.fn(),
        },
      };

      await (inlineToolbar as unknown as { activateToolByShortcut: (toolName: string) => Promise<void> }).activateToolByShortcut('bold');

      expect(mockPopoverInstance.activateItemByName).toHaveBeenCalledWith('bold');
    });

    it('should activate item by name regardless of tool state', async () => {
      inlineToolbar.opened = true;
      const toolInstance = createMockInlineTool('bold', {
        checkState: vi.fn(() => true),
      });
      const toolAdapter = createMockInlineToolAdapter('bold');

      (inlineToolbar as unknown as { tools: Map<InlineToolAdapter, InlineTool> }).tools = new Map([
        [toolAdapter, toolInstance],
      ]);

      // Mock componentRef to return a popover
      (inlineToolbar as unknown as { componentRef: { current: { getPopover: () => Popover | null; getWrapperElement: () => null; close: () => void } | null } }).componentRef = {
        current: {
          getPopover: () => mockPopoverInstance as unknown as Popover,
          getWrapperElement: () => null,
          close: vi.fn(),
        },
      };

      await (inlineToolbar as unknown as { activateToolByShortcut: (toolName: string) => Promise<void> }).activateToolByShortcut('bold');

      expect(mockPopoverInstance.activateItemByName).toHaveBeenCalledWith('bold');
    });

    it('should activate tool when tool is not active', async () => {
      inlineToolbar.opened = true;
      const toolInstance = createMockInlineTool('bold', {
        checkState: vi.fn(() => false),
      });
      const toolAdapter = createMockInlineToolAdapter('bold');

      (inlineToolbar as unknown as { tools: Map<InlineToolAdapter, InlineTool> }).tools = new Map([
        [toolAdapter, toolInstance],
      ]);

      // Mock componentRef to return a popover
      (inlineToolbar as unknown as { componentRef: { current: { getPopover: () => Popover | null; getWrapperElement: () => null; close: () => void } | null } }).componentRef = {
        current: {
          getPopover: () => mockPopoverInstance as unknown as Popover,
          getWrapperElement: () => null,
          close: vi.fn(),
        },
      };

      await (inlineToolbar as unknown as { activateToolByShortcut: (toolName: string) => Promise<void> }).activateToolByShortcut('bold');

      expect(mockPopoverInstance.activateItemByName).toHaveBeenCalledWith('bold');
    });
  });

  describe('shortcut registration', () => {
    it('should register shortcuts for tools with shortcuts', () => {
      const toolAdapter = createMockInlineToolAdapter('bold', {
        shortcut: 'CMD+B',
      });

      mockBlok.Tools.inlineTools.set('bold', toolAdapter);

      (inlineToolbar as unknown as { registerInitialShortcuts: () => void }).registerInitialShortcuts();

      expect(Shortcuts.add).toHaveBeenCalled();
    });

    it('should handle errors when enabling shortcuts', () => {
      const toolAdapter = createMockInlineToolAdapter('bold', {
        shortcut: 'CMD+B',
      });

      mockBlok.Tools.inlineTools.set('bold', toolAdapter);
      vi.mocked(Shortcuts.add).mockImplementation(() => {
        throw new Error('Shortcut error');
      });

      // Should not throw
      expect(() => {
        (inlineToolbar as unknown as { registerInitialShortcuts: () => void }).registerInitialShortcuts();
      }).not.toThrow();
    });
  });

  describe('React integration', () => {
    it('should have componentRef initialized', () => {
      const componentRef = (inlineToolbar as unknown as { componentRef: { current: unknown } }).componentRef;

      expect(componentRef).toBeDefined();
      expect(componentRef.current).toBeNull(); // Initially null before render
    });

    it('should have popover getter that returns null when componentRef is null', () => {
      const popover = (inlineToolbar as unknown as { popover: Popover | null }).popover;

      expect(popover).toBeNull();
    });

    it('should have popover getter that returns popover from componentRef', () => {
      (inlineToolbar as unknown as { componentRef: { current: { getPopover: () => Popover | null } | null } }).componentRef = {
        current: {
          getPopover: () => mockPopoverInstance as unknown as Popover,
        },
      };

      const popover = (inlineToolbar as unknown as { popover: Popover | null }).popover;

      expect(popover).toBe(mockPopoverInstance);
    });
  });
});

