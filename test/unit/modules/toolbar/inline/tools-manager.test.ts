import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { InlineToolsManager } from '../../../../../src/components/modules/toolbar/inline/index';
import type { InlineToolAdapter } from '../../../../../src/components/tools/inline';
import type { InlineTool } from '../../../../../types';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

vi.mock('../../../../../src/components/dom', () => ({
  Dom: {
    isElement: vi.fn((node: unknown) => node instanceof HTMLElement),
  },
}));

vi.mock('../../../../../src/components/selection', async () => {
  const actual = await vi.importActual('../../../../../src/components/selection');
  return actual;
});

describe('InlineToolsManager', () => {
  let toolsManager: InlineToolsManager;
  let mockBlok: BlokModules;

  const createMockInlineTool = (): InlineTool => {
    return {
      render: () => document.createElement('button'),
    } as unknown as InlineTool;
  };

  const createMockInlineToolAdapter = (
    name: string,
    options: {
      shortcut?: string;
      isReadOnlySupported?: boolean;
    } = {}
  ): InlineToolAdapter => {
    return {
      name,
      title: name,
      shortcut: options.shortcut,
      isReadOnlySupported: options.isReadOnlySupported,
      create: () => createMockInlineTool(),
    } as unknown as InlineToolAdapter;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();

    const boldAdapter = createMockInlineToolAdapter('bold', { shortcut: 'CMD+B', isReadOnlySupported: true });
    const italicAdapter = createMockInlineToolAdapter('italic', { shortcut: 'CMD+I', isReadOnlySupported: true });
    const linkAdapter = createMockInlineToolAdapter('link', { shortcut: 'CMD+K', isReadOnlySupported: false });

    mockBlok = {
      Tools: {
        inlineTools: new Map([
          ['bold', boldAdapter],
          ['italic', italicAdapter],
          ['link', linkAdapter],
        ]),
        internal: {
          inlineTools: new Map(),
        },
      },
      ReadOnly: {
        isEnabled: false,
      },
      BlockManager: {
        getBlock: vi.fn(),
        currentBlock: undefined,
      },
    } as unknown as BlokModules;

    const getBlok = () => mockBlok;
    toolsManager = new InlineToolsManager(getBlok);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAvailableTools', () => {
    it('should return empty array when no current block', () => {
      mockBlok.BlockManager.currentBlock = undefined;

      const tools = toolsManager.getAvailableTools();

      expect(tools).toEqual([]);
    });

    it('should return inline tools for current block', () => {
      const boldAdapter = createMockInlineToolAdapter('bold', { shortcut: 'CMD+B' });
      const mockBlock = {
        tool: {
          inlineTools: new Map([['bold', boldAdapter]]),
        },
      };

      mockBlok.BlockManager.currentBlock = mockBlock as unknown as typeof mockBlok.BlockManager.currentBlock;

      const tools = toolsManager.getAvailableTools();

      expect(tools).toHaveLength(1);
      expect(tools[0]).toBe(boldAdapter);
    });

    it('should filter out tools that do not support read-only mode when read-only is enabled', () => {
      const boldAdapter = createMockInlineToolAdapter('bold', { isReadOnlySupported: true });
      const italicAdapter = createMockInlineToolAdapter('italic', { isReadOnlySupported: false });

      const mockBlock = {
        tool: {
          inlineTools: new Map([
            ['bold', boldAdapter],
            ['italic', italicAdapter],
          ]),
        },
      };

      mockBlok.BlockManager.currentBlock = mockBlock as unknown as typeof mockBlok.BlockManager.currentBlock;

      // Create new manager with read-only enabled
      const readOnlyMockBlok = {
        ...mockBlok,
        ReadOnly: { isEnabled: true },
      } as unknown as BlokModules;

      const readOnlyManager = new InlineToolsManager(() => readOnlyMockBlok);

      const tools = readOnlyManager.getAvailableTools();

      expect(tools).toHaveLength(1);
      expect(tools[0]).toBe(boldAdapter);
    });

    it('should include all tools when read-only mode is disabled', () => {
      const boldAdapter = createMockInlineToolAdapter('bold', { isReadOnlySupported: true });
      const italicAdapter = createMockInlineToolAdapter('italic', { isReadOnlySupported: false });

      const mockBlock = {
        tool: {
          inlineTools: new Map([
            ['bold', boldAdapter],
            ['italic', italicAdapter],
          ]),
        },
      };

      mockBlok.BlockManager.currentBlock = mockBlock as unknown as typeof mockBlok.BlockManager.currentBlock;

      // Create new manager with read-only disabled
      const notReadOnlyMockBlok = {
        ...mockBlok,
        ReadOnly: { isEnabled: false },
      } as unknown as BlokModules;

      const notReadOnlyManager = new InlineToolsManager(() => notReadOnlyMockBlok);

      const tools = notReadOnlyManager.getAvailableTools();

      expect(tools).toHaveLength(2);
    });
  });

  describe('createInstances', () => {
    it('should create tool instances from adapters', () => {
      const boldAdapter = createMockInlineToolAdapter('bold');
      const italicAdapter = createMockInlineToolAdapter('italic');

      const tools = [boldAdapter, italicAdapter];
      const instances = toolsManager.createInstances(tools);

      expect(instances.size).toBe(2);
      expect(instances.has(boldAdapter)).toBe(true);
      expect(instances.has(italicAdapter)).toBe(true);
      // The instance is an InlineTool object, not an HTMLElement
      expect(instances.get(boldAdapter)).toBeDefined();
      expect(typeof instances.get(boldAdapter)?.render).toBe('function');
    });

    it('should return empty map when no tools provided', () => {
      const instances = toolsManager.createInstances([]);

      expect(instances.size).toBe(0);
    });
  });

  describe('getToolShortcut', () => {
    it('should return shortcut for custom tool', () => {
      const shortcut = toolsManager.getToolShortcut('bold');

      expect(shortcut).toBe('CMD+B');
    });

    it('should return undefined for tool without shortcut', () => {
      const strikeAdapter = createMockInlineToolAdapter('strike', { shortcut: undefined });
      mockBlok.Tools.inlineTools.set('strike', strikeAdapter);

      const shortcut = toolsManager.getToolShortcut('strike');

      expect(shortcut).toBeUndefined();
    });

    it('should return undefined for non-existent tool', () => {
      const shortcut = toolsManager.getToolShortcut('nonexistent');

      expect(shortcut).toBeUndefined();
    });
  });
});
