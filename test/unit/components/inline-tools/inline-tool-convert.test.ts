import { beforeEach, describe, expect, it, vi } from 'vitest';

import ConvertInlineTool from '../../../../src/components/inline-tools/inline-tool-convert';
import SelectionUtils from '../../../../src/components/selection';
import * as Utils from '../../../../src/components/utils';
import * as BlocksUtils from '../../../../src/components/utils/blocks';
import I18nInternal from '../../../../src/components/i18n';
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
    expect(translateSpy).toHaveBeenCalledWith('toolNames.Heading');

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

  it('uses standard convert for all block types', async () => {
    const { tool, blocksAPI, toolsAPI, caretAPI } = createTool();
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

    // Should use standard convert for blocks
    expect(blocksAPI.convert).toHaveBeenCalledWith('paragraph-block', 'header', { level: 2 });
    expect(caretAPI.setToBlock).toHaveBeenCalledWith(convertedBlock, 'end');
  });
});
