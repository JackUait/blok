import type { InlineTool, API } from '../../../types';
import type { Blocks, Selection, Tools, Caret, I18n } from '../../../types/api';
import type { MenuConfig, MenuConfigItem } from '../../../types/tools';
import { SelectionUtils } from '../selection/index';
import type { BlockToolAdapter } from '../tools/block';
import { capitalize, isMobileScreen } from '../utils';
import { getCaretOffset } from '../utils/caret/selection';
import { getConvertibleToolsForBlock } from '../utils/blocks';
import { buildConvertMenuEntries, type ConvertMenuI18n } from '../utils/convert-menu';
import { translateToolTitle, translateToolName } from '../utils/tools';

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
  private readonly i18nInstance: ConvertMenuI18n;

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

    // Create wrapper that provides has()/getEnglishTranslation() for tool utilities.
    // Public API's t() returns the key itself when translation doesn't exist.
    this.i18nInstance = {
      t: (key, _vars) => this.i18nAPI.t(key),
      has: (key) => this.i18nAPI.t(key) !== key,
      getEnglishTranslation: (key) => this.i18nAPI.getEnglishTranslation(key),
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

    /**
     * Capture the caret offset within the current block while the genuine
     * selection is still live (before the fake background / submenu interaction).
     * Turn-into keeps the caret at this offset instead of forcing it to the end,
     * matching Notion and the markdown-shortcut conversion path.
     */
    const caretOffset = getCaretOffset();

    const allBlockTools = this.toolsAPI.getBlockTools() as BlockToolAdapter[];
    const convertibleTools = await getConvertibleToolsForBlock(currentBlock, allBlockTools);

    if (convertibleTools.length === 0) {
      return [];
    }

    const convertToItems = buildConvertMenuEntries(convertibleTools, this.i18nInstance)
      .map<MenuConfigItem>((entry) => ({
        icon: entry.icon,
        title: entry.title,
        name: entry.name,
        closeOnActivate: true,
        onActivate: async () => {
          const newBlock = await this.blocksAPI.convert(currentBlock.id, entry.toolName, entry.data);

          this.caretAPI.setToBlock(newBlock, 'default', caretOffset);
        },
      }));

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
