import { getRestrictedTools } from '../../tools/table/table-restrictions';
import { Dom } from '../dom';
import { BlokMobileLayoutToggled } from '../events';
import { SelectionUtils } from '../selection';
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
import { DATA_ATTR } from '../constants';


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
type ToolboxTextLabelsKeys = 'filter' | 'nothingFound' | 'slashSearchPlaceholder';

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
   * Optional element whose left edge is used for horizontal popover alignment.
   */
  private leftAlignElement?: HTMLElement;

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
   * Whether the toolbox was opened inside a table cell.
   * Used to restore restricted tool visibility on close.
   */
  private isInsideTableCell = false;

  /**
   * Whether the toolbox was opened in slash-search mode (via "/" key or existing slash paragraph).
   * When false (opened via plus button), the input filter uses the full block text as the query
   * instead of requiring a leading "/" and does not close on missing slash.
   */
  private openedWithSlash = true;

  /**
   * Toolbox constructor
   * @param options - available parameters
   * @param options.api - Blok API methods
   * @param options.tools - Tools available to check whether some of them should be displayed at the Toolbox or not
   * @param options.i18n - I18n instance for translations
   * @param options.triggerElement - Element relative to which the popover should be positioned
   * @param options.leftAlignElement - Element whose left edge is used for horizontal popover alignment
   */
  constructor({ api, tools, i18nLabels, i18n, triggerElement, leftAlignElement }: {
    api: API;
    tools: ToolsCollection<BlockToolAdapter>;
    i18nLabels: Record<ToolboxTextLabelsKeys, string>;
    i18n: I18nInstance;
    triggerElement?: HTMLElement;
    leftAlignElement?: HTMLElement;
  }) {
    super();

    this.api = api;
    this.tools = tools;
    this.i18nLabels = i18nLabels;
    this.i18n = i18n;
    this.triggerElement = triggerElement;
    this.leftAlignElement = leftAlignElement;

    this.enableShortcuts();

    this.nodes = {
      toolbox: Dom.make('div'),
    };
    this.nodes.toolbox.setAttribute('data-blok-testid', 'toolbox');

    this.initPopover();

    this.api.events.on(BlokMobileLayoutToggled, this.handleMobileLayoutToggle);
  }

  /**
   * Updates the element used for horizontal popover alignment.
   * Called when the toolbar moves to a new block so the popover
   * aligns with the block's content element rather than the toolbar's own wrapper.
   * @param element - block content element to align against
   */
  public updateLeftAlignElement(element: HTMLElement | undefined): void {
    this.leftAlignElement = element;

    if (this.popover !== null && 'setLeftAlignElement' in this.popover) {
      (this.popover as { setLeftAlignElement: (el: HTMLElement | undefined) => void }).setLeftAlignElement(element);
    }
  }

  /**
   * Applies or clears callout background color on the popover's search input.
   * When the toolbox opens inside a callout with a custom background, the search
   * input container should match the callout background instead of its default.
   *
   * @param color - the callout background CSS value, or null to clear
   */
  public setCalloutBackground(color: string | null): void {
    const popoverEl = this.popover?.getElement();

    if (!popoverEl) {
      return;
    }

    if (color) {
      popoverEl.style.setProperty('--blok-search-input-bg', `light-dark(color-mix(in srgb, ${color} 70%, white), color-mix(in srgb, ${color} 85%, white))`);
    } else {
      popoverEl.style.removeProperty('--blok-search-input-bg');
      popoverEl.style.removeProperty('--blok-search-input-border');
    }
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
   * @param withSlash - When true (default), inline search requires "/" and closes on its removal.
   *                    When false (plus button), the full block text is used as the filter query.
   */
  public open(withSlash = true): void {
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

    const currentBlock = this.api.blocks.getBlockByIndex(currentBlockIndex);

    /**
     * Hide restricted tools (headers, tables) when the caret is inside a table cell.
     */
    this.isInsideTableCell = currentBlock !== undefined
      && currentBlock.holder.closest('[data-blok-table-cell-blocks]') !== null;

    if (this.isInsideTableCell) {
      this.toggleRestrictedToolsHidden(true);
    }

    this.popover?.show();

    /**
     * When opening toolbox inside a table cell, position it at the caret
     * instead of at the trigger element (which is outside the table).
     * Must be called after show() so the popover is in the DOM.
     */
    const triggerHidden = this.triggerElement?.getBoundingClientRect().height === 0;

    if ((this.isInsideTableCell || triggerHidden) && this.popover instanceof PopoverDesktop) {
      const caretRect = SelectionUtils.rect;

      this.popover.updatePosition(caretRect);
    } else if (!withSlash && this.popover instanceof PopoverDesktop) {
      /**
       * When opened without slash (via plus button), the trigger element (plus button)
       * is at the top of the block. Position the popover below the block's bottom edge
       * instead, so it doesn't overlap the block's placeholder text.
       */
      const currentBlock = this.api.blocks.getBlockByIndex(currentBlockIndex);

      if (currentBlock) {
        this.popover.updatePosition(currentBlock.holder.getBoundingClientRect());
      }
    }

    this.openedWithSlash = withSlash;
    this.opened = true;
    this.emit(ToolboxEvent.Opened);
    this.startListeningToBlockInput();
  }

  /**
   * Close Toolbox
   */
  public close(): void {
    if (this.isInsideTableCell) {
      this.toggleRestrictedToolsHidden(false);
      this.isInsideTableCell = false;
    }

    this.stopListeningToBlockInput();
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
      leftAlignElement: this.leftAlignElement,
      messages: {
        nothingFound: this.i18nLabels.nothingFound,
        search: this.i18nLabels.filter,
      },
      items: this.toolboxItemsToBeDisplayed,
      handleContentEditableNavigation: true,
      minWidth: '250px',
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
    if (this.isInsideTableCell) {
      this.toggleRestrictedToolsHidden(false);
      this.isInsideTableCell = false;
    }

    this.stopListeningToBlockInput();
    this.opened = false;
    this.emit(ToolboxEvent.Closed);
  };

  /**
   * Toggles hidden state for all popover items belonging to restricted tools.
   * Matches by tool registration name so that tools with custom entry names
   * (e.g., list tool with entries named bulleted-list, numbered-list, check-list)
   * are correctly restricted.
   */
  private toggleRestrictedToolsHidden(isHidden: boolean): void {
    const restrictedTools = getRestrictedTools();

    for (const tool of this.toolsToBeDisplayed) {
      if (!restrictedTools.includes(tool.name)) {
        continue;
      }

      const toolboxEntries = tool.toolbox;

      if (!toolboxEntries) {
        continue;
      }

      const entries = Array.isArray(toolboxEntries) ? toolboxEntries : [toolboxEntries];

      for (const entry of entries) {
        const entryName = entry.name ?? tool.name;

        this.popover?.toggleItemHiddenByName(entryName, isHidden);
      }
    }
  }

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
      const resolvedTitleKey = titleKey?.includes('.') ? titleKey : `toolNames.${titleKey}`;
      const englishTitleKey = titleKey ? resolvedTitleKey : undefined;
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

    const currentBlockParentId: string | null = currentBlock.parentId ?? null;

    /**
     * Check if the block contains only slash search text (e.g., "/head").
     * If so, treat it as empty and replace it with the new block.
     *
     * When opened without slash (via plus button), any text in the block
     * is a search query, not user content — always replace.
     */
    const shouldReplaceBlock = currentBlock.isEmpty
      || this.isBlockSlashSearchOnly(currentBlock.holder)
      || !this.openedWithSlash;

    /**
     * On mobile version, we see the Plus Button even near non-empty blocks,
     * so if current block is not empty, add the new block below the current
     */
    const index = shouldReplaceBlock ? currentBlockIndex : currentBlockIndex + 1;

    const hasBlockDataOverrides = blockDataOverrides !== undefined && Object.keys(blockDataOverrides).length > 0;

    const blockData: BlockToolData | undefined = hasBlockDataOverrides
      ? Object.assign(await this.api.blocks.composeBlockData(toolName), blockDataOverrides)
      : undefined;

    /**
     * When replacing a child block (e.g. inside a toggle), the parent-clear,
     * insert, and parent-restore must be a single undo entry. Wrap them in
     * a transaction so undo/redo treats the conversion atomically.
     */
    const performInsert = (): BlockAPI => {
      if (shouldReplaceBlock && currentBlockParentId !== null) {
        this.api.blocks.setBlockParent(currentBlock.id, null);
      }

      const inserted = this.api.blocks.insert(
        toolName,
        blockData,
        undefined,
        index,
        undefined,
        shouldReplaceBlock
      );

      if (currentBlockParentId !== null) {
        this.api.blocks.setBlockParent(inserted.id, currentBlockParentId);
      }

      return inserted;
    };

    const newBlock = this.insertWithTransaction(performInsert, currentBlockParentId);

    this.api.caret.setToBlock(index);

    this.emit(ToolboxEvent.BlockAdded, {
      block: newBlock,
    });

    /**
     * close toolbar when node is changed
     * Pass setExplicitlyClosed: false so the toolbar can show again on hover after toolbox insertion
     */
    this.api.toolbar.close({ setExplicitlyClosed: false });
  }

  /**
   * Runs a block-insert callback inside a transaction when the block has a parent,
   * so that parent-clear + insert + parent-restore form a single undo entry.
   * When there is no parent (or transact is unavailable), runs the callback directly.
   *
   * @param fn - synchronous callback that performs the insert and returns the new BlockAPI
   * @param parentId - the current block's parentId, or null if none
   * @returns the BlockAPI returned by fn
   */
  private insertWithTransaction(fn: () => BlockAPI, parentId: string | null): BlockAPI {
    const result: { block: BlockAPI | undefined } = { block: undefined };

    if (parentId !== null && this.api.blocks.transact !== undefined) {
      this.api.blocks.transact(() => {
        result.block = fn();
      });
    } else {
      result.block = fn();
    }

    return result.block as BlockAPI;
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

    const activeEl = document.activeElement;

    this.currentContentEditable = activeEl instanceof HTMLElement && activeEl.isContentEditable && this.currentBlockForSearch.contains(activeEl)
      ? activeEl
      : this.currentBlockForSearch.querySelector('[contenteditable="true"]');

    if (this.currentContentEditable instanceof HTMLElement) {
      this.currentContentEditable.setAttribute(DATA_ATTR.slashSearch, this.i18nLabels.slashSearchPlaceholder);
    }
    this.listeners.on(this.currentBlockForSearch, 'input', this.handleBlockInput);
  }

  /**
   * Stops listening to block input events and resets the filter.
   */
  private stopListeningToBlockInput(): void {
    if (this.currentBlockForSearch !== null) {
      this.listeners.off(this.currentBlockForSearch, 'input', this.handleBlockInput);
      if (this.currentContentEditable instanceof HTMLElement) {
        this.currentContentEditable.removeAttribute(DATA_ATTR.slashSearch);
      }
      this.currentBlockForSearch = null;
      this.currentContentEditable = null;
    }

    this.popover?.filterItems('');
  }

  /**
   * Handles input events on the block to filter the toolbox.
   *
   * In slash mode (default): extracts text after "/" and filters by it.
   * Closes if "/" is removed.
   *
   * In no-slash mode (opened via plus button): uses full block text as the
   * filter query and does not close on missing "/".
   */
  private handleBlockInput = (): void => {
    if (this.currentContentEditable === null) {
      return;
    }

    const text = this.currentContentEditable.textContent || '';

    if (this.openedWithSlash) {
      const slashIndex = text.lastIndexOf('/');

      if (slashIndex === -1) {
        this.close();

        return;
      }
    }

    const query = this.openedWithSlash ? text.slice(text.lastIndexOf('/') + 1) : text;

    if (this.currentContentEditable instanceof HTMLElement) {
      this.currentContentEditable.setAttribute(
        DATA_ATTR.slashSearch,
        query.length === 0 ? this.i18nLabels.slashSearchPlaceholder : ''
      );
    }

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
