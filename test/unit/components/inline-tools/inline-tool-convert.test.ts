import { beforeEach, describe, expect, it, vi } from 'vitest';

import ConvertInlineTool from '../../../../src/components/inline-tools/inline-tool-convert';
import SelectionUtils from '../../../../src/components/selection';
import * as Utils from '../../../../src/components/utils';
import * as BlocksUtils from '../../../../src/components/utils/blocks';
import I18nInternal from '../../../../src/components/i18n';
import { I18nInternalNS } from '../../../../src/components/i18n/namespace-internal';
import type { API } from '../../../../types';
import type BlockToolAdapter from '../../../../src/components/tools/block';

type MenuConfigWithChildren = {
  icon?: string;
  name?: string;
  children?: {
    items?: Array<{
      title?: string;
      onActivate?: () => Promise<void> | void;
    }>;
    onOpen?: () => void;
    onClose?: () => void;
  };
};

const createSelectionMock = (anchorNode: Node): Selection => {
  return { anchorNode } as unknown as Selection;
};

const createTool = (): {
  tool: ConvertInlineTool;
  blocksAPI: { getBlockByElement: ReturnType<typeof vi.fn>; convert: ReturnType<typeof vi.fn> };
  selectionAPI: {
    setFakeBackground: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    removeFakeBackground: ReturnType<typeof vi.fn>;
  };
  toolsAPI: { getBlockTools: ReturnType<typeof vi.fn> };
  caretAPI: { setToBlock: ReturnType<typeof vi.fn> };
} => {
  const blocksAPI = {
    getBlockByElement: vi.fn(),
    convert: vi.fn(),
  };

  const selectionAPI = {
    setFakeBackground: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    removeFakeBackground: vi.fn(),
  };

  const toolsAPI = {
    getBlockTools: vi.fn(),
  };

  const caretAPI = {
    setToBlock: vi.fn(),
  };

  const api = {
    blocks: blocksAPI,
    selection: selectionAPI,
    tools: toolsAPI,
    caret: caretAPI,
    i18n: {},
  } as unknown as API;

  return {
    tool: new ConvertInlineTool({ api }),
    blocksAPI,
    selectionAPI,
    toolsAPI,
    caretAPI,
  };
};

