import { Dom } from '../dom';
import { BlokMobileLayoutToggled } from '../events';
import type { BlockToolAdapter } from '../tools/block';
import type { ToolsCollection } from '../tools/collection';
import { beautifyShortcut, capitalize, isMobileScreen } from '../utils';
import { EventsDispatcher } from '../utils/events';
import { Listeners } from '../utils/listeners';
import type { Popover } from '../utils/popover';
import { PopoverDesktop, PopoverMobile } from '../utils/popover';
import { Shortcuts } from '../utils/shortcuts';
import { translateToolTitle, type I18nInstance } from '../utils/tools';

import type { API, BlockToolData, ToolboxConfigEntry, PopoverItemParams, BlockAPI } from '@/types';
import { PopoverEvent } from '@/types/utils/popover/popover-event';


/**
 * @todo the first Tab on the Block — focus Plus Button, the second — focus Block Tunes Toggler, the third — focus next Block
 */

/**
 * Event that can be triggered by the Toolbox
 */
export enum ToolboxEvent {
  /**
   * When the Toolbox is opened
   */
  Opened = 'toolbox-opened',

  /**
   * When the Toolbox is closed
   */
  Closed = 'toolbox-closed',

  /**
   * When the new Block added by Toolbox
   */
  BlockAdded = 'toolbox-block-added',
}

/**
 * Events fired by the Toolbox
 *
 * Event name -> payload
 */
export interface ToolboxEventMap {
  [ToolboxEvent.Opened]: undefined;
  [ToolboxEvent.Closed]: undefined;
  [ToolboxEvent.BlockAdded]: {
    block: BlockAPI
  };
}

/**
 * Available i18n dict keys that should be passed to the constructor
 */
type ToolboxTextLabelsKeys = 'filter' | 'nothingFound';

/**
 * Toolbox
 * This UI element contains list of Block Tools available to be inserted
 * It appears after click on the Plus Button
 * @implements {EventsDispatcher} with some events, see {@link ToolboxEvent}
 */
export class Toolbox extends EventsDispatcher<ToolboxEventMap> {
  /**
   * Returns True if Toolbox is Empty and nothing to show
   * @returns {boolean}
   */
  public get isEmpty(): boolean {
    return this.toolsToBeDisplayed.length === 0;
  }

  /**
   * Opening state
   * @type {boolean}
   */
  public opened = false;

  /**
   * Listeners util instance
   */
  protected listeners: Listeners = new Listeners();

  /**
   * Blok API
   */
  private api: API;

  /**
   * Popover instance. There is a util for vertical lists.
   * Null until initialized
   */
  private popover: Popover | null = null;

  /**
   * List of Tools available. Some of them will be shown in the Toolbox
   */
  private tools: ToolsCollection<BlockToolAdapter>;

  /**
   * Cache for tools to be displayed
   */
  private _toolsToBeDisplayed: BlockToolAdapter[] | undefined;

  /**
   * Cache for toolbox items to be displayed
   */
  private _toolboxItemsToBeDisplayed: PopoverItemParams[] | undefined;

  /**
   * Text labels used in the Toolbox. Should be passed from the i18n module
   */
  private i18nLabels: Record<ToolboxTextLabelsKeys, string>;

  /**
   * I18n instance for translations
   */
  private i18n: I18nInstance;

  /**
   * Current module HTML Elements
   */
  private nodes: {
    toolbox: HTMLElement;
  } ;

  /**
   * CSS styles
   * @deprecated Use data attributes for identification instead
   */
  private static get CSS(): {
    toolbox: string;
    } {
    return {
      toolbox: '',
    };
  }

  /**
   * Element relative to which the popover should be positioned
   */
  private triggerElement?: HTMLElement;

  /**
   * The block element currently being listened to for inline slash search
   */
  private currentBlockForSearch: HTMLElement | null = null;

  /**
   * Cached contentEditable element for the current block being searched.
   * Avoids repeated DOM queries on each input event.
   */
  private currentContentEditable: Element | null = null;

