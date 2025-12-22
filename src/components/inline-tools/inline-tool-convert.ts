import type { InlineTool, API } from '../../../types';
import type { MenuConfig, MenuConfigItem } from '../../../types/tools';
import { capitalize, isMobileScreen } from '../utils';
import type { Blocks, Selection, Tools, Caret, I18n } from '../../../types/api';
import { SelectionUtils } from '../selection';
import { getConvertibleToolsForBlock } from '../utils/blocks';
import { translateToolTitle, translateToolName, type I18nInstance } from '../utils/tools';
import type { BlockToolAdapter } from '../tools/block';

/**
 * Inline tools for converting blocks
 */
export class ConvertInlineTool implements InlineTool {
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
   * I18n instance wrapper for tool utilities
   */
  private readonly i18nInstance: I18nInstance;

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

    // Create wrapper that provides has() method for tool utilities
    // Public API's t() returns the key itself when translation doesn't exist
    this.i18nInstance = {
      t: (key, _vars) => this.i18nAPI.t(key),
      has: (key) => this.i18nAPI.t(key) !== key,
    };
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
          title: translateToolTitle(this.i18nInstance, toolboxItem, tool.name),
          name: toolboxItem.name ?? tool.name,
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
      ? translateToolTitle(this.i18nInstance, currentBlockToolboxItem, currentBlock.name)
      : translateToolName(this.i18nInstance, currentBlock.name, capitalize(currentBlock.name));
    const isDesktop =  !isMobileScreen();

    return {
      name: 'convert-to',
      title: currentBlockTitle,
       hint: {
        title: this.i18nAPI.t('popover.convertTo'),
      },
      children: {
        items: convertToItems,
        width: 'auto',
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