describe('ConvertInlineTool', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('exposes inline metadata', () => {
    expect(ConvertInlineTool.isInline).toBe(true);
  });

  it('returns empty config when selection is missing', async () => {
    const { tool } = createTool();

    vi.spyOn(SelectionUtils, 'get').mockReturnValue(null);

    await expect(tool.render()).resolves.toEqual([]);
  });

  it('returns empty config when current block cannot be resolved', async () => {
    const { tool, blocksAPI } = createTool();
    const anchorNode = document.createElement('div');

    vi.spyOn(SelectionUtils, 'get').mockReturnValue(createSelectionMock(anchorNode));
    blocksAPI.getBlockByElement.mockReturnValue(undefined);

    await expect(tool.render()).resolves.toEqual([]);
    expect(blocksAPI.getBlockByElement).toHaveBeenCalledWith(anchorNode);
  });

  it('returns empty config when no convertible tools found', async () => {
    const { tool, blocksAPI, toolsAPI } = createTool();
    const anchorNode = document.createElement('div');
    const currentBlock = {
      id: 'block-1',
      name: 'paragraph',
      getActiveToolboxEntry: vi.fn(),
    };

    vi.spyOn(SelectionUtils, 'get').mockReturnValue(createSelectionMock(anchorNode));
    blocksAPI.getBlockByElement.mockReturnValue(currentBlock);
    toolsAPI.getBlockTools.mockReturnValue([]);
    vi.spyOn(BlocksUtils, 'getConvertibleToolsForBlock').mockResolvedValue([]);

    await expect(tool.render()).resolves.toEqual([]);
    expect(BlocksUtils.getConvertibleToolsForBlock).toHaveBeenCalledWith(currentBlock, []);
  });

  it('builds menu config and handles desktop-only selection behavior', async () => {
    const { tool, blocksAPI, toolsAPI, selectionAPI, caretAPI } = createTool();
    const anchorNode = document.createElement('div');
    const currentBlock = {
      id: 'block-1',
      name: 'paragraph',
      getActiveToolboxEntry: vi.fn().mockResolvedValue({ icon: '<svg>current</svg>' }),
    };
    const toolboxItem = {
      title: 'Heading',
      icon: '<svg>H</svg>',
      data: {
        level: 2,
      },
    };
    const convertibleTool = {
      name: 'header',
      toolbox: [
        toolboxItem,
      ],
    } as unknown as BlockToolAdapter;
    const convertedBlock = {
      id: 'converted',
    };

    vi.spyOn(SelectionUtils, 'get').mockReturnValue(createSelectionMock(anchorNode));
    blocksAPI.getBlockByElement.mockReturnValue(currentBlock);
    toolsAPI.getBlockTools.mockReturnValue([ convertibleTool ]);
    vi.spyOn(BlocksUtils, 'getConvertibleToolsForBlock').mockResolvedValue([ convertibleTool ]);
    vi.spyOn(Utils, 'isMobileScreen').mockReturnValue(false);
    const translateSpy = vi.spyOn(I18nInternal, 't').mockImplementation(() => 'Heading translated');

    vi.spyOn(I18nInternal, 'ui').mockImplementation(() => 'Convert to');
    blocksAPI.convert.mockResolvedValue(convertedBlock);

    const config = await tool.render();

    expect(Array.isArray(config)).toBe(false);

    const menuConfig = config as MenuConfigWithChildren;

    const children = menuConfig.children;

    expect(children?.items).toHaveLength(1);

    const items = children?.items ?? [];
    const firstItem = items[0];

    expect(firstItem?.title).toBe('Heading translated');
    expect(translateSpy).toHaveBeenCalledWith(I18nInternalNS.toolNames, 'Heading');

    children?.onOpen?.();
    expect(selectionAPI.setFakeBackground).toHaveBeenCalled();
    expect(selectionAPI.save).toHaveBeenCalled();

    children?.onClose?.();
    expect(selectionAPI.restore).toHaveBeenCalled();
    expect(selectionAPI.removeFakeBackground).toHaveBeenCalled();

    await firstItem?.onActivate?.();
    expect(blocksAPI.convert).toHaveBeenCalledWith(currentBlock.id, convertibleTool.name, toolboxItem.data);
    expect(caretAPI.setToBlock).toHaveBeenCalledWith(convertedBlock, 'end');
  });

  it('skips fake selection on mobile', async () => {
    const { tool, blocksAPI, toolsAPI, selectionAPI } = createTool();
    const anchorNode = document.createElement('div');
    const currentBlock = {
      id: 'block-2',
      name: 'paragraph',
      getActiveToolboxEntry: vi.fn().mockResolvedValue(undefined),
    };
    const toolboxItem = {
      title: 'Paragraph',
      icon: '<svg>P</svg>',
    };
    const convertibleTool = {
      name: 'paragraph',
      toolbox: [ toolboxItem ],
    } as unknown as BlockToolAdapter;

    vi.spyOn(SelectionUtils, 'get').mockReturnValue(createSelectionMock(anchorNode));
    blocksAPI.getBlockByElement.mockReturnValue(currentBlock);
    toolsAPI.getBlockTools.mockReturnValue([ convertibleTool ]);
    vi.spyOn(BlocksUtils, 'getConvertibleToolsForBlock').mockResolvedValue([ convertibleTool ]);
    vi.spyOn(Utils, 'isMobileScreen').mockReturnValue(true);
    vi.spyOn(I18nInternal, 't').mockImplementation(() => 'Paragraph');
    vi.spyOn(I18nInternal, 'ui').mockImplementation(() => 'Convert to');

    const config = await tool.render();

    expect(Array.isArray(config)).toBe(false);

    const menuConfig = config as MenuConfigWithChildren;

    menuConfig.children?.onOpen?.();
    menuConfig.children?.onClose?.();

    expect(selectionAPI.setFakeBackground).not.toHaveBeenCalled();
    expect(selectionAPI.save).not.toHaveBeenCalled();
    expect(selectionAPI.restore).not.toHaveBeenCalled();
    expect(selectionAPI.removeFakeBackground).not.toHaveBeenCalled();
  });

  describe('List item conversion - merge with previous item', () => {
    const createToolWithListSupport = (): ReturnType<typeof createTool> & {
      blocksAPI: ReturnType<typeof createTool>['blocksAPI'] & {
        getBlockIndex: ReturnType<typeof vi.fn>;
        insert: ReturnType<typeof vi.fn>;
        delete: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
      };
    } => {
      const base = createTool();
      const blocksAPI = {
        ...base.blocksAPI,
        getBlockIndex: vi.fn(),
        insert: vi.fn(),
        delete: vi.fn(),
        update: vi.fn(),
      };

      const api = {
        blocks: blocksAPI,
        selection: base.selectionAPI,
        tools: base.toolsAPI,
        caret: base.caretAPI,
        i18n: {},
      } as unknown as API;

      return {
        tool: new ConvertInlineTool({ api }),
        blocksAPI,
        selectionAPI: base.selectionAPI,
        toolsAPI: base.toolsAPI,
        caretAPI: base.caretAPI,
      };
    };

    it('converts middle item to separate block between list parts', async () => {
      const { tool, blocksAPI, toolsAPI, caretAPI } = createToolWithListSupport();

      const listItemContent = document.createElement('div');

      listItemContent.setAttribute('contenteditable', 'true');
      listItemContent.innerHTML = 'Item B';

      const listItem = document.createElement('div');

      listItem.setAttribute('data-item-path', '[1]'); // Middle item
      listItem.appendChild(listItemContent);
      document.body.appendChild(listItem);

      // List: Item A, Item B, Item C
      // Converting Item B should split the list: [Item A] + [paragraph] + [Item C]
      const currentBlock = {
        id: 'list-split',
        name: 'list',
        getActiveToolboxEntry: vi.fn().mockResolvedValue({ title: 'Bulleted list' }),
        save: vi.fn().mockResolvedValue({
          data: {
            style: 'unordered',
            items: [
              { content: 'Item A', checked: false },
              { content: 'Item B', checked: false },
              { content: 'Item C', checked: false },
            ],
          },
        }),
      };

      const convertibleTool = {
        name: 'paragraph',
        toolbox: [{ title: 'Text', icon: '<svg>P</svg>' }],
      } as unknown as BlockToolAdapter;

      const newBlock = { id: 'new-paragraph' };

      vi.spyOn(SelectionUtils, 'get').mockReturnValue(createSelectionMock(listItemContent));
      blocksAPI.getBlockByElement.mockReturnValue(currentBlock);
      blocksAPI.getBlockIndex.mockReturnValue(0);
      blocksAPI.insert.mockReturnValue(newBlock);
      toolsAPI.getBlockTools.mockReturnValue([convertibleTool]);
      vi.spyOn(BlocksUtils, 'getConvertibleToolsForBlock').mockResolvedValue([convertibleTool]);
      vi.spyOn(Utils, 'isMobileScreen').mockReturnValue(false);
      vi.spyOn(I18nInternal, 't').mockImplementation(() => 'Text');
      vi.spyOn(I18nInternal, 'ui').mockImplementation(() => 'Convert to');

      const config = await tool.render();
      const menuConfig = config as MenuConfigWithChildren;
      const items = menuConfig.children?.items ?? [];

      await items[0]?.onActivate?.();

      // Should update the original list with only Item A
      expect(blocksAPI.update).toHaveBeenCalledWith('list-split', {
        style: 'unordered',
        items: [
          { content: 'Item A', checked: false },
        ],
      });

      // Should insert a paragraph block after the first list
      expect(blocksAPI.insert).toHaveBeenCalledWith(
        'paragraph',
        { text: 'Item B' },
        undefined,
        1,
        false
      );

      // Should insert a second list with Item C
      expect(blocksAPI.insert).toHaveBeenCalledWith(
        'list',
        {
          style: 'unordered',
          items: [
            { content: 'Item C', checked: false },
          ],
        },
        undefined,
        2,
        false
      );

      expect(caretAPI.setToBlock).toHaveBeenCalledWith(newBlock, 'end');
    });

    it('converts first item to separate block when no previous item exists', async () => {
      const { tool, blocksAPI, toolsAPI, caretAPI } = createToolWithListSupport();

      const listItemContent = document.createElement('div');

      listItemContent.setAttribute('contenteditable', 'true');
      listItemContent.innerHTML = 'First item';

      const listItem = document.createElement('div');

      listItem.setAttribute('data-item-path', '[0]'); // First item
      listItem.appendChild(listItemContent);
      document.body.appendChild(listItem);

      const currentBlock = {
        id: 'list-first',
        name: 'list',
        getActiveToolboxEntry: vi.fn().mockResolvedValue({ title: 'Bulleted list' }),
        save: vi.fn().mockResolvedValue({
          data: {
            style: 'unordered',
            items: [
              { content: 'First item', checked: false },
              { content: 'Second item', checked: false },
            ],
          },
        }),
      };

      const convertibleTool = {
        name: 'paragraph',
        toolbox: [{ title: 'Text', icon: '<svg>P</svg>' }],
      } as unknown as BlockToolAdapter;

      const newBlock = { id: 'new-paragraph' };

      vi.spyOn(SelectionUtils, 'get').mockReturnValue(createSelectionMock(listItemContent));
      blocksAPI.getBlockByElement.mockReturnValue(currentBlock);
      blocksAPI.getBlockIndex.mockReturnValue(0);
      blocksAPI.insert.mockReturnValue(newBlock);
      toolsAPI.getBlockTools.mockReturnValue([convertibleTool]);
      vi.spyOn(BlocksUtils, 'getConvertibleToolsForBlock').mockResolvedValue([convertibleTool]);
      vi.spyOn(Utils, 'isMobileScreen').mockReturnValue(false);
      vi.spyOn(I18nInternal, 't').mockImplementation(() => 'Text');
      vi.spyOn(I18nInternal, 'ui').mockImplementation(() => 'Convert to');

      const config = await tool.render();
      const menuConfig = config as MenuConfigWithChildren;
      const items = menuConfig.children?.items ?? [];

      await items[0]?.onActivate?.();

      // Should insert a new paragraph block at position 0 (before the list)
      expect(blocksAPI.insert).toHaveBeenCalledWith(
        'paragraph',
        { text: 'First item' },
        undefined,
        0,
        false
      );

      // Should update the original list with remaining items
      expect(blocksAPI.update).toHaveBeenCalledWith('list-first', {
        style: 'unordered',
        items: [
          { content: 'Second item', checked: false },
        ],
      });

      // Should NOT delete the list (we update it instead)
      expect(blocksAPI.delete).not.toHaveBeenCalled();

      expect(caretAPI.setToBlock).toHaveBeenCalledWith(newBlock, 'end');
    });

    it('deletes list when converting the only item', async () => {
      const { tool, blocksAPI, toolsAPI, caretAPI } = createToolWithListSupport();

      const listItemContent = document.createElement('div');

      listItemContent.setAttribute('contenteditable', 'true');
      listItemContent.innerHTML = 'Only item';

      const listItem = document.createElement('div');

      listItem.setAttribute('data-item-path', '[0]');
      listItem.appendChild(listItemContent);
      document.body.appendChild(listItem);

      const currentBlock = {
        id: 'list-only',
        name: 'list',
        getActiveToolboxEntry: vi.fn().mockResolvedValue({ title: 'Bulleted list' }),
        save: vi.fn().mockResolvedValue({
          data: {
            style: 'unordered',
            items: [{ content: 'Only item', checked: false }],
          },
        }),
      };

      const convertibleTool = {
        name: 'paragraph',
        toolbox: [{ title: 'Text', icon: '<svg>P</svg>' }],
      } as unknown as BlockToolAdapter;

      const newBlock = { id: 'new-paragraph' };

      vi.spyOn(SelectionUtils, 'get').mockReturnValue(createSelectionMock(listItemContent));
      blocksAPI.getBlockByElement.mockReturnValue(currentBlock);
      blocksAPI.getBlockIndex.mockReturnValue(0);
      blocksAPI.insert.mockReturnValue(newBlock);
      toolsAPI.getBlockTools.mockReturnValue([convertibleTool]);
      vi.spyOn(BlocksUtils, 'getConvertibleToolsForBlock').mockResolvedValue([convertibleTool]);
      vi.spyOn(Utils, 'isMobileScreen').mockReturnValue(false);
      vi.spyOn(I18nInternal, 't').mockImplementation(() => 'Text');
      vi.spyOn(I18nInternal, 'ui').mockImplementation(() => 'Convert to');

      const config = await tool.render();
      const menuConfig = config as MenuConfigWithChildren;
      const items = menuConfig.children?.items ?? [];

      await items[0]?.onActivate?.();

      // Should insert a new paragraph block
      expect(blocksAPI.insert).toHaveBeenCalledWith(
        'paragraph',
        { text: 'Only item' },
        undefined,
        0,
        false
      );

      // Should delete the list block
      expect(blocksAPI.delete).toHaveBeenCalledWith(0);

      expect(caretAPI.setToBlock).toHaveBeenCalledWith(newBlock, 'end');
    });

    it('converts nested item to separate block between list parts', async () => {
      const { tool, blocksAPI, toolsAPI, caretAPI } = createToolWithListSupport();

      const listItemContent = document.createElement('div');

      listItemContent.setAttribute('contenteditable', 'true');
      listItemContent.innerHTML = 'Nested item';

      const listItem = document.createElement('div');

      listItem.setAttribute('data-item-path', '[0,0]'); // First nested item under first parent
      listItem.appendChild(listItemContent);
      document.body.appendChild(listItem);

      // List structure:
      // - Parent
      //   - Nested item (converting this)
      // - Item C
      const currentBlock = {
        id: 'list-nested',
        name: 'list',
        getActiveToolboxEntry: vi.fn().mockResolvedValue({ title: 'Bulleted list' }),
        save: vi.fn().mockResolvedValue({
          data: {
            style: 'unordered',
            items: [
              {
                content: 'Parent',
                checked: false,
                items: [
                  { content: 'Nested item', checked: false },
                ],
              },
              { content: 'Item C', checked: false },
            ],
          },
        }),
      };

      const convertibleTool = {
        name: 'paragraph',
        toolbox: [{ title: 'Text', icon: '<svg>P</svg>' }],
      } as unknown as BlockToolAdapter;

      const newBlock = { id: 'new-paragraph' };

      vi.spyOn(SelectionUtils, 'get').mockReturnValue(createSelectionMock(listItemContent));
      blocksAPI.getBlockByElement.mockReturnValue(currentBlock);
      blocksAPI.getBlockIndex.mockReturnValue(0);
      blocksAPI.insert.mockReturnValue(newBlock);
      toolsAPI.getBlockTools.mockReturnValue([convertibleTool]);
      vi.spyOn(BlocksUtils, 'getConvertibleToolsForBlock').mockResolvedValue([convertibleTool]);
      vi.spyOn(Utils, 'isMobileScreen').mockReturnValue(false);
      vi.spyOn(I18nInternal, 't').mockImplementation(() => 'Text');
      vi.spyOn(I18nInternal, 'ui').mockImplementation(() => 'Convert to');

      const config = await tool.render();
      const menuConfig = config as MenuConfigWithChildren;
      const items = menuConfig.children?.items ?? [];

      await items[0]?.onActivate?.();

      // Should update the original list with Parent (no nested items)
      expect(blocksAPI.update).toHaveBeenCalledWith('list-nested', {
        style: 'unordered',
        items: [
          { content: 'Parent', checked: false },
        ],
      });

      // Should insert a paragraph block after the first list
      expect(blocksAPI.insert).toHaveBeenCalledWith(
        'paragraph',
        { text: 'Nested item' },
        undefined,
        1,
        false
      );

      // Should insert a second list with Item C
      expect(blocksAPI.insert).toHaveBeenCalledWith(
        'list',
        {
          style: 'unordered',
          items: [
            { content: 'Item C', checked: false },
          ],
        },
        undefined,
        2,
        false
      );

      expect(caretAPI.setToBlock).toHaveBeenCalledWith(newBlock, 'end');
    });

    it('converts nested item with sibling to separate block', async () => {
      const { tool, blocksAPI, toolsAPI, caretAPI } = createToolWithListSupport();

      const listItemContent = document.createElement('div');

      listItemContent.setAttribute('contenteditable', 'true');
      listItemContent.innerHTML = 'Second nested';

      const listItem = document.createElement('div');

      listItem.setAttribute('data-item-path', '[0,1]'); // Second nested item
      listItem.appendChild(listItemContent);
      document.body.appendChild(listItem);

      // List structure:
      // - Parent
      //   - First nested
      //   - Second nested (converting this)
      const currentBlock = {
        id: 'list-nested-sibling',
        name: 'list',
        getActiveToolboxEntry: vi.fn().mockResolvedValue({ title: 'Bulleted list' }),
        save: vi.fn().mockResolvedValue({
          data: {
            style: 'unordered',
            items: [
              {
                content: 'Parent',
                checked: false,
                items: [
                  { content: 'First nested', checked: false },
                  { content: 'Second nested', checked: false },
                ],
              },
            ],
          },
        }),
      };

      const convertibleTool = {
        name: 'paragraph',
        toolbox: [{ title: 'Text', icon: '<svg>P</svg>' }],
      } as unknown as BlockToolAdapter;

      const newBlock = { id: 'new-paragraph' };

      vi.spyOn(SelectionUtils, 'get').mockReturnValue(createSelectionMock(listItemContent));
      blocksAPI.getBlockByElement.mockReturnValue(currentBlock);
      blocksAPI.getBlockIndex.mockReturnValue(0);
      blocksAPI.insert.mockReturnValue(newBlock);
      toolsAPI.getBlockTools.mockReturnValue([convertibleTool]);
      vi.spyOn(BlocksUtils, 'getConvertibleToolsForBlock').mockResolvedValue([convertibleTool]);
      vi.spyOn(Utils, 'isMobileScreen').mockReturnValue(false);
      vi.spyOn(I18nInternal, 't').mockImplementation(() => 'Text');
      vi.spyOn(I18nInternal, 'ui').mockImplementation(() => 'Convert to');

      const config = await tool.render();
      const menuConfig = config as MenuConfigWithChildren;
      const items = menuConfig.children?.items ?? [];

      await items[0]?.onActivate?.();

      // Should update the original list with Parent and First nested only
      expect(blocksAPI.update).toHaveBeenCalledWith('list-nested-sibling', {
        style: 'unordered',
        items: [
          {
            content: 'Parent',
            checked: false,
            items: [
              { content: 'First nested', checked: false },
            ],
          },
        ],
      });

      // Should insert a paragraph block after the first list
      expect(blocksAPI.insert).toHaveBeenCalledWith(
        'paragraph',
        { text: 'Second nested' },
        undefined,
        1,
        false
      );

      // Should NOT insert a second list (no items after)
      expect(blocksAPI.insert).toHaveBeenCalledTimes(1);

      expect(caretAPI.setToBlock).toHaveBeenCalledWith(newBlock, 'end');
    });

    it('uses standard convert for non-list blocks', async () => {
      const { tool, blocksAPI, toolsAPI, caretAPI } = createToolWithListSupport();
      const anchorNode = document.createElement('div');

      anchorNode.textContent = 'Some paragraph text';

      const currentBlock = {
        id: 'paragraph-block',
        name: 'paragraph',
        getActiveToolboxEntry: vi.fn().mockResolvedValue({ title: 'Text' }),
      };

      const convertibleTool = {
        name: 'header',
        toolbox: [{ title: 'Heading', icon: '<svg>H</svg>', data: { level: 2 } }],
      } as unknown as BlockToolAdapter;

      const convertedBlock = { id: 'converted-header' };

      vi.spyOn(SelectionUtils, 'get').mockReturnValue(createSelectionMock(anchorNode));
      blocksAPI.getBlockByElement.mockReturnValue(currentBlock);
      blocksAPI.convert.mockResolvedValue(convertedBlock);
      toolsAPI.getBlockTools.mockReturnValue([convertibleTool]);
      vi.spyOn(BlocksUtils, 'getConvertibleToolsForBlock').mockResolvedValue([convertibleTool]);
      vi.spyOn(Utils, 'isMobileScreen').mockReturnValue(false);
      vi.spyOn(I18nInternal, 't').mockImplementation(() => 'Heading');
      vi.spyOn(I18nInternal, 'ui').mockImplementation(() => 'Convert to');

      const config = await tool.render();
      const menuConfig = config as MenuConfigWithChildren;
      const items = menuConfig.children?.items ?? [];

      await items[0]?.onActivate?.();

      // Should use standard convert for non-list blocks
      expect(blocksAPI.convert).toHaveBeenCalledWith('paragraph-block', 'header', { level: 2 });
      expect(caretAPI.setToBlock).toHaveBeenCalledWith(convertedBlock, 'end');

      // Should NOT use list-specific methods
      expect(blocksAPI.insert).not.toHaveBeenCalled();
      expect(blocksAPI.update).not.toHaveBeenCalled();
    });
  });
});