  /**
   * Toolbox constructor
   * @param options - available parameters
   * @param options.api - Blok API methods
   * @param options.tools - Tools available to check whether some of them should be displayed at the Toolbox or not
   * @param options.i18n - I18n instance for translations
   * @param options.triggerElement - Element relative to which the popover should be positioned
   */
  constructor({ api, tools, i18nLabels, i18n, triggerElement }: {
    api: API;
    tools: ToolsCollection<BlockToolAdapter>;
    i18nLabels: Record<ToolboxTextLabelsKeys, string>;
    i18n: I18nInstance;
    triggerElement?: HTMLElement;
  }) {
    super();

    this.api = api;
    this.tools = tools;
    this.i18nLabels = i18nLabels;
    this.i18n = i18n;
    this.triggerElement = triggerElement;

    this.enableShortcuts();

    this.nodes = {
      toolbox: Dom.make('div'),
    };
    this.nodes.toolbox.setAttribute('data-blok-testid', 'toolbox');

    this.initPopover();

    this.api.events.on(BlokMobileLayoutToggled, this.handleMobileLayoutToggle);
  }

  /**
   * Returns root block settings element
   */
  public getElement(): HTMLElement | null {
    return this.nodes.toolbox;
  }

  /**
   * Checks if the element is contained in the Toolbox or its Popover
   * @param element - element to check
   */
  public contains(element: HTMLElement): boolean {
    if (this.nodes.toolbox.contains(element)) {
      return true;
    }

    if (this.popover?.getElement().contains(element)) {
      return true;
    }

    return false;
  }

  /**
   * Returns true if the Toolbox has the Flipper activated and the Flipper has selected button
   */
  public hasFocus(): boolean | undefined {
    if (this.popover === null) {
      return;
    }

    return 'hasFocus' in this.popover ? this.popover.hasFocus() : undefined;
  }

  /**
   * Destroy Module
   */
  public destroy(): void {
    super.destroy();

    if (this.nodes && this.nodes.toolbox) {
      this.nodes.toolbox.remove();
    }

    this.removeAllShortcuts();
    this.popover?.off(PopoverEvent.Closed, this.onPopoverClose);
    this.listeners.destroy();
    this.api.events.off(BlokMobileLayoutToggled, this.handleMobileLayoutToggle);
  }

  /**
   * Toolbox Tool's button click handler
   * @param toolName - tool type to be activated
   * @param blockDataOverrides - Block data predefined by the activated Toolbox item
   */
  public async toolButtonActivated(toolName: string, blockDataOverrides?: BlockToolData): Promise<void> {
    await this.insertNewBlock(toolName, blockDataOverrides);
  }

  /**
   * Open Toolbox with Tools
   */
  public open(): void {
    if (this.isEmpty) {
      return;
    }

    /**
     * Stop mutation watching on the current block when toolbox opens.
     * This prevents spurious block-changed events from DOM manipulations
     * that may occur during toolbox interactions (focus changes, etc).
     */
    const currentBlockIndex = this.api.blocks.getCurrentBlockIndex();

    this.api.blocks.stopBlockMutationWatching(currentBlockIndex);

    this.popover?.show();
    this.opened = true;
    this.emit(ToolboxEvent.Opened);
    this.startListeningToBlockInput();
  }

  /**
   * Close Toolbox
   */
  public close(): void {
    this.popover?.hide();
    this.opened = false;
    this.emit(ToolboxEvent.Closed);
  }

  /**
   * Close Toolbox
   */
  public toggle(): void {
    if (!this.opened) {
      this.open();
    } else {
      this.close();
    }
  }

  /**
   * Destroys existing popover instance and contructs the new one.
   */
  public handleMobileLayoutToggle = (): void  => {
    this.destroyPopover();
    this.initPopover();
  };

  /**
   * Creates toolbox popover and appends it inside wrapper element
   */
  private initPopover(): void {
    const PopoverClass = isMobileScreen() ? PopoverMobile : PopoverDesktop;

    this.popover = new PopoverClass({
      scopeElement: this.api.ui.nodes.redactor,
      trigger: this.triggerElement || this.nodes.toolbox,
      messages: {
        nothingFound: this.i18nLabels.nothingFound,
        search: this.i18nLabels.filter,
      },
      items: this.toolboxItemsToBeDisplayed,
      handleContentEditableNavigation: true,
    });

    this.popover.on(PopoverEvent.Closed, this.onPopoverClose);
    this.popover.getElement().setAttribute('data-blok-testid', 'toolbox-popover');
  }

  /**
   * Destroys popover instance and removes it from DOM
   */
  private destroyPopover(): void {
    if (this.popover !== null) {
      this.popover.hide();
      this.popover.off(PopoverEvent.Closed, this.onPopoverClose);
      this.popover.destroy();
      this.popover = null;
    }

    if (this.nodes.toolbox !== null) {
      this.nodes.toolbox.innerHTML = '';
    }
  }

