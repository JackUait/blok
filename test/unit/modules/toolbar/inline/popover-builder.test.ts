import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { InlinePopoverBuilder } from '../../../../../src/components/modules/toolbar/inline/index';
import type { InlineToolAdapter } from '../../../../../src/components/tools/inline';
import type { InlineTool } from '../../../../../types';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import { PopoverItemType } from '../../../../../src/components/utils/popover';

vi.mock('../../../../../src/components/utils', () => ({
  beautifyShortcut: (shortcut: string) => `⌘${shortcut.slice(-1)}`,
  capitalize: (str: string) => str.charAt(0).toUpperCase() + str.slice(1),
  translateToolName: (i18n: any, _key: string, title: string) => title,
}));

describe('InlinePopoverBuilder', () => {
  let popoverBuilder: InlinePopoverBuilder;
  let mockBlok: BlokModules;
  let mockI18n: {
    t: ReturnType<typeof vi.fn>;
    has: ReturnType<typeof vi.fn>;
  };

  const createMockInlineTool = (
    renderResult: unknown
  ): InlineTool => {
    return {
      render: () => renderResult,
    } as InlineTool;
  };

  const createMockInlineToolAdapter = (
    name: string,
    options: {
      title?: string;
      shortcut?: string;
      renderResult?: unknown;
    } = {}
  ): InlineToolAdapter => {
    return {
      name,
      title: options.title || name,
      shortcut: options.shortcut,
      isReadOnlySupported: true,
      create: () => createMockInlineTool(options.renderResult || { icon: '', label: name }),
    } as unknown as InlineToolAdapter;
  };

  const getItemParams = (item: unknown) => {
    return item as { name?: string; hint?: { title?: string; description?: string } };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();

    mockBlok = {
      Tools: {
        inlineTools: new Map(),
      },
    } as unknown as BlokModules;

    mockI18n = {
      t: vi.fn((key: string) => key),
      has: vi.fn(() => false),
    } as unknown as typeof mockI18n;

    const getBlok = () => mockBlok;
    const getI18n = () => mockI18n as any;
    popoverBuilder = new InlinePopoverBuilder(getBlok, getI18n);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('build', () => {
    it('should build popover items from tool instances', async () => {
      const boldAdapter = createMockInlineToolAdapter('bold', {
        title: 'Bold',
        shortcut: 'CMD+B',
        renderResult: {
          icon: 'B',
          label: 'Bold',
          onActivate: vi.fn(),
        },
      });

      mockBlok.Tools.inlineTools.set('bold', boldAdapter);

      const boldInstance = boldAdapter.create();
      const toolsMap = new Map([[boldAdapter, boldInstance]]);

      const items = await popoverBuilder.build(toolsMap);

      expect(items).toHaveLength(1);
      const firstItem = getItemParams(items[0]);
      expect(firstItem.name).toBe('bold');
      expect(firstItem.hint).toEqual({
        title: 'Bold',
        description: '⌘B',
      });
    });

    it('should skip legacy HTMLElement returns', async () => {
      const boldAdapter = createMockInlineToolAdapter('bold', {
        renderResult: document.createElement('button'),
      });

      mockBlok.Tools.inlineTools.set('bold', boldAdapter);

      const boldInstance = boldAdapter.create();
      const toolsMap = new Map([[boldAdapter, boldInstance]]);

      const items = await popoverBuilder.build(toolsMap);

      expect(items).toHaveLength(0);
    });

    it('should handle PopoverItemType.Html', async () => {
      const boldAdapter = createMockInlineToolAdapter('bold', {
        renderResult: {
          type: PopoverItemType.Html,
          icon: 'B',
          label: 'Bold',
        },
      });

      mockBlok.Tools.inlineTools.set('bold', boldAdapter);

      const boldInstance = boldAdapter.create();
      const toolsMap = new Map([[boldAdapter, boldInstance]]);

      const items = await popoverBuilder.build(toolsMap);

      expect(items).toHaveLength(1);
      expect(items[0].type).toBe(PopoverItemType.Html);
    });

    it('should handle PopoverItemType.Separator', async () => {
      const boldAdapter = createMockInlineToolAdapter('bold', {
        renderResult: {
          type: PopoverItemType.Separator,
        },
      });

      mockBlok.Tools.inlineTools.set('bold', boldAdapter);

      const boldInstance = boldAdapter.create();
      const toolsMap = new Map([[boldAdapter, boldInstance]]);

      const items = await popoverBuilder.build(toolsMap);

      expect(items).toHaveLength(1);
      expect(items[0].type).toBe(PopoverItemType.Separator);
    });

    it('should add separator after first item with children', async () => {
      const boldAdapter = createMockInlineToolAdapter('bold', {
        renderResult: {
          icon: 'B',
          label: 'Bold',
          children: [
            { icon: 'B1', label: 'Bold 1' },
            { icon: 'B2', label: 'Bold 2' },
          ],
        },
      });

      mockBlok.Tools.inlineTools.set('bold', boldAdapter);

      const boldInstance = boldAdapter.create();
      const toolsMap = new Map([[boldAdapter, boldInstance]]);

      const items = await popoverBuilder.build(toolsMap);

      expect(items).toHaveLength(2);
      const firstItem = getItemParams(items[0]);
      expect(firstItem.name).toBe('bold');
      expect(items[1].type).toBe(PopoverItemType.Separator);
    });

    it('should handle array returns', async () => {
      const boldAdapter = createMockInlineToolAdapter('bold', {
        renderResult: [
          { icon: 'B', label: 'Bold' },
          { icon: 'I', label: 'Italic' },
        ],
      });

      mockBlok.Tools.inlineTools.set('bold', boldAdapter);

      const boldInstance = boldAdapter.create();
      const toolsMap = new Map([[boldAdapter, boldInstance]]);

      const items = await popoverBuilder.build(toolsMap);

      expect(items).toHaveLength(2);
      const firstItem = getItemParams(items[0]);
      const secondItem = getItemParams(items[1]);
      expect(firstItem.name).toBe('bold');
      expect(secondItem.name).toBe('bold');
    });

    it('should not add separator for non-first items with children', async () => {
      const boldAdapter = createMockInlineToolAdapter('bold', {
        renderResult: { icon: 'B', label: 'Bold' },
      });
      const italicAdapter = createMockInlineToolAdapter('italic', {
        renderResult: {
          icon: 'I',
          label: 'Italic',
          children: [{ icon: 'I1', label: 'Italic 1' }],
        },
      });

      mockBlok.Tools.inlineTools.set('bold', boldAdapter);
      mockBlok.Tools.inlineTools.set('italic', italicAdapter);

      const boldInstance = boldAdapter.create();
      const italicInstance = italicAdapter.create();
      const toolsMap = new Map([
        [boldAdapter, boldInstance],
        [italicAdapter, italicInstance],
      ]);

      const items = await popoverBuilder.build(toolsMap);

      // Should have: bold item, italic item (no separator after italic since it's not first)
      expect(items).toHaveLength(2);
      const firstItem = getItemParams(items[0]);
      const secondItem = getItemParams(items[1]);
      expect(firstItem.name).toBe('bold');
      expect(secondItem.name).toBe('italic');
    });

    it('should handle tools without shortcuts', async () => {
      const boldAdapter = createMockInlineToolAdapter('bold', {
        title: 'Bold',
        renderResult: { icon: 'B', label: 'Bold' },
      });

      mockBlok.Tools.inlineTools.set('bold', boldAdapter);

      const boldInstance = boldAdapter.create();
      const toolsMap = new Map([[boldAdapter, boldInstance]]);

      const items = await popoverBuilder.build(toolsMap);

      expect(items).toHaveLength(1);
      const firstItem = getItemParams(items[0]);
      expect(firstItem.hint?.description).toBeUndefined();
    });

    it('should use title from adapter if titleKey not available', async () => {
      const boldAdapter = createMockInlineToolAdapter('bold', {
        title: 'Bold Text',
        renderResult: { icon: 'B', label: 'Bold' },
      });

      mockBlok.Tools.inlineTools.set('bold', boldAdapter);

      const boldInstance = boldAdapter.create();
      const toolsMap = new Map([[boldAdapter, boldInstance]]);

      const items = await popoverBuilder.build(toolsMap);

      expect(items).toHaveLength(1);
      const firstItem = getItemParams(items[0]);
      expect(firstItem.hint?.title).toBe('Bold Text');
    });
  });
});
