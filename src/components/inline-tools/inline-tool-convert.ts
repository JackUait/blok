import type { InlineTool, API } from '../../../types';
import type { MenuConfig, MenuConfigItem } from '../../../types/tools';
import * as _ from '../utils';
import type { Blocks, Selection, Tools, Caret, I18n } from '../../../types/api';
import SelectionUtils from '../selection';
import { getConvertibleToolsForBlock } from '../utils/blocks';
import I18nInternal from '../i18n';
import { translateToolTitle, translateToolName } from '../utils/tools';
import type BlockToolAdapter from '../tools/block';

/**
 * Inline tools for converting blocks
 */
export default class ConvertInlineTool implements InlineTool {
  /**
   * Specifies Tool as Inline Toolbar Tool
   */
  public static isInline = true;

  /**
   * API for working with blok blocks
   */
  private readonly blocksAPI: Blocks;

  /**
   * API for working with Selection
   */
  private readonly selectionAPI: Selection;

  /**
   * API for working with Tools
   */
  private readonly toolsAPI: Tools;

  /**
   * I18n API
   */
  private readonly i18nAPI: I18n;

  /**
   * API for working with Caret
   */
  private readonly caretAPI: Caret;

  /**
   * @param api - Blok API
   */
  constructor({ api }: { api: API }) {
    this.i18nAPI = api.i18n;
    this.blocksAPI = api.blocks;
    this.selectionAPI = api.selection;
    this.toolsAPI = api.tools;
    this.caretAPI = api.caret;
  }

  /**
   * Returns tool's UI config
   */
  public async render(): Promise<MenuConfig> {
    const currentSelection = SelectionUtils.get();

    if (currentSelection === null) {
      return [];
    }

    const currentBlock = this.blocksAPI.getBlockByElement(currentSelection.anchorNode as HTMLElement);

    if (currentBlock === undefined) {
      return [];
    }

    const allBlockTools = this.toolsAPI.getBlockTools() as BlockToolAdapter[];
    const convertibleTools = await getConvertibleToolsForBlock(currentBlock, allBlockTools);

    if (convertibleTools.length === 0) {
      return [];
    }

    const convertToItems = convertibleTools.reduce<MenuConfigItem[]>((result, tool) => {
      tool.toolbox?.forEach((toolboxItem) => {
        if (toolboxItem.title === undefined) {
          return;
        }

        result.push({
          icon: toolboxItem.icon,
          title: translateToolTitle(toolboxItem, tool.name),
          name: tool.name,
          closeOnActivate: true,
          onActivate: async () => {
            const newBlock = await this.blocksAPI.convert(currentBlock.id, tool.name, toolboxItem.data);

            this.caretAPI.setToBlock(newBlock, 'end');
          },
        });
      });

      return result;
    }, []);

    const currentBlockToolboxItem = await currentBlock.getActiveToolboxEntry();
    const currentBlockTitle = currentBlockToolboxItem
      ? translateToolTitle(currentBlockToolboxItem, currentBlock.name)
      : translateToolName(currentBlock.name, _.capitalize(currentBlock.name));
    const isDesktop =  !_.isMobileScreen();

    return {
      name: 'convert-to',
      title: currentBlockTitle,
       hint: {
        title: I18nInternal.t('popover.convertTo'),
      },
      children: {
        items: convertToItems,
        onOpen: () => {
          if (isDesktop) {
            this.selectionAPI.setFakeBackground();
            this.selectionAPI.save();
          }
        },
        onClose: () => {
          if (isDesktop) {
            this.selectionAPI.restore();
            this.selectionAPI.removeFakeBackground();
          }
        },
      },
    };
  }
}