  /**
   * Handles popover close event
   */
  private onPopoverClose = (): void => {
    this.stopListeningToBlockInput();
    this.opened = false;
    this.emit(ToolboxEvent.Closed);
  };

  /**
   * Returns list of tools that enables the Toolbox (by specifying the 'toolbox' getter)
   */
  private get toolsToBeDisplayed(): BlockToolAdapter[] {
    if (this._toolsToBeDisplayed) {
      return this._toolsToBeDisplayed;
    }

    const result: BlockToolAdapter[] = [];

    this.tools.forEach((tool) => {
      const toolToolboxSettings = tool.toolbox;

      if (toolToolboxSettings) {
        result.push(tool);
      }
    });

    this._toolsToBeDisplayed = result;

    return result;
  }

  /**
   * Returns list of items that will be displayed in toolbox
   */
  private get toolboxItemsToBeDisplayed(): PopoverItemParams[] {
    if (this._toolboxItemsToBeDisplayed) {
      return this._toolboxItemsToBeDisplayed;
    }

    /**
     * Maps tool data to popover item structure
     */
    const toPopoverItem = (toolboxItem: ToolboxConfigEntry, tool: BlockToolAdapter, displaySecondaryLabel = true): PopoverItemParams => {
      // Get English title for search fallback
      const titleKey = toolboxItem.titleKey;
      const englishTitleKey = titleKey ? `toolNames.${titleKey}` : undefined;
      const englishTitle = englishTitleKey
        ? this.api.i18n.getEnglishTranslation(englishTitleKey)
        : toolboxItem.title;

      // Merge library searchTerms with user-provided searchTerms
      const librarySearchTerms = toolboxItem.searchTerms ?? [];
      const userSearchTerms = tool.searchTerms ?? [];
      const mergedSearchTerms = [...new Set([...librarySearchTerms, ...userSearchTerms])];

      // Use entry-level shortcut if available, otherwise fall back to tool-level shortcut (for first entry only)
      const shortcut = toolboxItem.shortcut ?? (displaySecondaryLabel ? tool.shortcut : undefined);

      return {
        icon: toolboxItem.icon,
        title: translateToolTitle(this.i18n, toolboxItem, capitalize(tool.name)),
        name: toolboxItem.name ?? tool.name,
        onActivate: (): void => {
          void this.toolButtonActivated(tool.name, toolboxItem.data);
        },
        secondaryLabel: shortcut ? beautifyShortcut(shortcut) : '',
        englishTitle,
        searchTerms: mergedSearchTerms,
      };
    };

    const result = this.toolsToBeDisplayed
      .reduce<PopoverItemParams[]>((acc, tool) => {
        const { toolbox } = tool;

        if (toolbox === undefined) {
          return acc;
        }

        const items = Array.isArray(toolbox) ? toolbox : [ toolbox ];

        items.forEach((item, index) => {
          acc.push(toPopoverItem(item, tool, index === 0));
        });

        return acc;
      }, []);

    this._toolboxItemsToBeDisplayed = result;

    return result;
  }

  /**
   * Iterate all tools and enable theirs shortcuts if specified
   */
  private enableShortcuts(): void {
    this.toolsToBeDisplayed.forEach((tool: BlockToolAdapter) => {
      const shortcut = tool.shortcut;

      if (shortcut) {
        this.enableShortcutForTool(tool.name, shortcut);
      }
    });
  }

  /**
   * Enable shortcut Block Tool implemented shortcut
   * @param {string} toolName - Tool name
   * @param {string} shortcut - shortcut according to the ShortcutData Module format
   */
  private enableShortcutForTool(toolName: string, shortcut: string): void {
    Shortcuts.add({
      name: shortcut,
      on: this.api.ui.nodes.redactor,
      handler: async (event: KeyboardEvent) => {
        event.preventDefault();

        const currentBlockIndex = this.api.blocks.getCurrentBlockIndex();
        const currentBlock = this.api.blocks.getBlockByIndex(currentBlockIndex);

        /**
         * Try to convert current Block to shortcut's tool
         * If conversion is not possible, insert a new Block below
         */
        if (currentBlock) {
          try {
            const newBlock = await this.api.blocks.convert(currentBlock.id, toolName);

            this.api.caret.setToBlock(newBlock, 'end');

            return;
          } catch (_error) {}
        }

        await this.insertNewBlock(toolName);
      },
    });
  }

  /**
   * Removes all added shortcuts
   * Fired when the Read-Only mode is activated
   */
  private removeAllShortcuts(): void {
    this.toolsToBeDisplayed.forEach((tool: BlockToolAdapter) => {
      const shortcut = tool.shortcut;

      if (shortcut) {
        Shortcuts.remove(this.api.ui.nodes.redactor, shortcut);
      }
    });
  }

  /**
   * Inserts new block
   * Can be called when button clicked on Toolbox or by ShortcutData
   * @param {string} toolName - Tool name
   * @param blockDataOverrides - predefined Block data
   */
  private async insertNewBlock(toolName: string, blockDataOverrides?: BlockToolData): Promise<void> {
    const currentBlockIndex = this.api.blocks.getCurrentBlockIndex();
    const currentBlock = this.api.blocks.getBlockByIndex(currentBlockIndex);

    if (!currentBlock) {
      return;
    }

    /**
     * Check if the block contains only slash search text (e.g., "/head").
     * If so, treat it as empty and replace it with the new block.
     */
    const shouldReplaceBlock = currentBlock.isEmpty || this.isBlockSlashSearchOnly(currentBlock.holder);

    /**
     * On mobile version, we see the Plus Button even near non-empty blocks,
     * so if current block is not empty, add the new block below the current
     */
    const index = shouldReplaceBlock ? currentBlockIndex : currentBlockIndex + 1;

    const hasBlockDataOverrides = blockDataOverrides !== undefined && Object.keys(blockDataOverrides as Record<string, unknown>).length > 0;

    const blockData: BlockToolData | undefined = hasBlockDataOverrides
      ? Object.assign(await this.api.blocks.composeBlockData(toolName), blockDataOverrides)
      : undefined;

    const newBlock = this.api.blocks.insert(
      toolName,
      blockData,
      undefined,
      index,
      undefined,
      shouldReplaceBlock
    );

    this.api.caret.setToBlock(index);

    this.emit(ToolboxEvent.BlockAdded, {
      block: newBlock,
    });

    /**
     * close toolbar when node is changed
     */
    this.api.toolbar.close();
  }

  /**
   * Starts listening to input events on the current block for inline slash search.
   * When the user types after "/", the toolbox filters based on the typed text.
   */
  private startListeningToBlockInput(): void {
    const currentBlockIndex = this.api.blocks.getCurrentBlockIndex();
    const currentBlock = this.api.blocks.getBlockByIndex(currentBlockIndex);

    if (!currentBlock) {
      return;
    }

    this.currentBlockForSearch = currentBlock.holder;
    this.currentContentEditable = this.currentBlockForSearch.querySelector('[contenteditable="true"]');
    this.listeners.on(this.currentBlockForSearch, 'input', this.handleBlockInput);
  }

  /**
   * Stops listening to block input events and resets the filter.
   */
  private stopListeningToBlockInput(): void {
    if (this.currentBlockForSearch !== null) {
      this.listeners.off(this.currentBlockForSearch, 'input', this.handleBlockInput);
      this.currentBlockForSearch = null;
      this.currentContentEditable = null;
    }

    this.popover?.filterItems('');
  }

  /**
   * Handles input events on the block to filter the toolbox.
   * Extracts text after "/" and applies it as a filter query.
   */
  private handleBlockInput = (): void => {
    if (this.currentContentEditable === null) {
      return;
    }

    const text = this.currentContentEditable.textContent || '';
    const slashIndex = text.lastIndexOf('/');

    if (slashIndex === -1) {
      this.close();

      return;
    }

    const query = text.slice(slashIndex + 1);

    this.popover?.filterItems(query);
  };

  /**
   * Checks if a block contains only slash search text (e.g., "/head").
   * A block is considered "slash search only" if its text starts with "/" and contains no other content before it.
   * @param blockHolder - the block's holder element
   * @returns true if the block only contains slash search text
   */
  private isBlockSlashSearchOnly(blockHolder: HTMLElement): boolean {
    const contentEditable = blockHolder.querySelector('[contenteditable="true"]');
    const text = contentEditable?.textContent?.trim() || '';

    // Block must start with "/" to be considered slash search only
    return text.startsWith('/');
  }
}
