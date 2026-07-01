import { getRestrictedTools } from '../../tools/table/table-restrictions';
import { Dom } from '../dom';
import { BlokMobileLayoutToggled } from '../events';
import { SelectionUtils } from '../selection';
import type { BlockToolAdapter } from '../tools/block';
import type { ToolsCollection } from '../tools/collection';
import { beautifyShortcut, capitalize, isMobileScreen } from '../utils';
import { getCaretOffset } from '../utils/caret/selection';
import { EventsDispatcher } from '../utils/events';
import { Listeners } from '../utils/listeners';
import type { Popover } from '../utils/popover';
import { PopoverDesktop, PopoverMobile } from '../utils/popover';
import { Shortcuts } from '../utils/shortcuts';
import { translateToolTitle, type I18nInstance } from '../utils/tools';
import { getBlockColorToolboxEntries, type BlockColorData } from '../shared/block-color';

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
 * Pick the DOMRect used to anchor the toolbox popover.
 * - Slash open with a slash-search pill present: use the pill's own rect so
 *   the popover sits below the pill's visual bottom — the same way plus-button
 *   anchors at the block's bottom. This keeps the popover-to-field gap equal
 *   between plus-search and slash-search.
 * - Slash open without a pill (e.g., nested container where the pill was not
 *   applied): use the caret rect directly.
 * - Plus button (or slash with degenerate caret): build a composite rect from
 *   the block's CONTENT element (horizontal bounds) and the block holder
 *   (vertical bounds). Using the holder's horizontal bounds would snap the
 *   popover to the editor's left viewport edge in layouts where the holder is
 *   wider than the centered content column.
 * @param params - anchor inputs
 * @param params.caretRect - current selection rect, if any
 * @param params.caretRectIsDegenerate - true when the caret rect is {0,0,0,0}
 * @param params.blockRect - the current block holder rect
 * @param params.contentElement - the current block's content element, if any
 * @param params.slashSearchElement - the slash-search pill element, if any
 */
const resolveAnchorRect = (params: {
  caretRect: DOMRect | undefined;
  caretRectIsDegenerate: boolean;
  blockRect: DOMRect | undefined;
  contentElement: HTMLElement | null;
  slashSearchElement: HTMLElement | null;
}): DOMRect | undefined => {
  const { caretRect, caretRectIsDegenerate, blockRect, contentElement, slashSearchElement } = params;

  if (slashSearchElement !== null) {
    const pillRect = slashSearchElement.getBoundingClientRect();

    if (pillRect.width > 0 || pillRect.height > 0) {
      /**
       * Tighten the visual gap below the pill without changing the popover's
       * own offset constant. The popover anchors at rect.bottom + 8; shrinking
       * the anchor height by this inset pulls the popover a few pixels closer
       * to the pill. Affects both slash-search and plus-search (same anchor).
       */
      const PILL_BOTTOM_INSET = 2;

      return new DOMRect(
        pillRect.left,
        pillRect.top,
        pillRect.width,
        Math.max(0, pillRect.height - PILL_BOTTOM_INSET)
      );
    }
  }

  if (caretRect !== undefined && !caretRectIsDegenerate) {
    return caretRect;
  }

  if (blockRect === undefined) {
    return undefined;
  }

  const contentRect = contentElement?.getBoundingClientRect();

  if (contentRect === undefined) {
    return blockRect;
  }

  return new DOMRect(contentRect.left, blockRect.top, contentRect.width, blockRect.height);
};

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
   * Stable id applied to the popover's listbox (items) container so the block's
   * combobox contentEditable can reference it via `aria-controls`.
   */
  private listboxId?: string;

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
   * Plain-text offsets of the most recently typed "/query" within the searched
   * block (slash mode only): `start` is the slash position, `end` is the caret.
   * Tracked on every input so that — when a tool is picked, even via a mouse
   * click that has since moved the caret — the toolbox knows exactly which span
   * to strip and whether any real content remains around it. Null until the
   * first slash-mode input event after opening.
   */
  private slashQuerySpan: { start: number; end: number } | null = null;

  /**
   * Names of the block-color command items appended to the toolbox. Tracked so
   * they can be shown/hidden per-open depending on whether the current block
   * supports block-level color.
   */
  private colorCommandNames: string[] = [];

  /**
   * Toolbox constructor
   * @param options - available parameters
   * @param options.api - Blok API methods
   * @param options.tools - Tools available to check whether some of them should be displayed at the Toolbox or not
   * @param options.i18n - I18n instance for translations
   * @param options.triggerElement - Element relative to which the popover should be positioned
   * @param options.leftAlignElement - Element whose left edge is used for horizontal popover alignment
   */
  constructor({ api, tools, i18nLabels, i18n, triggerElement, leftAlignElement, listboxId }: {
    api: API;
    tools: ToolsCollection<BlockToolAdapter>;
    i18nLabels: Record<ToolboxTextLabelsKeys, string>;
    i18n: I18nInstance;
    triggerElement?: HTMLElement;
    leftAlignElement?: HTMLElement;
    listboxId?: string;
  }) {
    super();

    this.api = api;
    this.tools = tools;
    this.i18nLabels = i18nLabels;
    this.i18n = i18n;
    this.triggerElement = triggerElement;
    this.leftAlignElement = leftAlignElement;
    this.listboxId = listboxId;

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

    /**
     * Block-color commands only make sense for blocks that render block-level
     * color (paragraph, header, …). Show them just for those; hide otherwise.
     */
    this.toggleColorCommandsHidden(!this.blockSupportsBlockColor(currentBlock));

    /**
     * Always anchor the popover to a rect derived from the current context,
     * never from the trigger element (plus button). The trigger rect is fragile:
     * it can be hidden, offscreen, misaligned with the caret in nested containers
     * (table cells, toggles, callouts), or detached from the block when the plus
     * button sits at the block's top edge while the caret is elsewhere.
     *
     * - Slash open ("/"): anchor at the caret rect so the menu appears next to
     *   what the user is typing, in any block type at any nesting depth.
     * - Plus button open: build a composite rect that uses the block's CONTENT
     *   element for horizontal bounds (so the menu aligns with the visible
     *   content column) and the block holder for vertical bounds (so the menu
     *   sits below the block). Using the holder rect for horizontal bounds
     *   snapped the menu to the editor's left viewport edge whenever the holder
     *   was wider than the centered content column.
     *
     * Set the position BEFORE show() so the first paint is already correct —
     * popover.show() reads `params.position` via calculatePosition() and uses
     * it instead of the trigger rect when present.
     */
    /**
     * Attach the slash-search pill styling BEFORE computing the anchor rect so
     * getBoundingClientRect reflects the pill's applied margin/padding — the
     * popover gap is calculated from that rect and must not predate the class
     * application.
     */
    this.startListeningToBlockInput();

    if (this.popover instanceof PopoverDesktop) {
      const blockRect = currentBlock?.holder.getBoundingClientRect();
      const caretRect = withSlash ? SelectionUtils.rect : undefined;
      const caretRectIsDegenerate = caretRect !== undefined
        && caretRect.width === 0
        && caretRect.height === 0
        && caretRect.x === 0
        && caretRect.y === 0;

      const anchorRect = resolveAnchorRect({
        caretRect,
        caretRectIsDegenerate,
        blockRect,
        contentElement: currentBlock?.holder
          .querySelector<HTMLElement>(`[${DATA_ATTR.elementContent}]`) ?? null,
        slashSearchElement: currentBlock?.holder
          .querySelector<HTMLElement>(`[${DATA_ATTR.slashSearch}]`) ?? null,
      });

      if (anchorRect !== undefined) {
        this.popover.updatePosition(anchorRect);
      }
    }

    this.popover?.show();

    this.openedWithSlash = withSlash;
    this.slashQuerySpan = null;
    this.opened = true;
    this.emit(ToolboxEvent.Opened);
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

    /**
     * Only emit Closed event when the toolbox was actually open.
     * This prevents spurious Closed events (and their side-effects such as
     * caret restoration) when close() is called as routine cleanup (e.g.
     * during cross-block selection, block deletion, or toolbar dismissal)
     * even though the toolbox was never shown.
     */
    if (!this.opened) {
      return;
    }

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
      trigger: this.triggerElement || this.nodes.toolbox,
      leftAlignElement: this.leftAlignElement,
      messages: {
        nothingFound: this.i18nLabels.nothingFound,
        search: this.i18nLabels.filter,
        searchResults: this.i18n.t('a11y.searchResults'),
      },
      items: this.toolboxItemsToBeDisplayed,
      handleContentEditableNavigation: true,
      minWidth: '220px',
      // The Toolbox is a searchable combobox surface: render the items as an
      // ARIA listbox (options), not a menu, and give it a stable id so the
      // block's combobox contentEditable can point aria-controls at it.
      listbox: true,
      listboxId: this.listboxId,
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
    /**
     * Only handle the Closed event when the toolbox was actually open.
     * The popover can fire Closed during routine cleanup (e.g. when Toolbar.close()
     * is called unconditionally as part of CBS, block deletion, etc.), even though
     * the toolbox was never shown. Emitting ToolboxEvent.Closed in those cases
     * triggers side-effects (like caret restoration) that break cross-block selection.
     */
    if (!this.opened) {
      return;
    }

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
   * Shows or hides every block-color command item in one pass.
   * @param isHidden - true to hide the color commands, false to show them
   */
  private toggleColorCommandsHidden(isHidden: boolean): void {
    for (const name of this.colorCommandNames) {
      this.popover?.toggleItemHiddenByName(name, isHidden);
    }
  }

  /**
   * Whether the given block renders block-level color, i.e. its tool opts into
   * the color data fields via the shared block-color sanitize config. Used to
   * gate the block-color slash commands so they only appear where they apply.
   * @param block - the block to test (typically the current block)
   */
  private blockSupportsBlockColor(block: BlockAPI | undefined): boolean {
    if (block === undefined) {
      return false;
    }

    return this.toolSupportsBlockColor(this.tools.get(block.name));
  }

  /**
   * Whether a tool opts into block-level color, detected by the color data
   * fields appearing in its sanitize config (spread in via BLOCK_COLOR_SANITIZE).
   * @param tool - tool adapter to test (may be undefined)
   */
  private toolSupportsBlockColor(tool: BlockToolAdapter | undefined): boolean {
    const sanitize = tool?.sanitizeConfig;

    if (sanitize === undefined || sanitize === null) {
      return false;
    }

    return 'textColor' in sanitize || 'backgroundColor' in sanitize;
  }

  /**
   * Recolors the CURRENT block (text or background) in response to a block-color
   * slash command, instead of inserting a new block. The typed "/query" is
   * stripped first so it is not persisted, then the color field is merged into
   * the block's data (undefined clears it), which re-renders with the color
   * applied. The caret is restored and the toolbar closed.
   * @param field - which color field to set
   * @param value - preset name to apply, or undefined to clear it
   */
  private async applyBlockColorCommand(field: keyof BlockColorData, value: string | undefined): Promise<void> {
    const currentBlockIndex = this.api.blocks.getCurrentBlockIndex();
    const currentBlock = this.api.blocks.getBlockByIndex(currentBlockIndex);

    if (!currentBlock) {
      return;
    }

    if (this.openedWithSlash) {
      const contentEditable = currentBlock.holder.querySelector<HTMLElement>('[contenteditable="true"]');

      if (contentEditable !== null) {
        this.stripSlashQuery(contentEditable, this.resolveSlashQuerySpan(contentEditable));
      }
    }

    await this.api.blocks.update(currentBlock.id, { [field]: value });

    this.api.caret.setToBlock(currentBlockIndex);
    this.api.toolbar.close({ setExplicitlyClosed: false });
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

      // Resolve translated search aliases from searchTermKeys
      for (const key of toolboxItem.searchTermKeys ?? []) {
        const fullKey = `searchTerms.${key}`;

        if (this.i18n.has(fullKey)) {
          mergedSearchTerms.push(this.i18n.t(fullKey));
        }
      }

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

    /**
     * Append flat block-color commands ("Red Background", "Orange Text color", …)
     * so the slash menu can recolor the CURRENT block. Unlike tool entries these
     * do not insert a block — their onActivate recolors in place. Only added when
     * a color-capable tool is registered, and only shown when the current block
     * itself supports block color (gated on open).
     */
    const anyToolSupportsColor = Array.from(this.tools.values()).some((tool) => this.toolSupportsBlockColor(tool));

    if (anyToolSupportsColor) {
      const colorEntries = getBlockColorToolboxEntries({
        textColor: this.i18n.t('tools.marker.textColor'),
        background: this.i18n.t('tools.marker.background'),
        default: this.i18n.t('tools.marker.default'),
      });

      this.colorCommandNames = colorEntries.map((entry) => entry.name);

      colorEntries.forEach((entry) => {
        result.push({
          icon: entry.icon,
          title: entry.title,
          name: entry.name,
          onActivate: (): void => {
            void this.applyBlockColorCommand(entry.field, entry.value);
          },
          secondaryLabel: '',
          englishTitle: entry.title,
          searchTerms: entry.searchTerms,
        });
      });
    }

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
            // Preserve the caret offset across the in-place conversion (Notion
            // parity) instead of forcing it to the end of the new block.
            const caretOffset = getCaretOffset();
            const newBlock = await this.api.blocks.convert(currentBlock.id, toolName);

            this.api.caret.setToBlock(newBlock, 'default', caretOffset);

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

    const contentEditable = currentBlock.holder.querySelector<HTMLElement>('[contenteditable="true"]');

    /**
     * The slash query span (slash→caret) the user typed before picking a tool.
     * In slash mode this is the only text that gets removed; everything around
     * it is real block content.
     */
    const slashQuerySpan = this.openedWithSlash && contentEditable !== null
      ? this.resolveSlashQuerySpan(contentEditable)
      : null;

    /**
     * Replace the current block in place only when nothing but the slash query
     * remains. Otherwise (real content sits before and/or after the "/query")
     * the new block is inserted as the next sibling — the current block keeps
     * its content with just the "/query" stripped (Notion parity).
     *
     * When opened without slash (via plus button), any text in the block is a
     * search query, not user content — always replace.
     */
    const blockText = contentEditable?.textContent ?? '';
    const blockHasOnlySlashQuery = slashQuerySpan !== null
      && blockText.charAt(slashQuerySpan.start) === '/'
      && this.removeSpan(blockText, slashQuerySpan).trim() === '';

    /**
     * Whether the user actually typed a "/query" span (a leading "/" with at
     * least one character) somewhere in the block. Distinguishes a real slash
     * command surrounded by content (→ in-place convert) from a non-empty block
     * with no slash query, where there is nothing to fold in.
     */
    const hasTypedSlashQuery = slashQuerySpan !== null
      && slashQuerySpan.end > slashQuerySpan.start
      && blockText.charAt(slashQuerySpan.start) === '/';

    const shouldReplaceBlock = currentBlock.isEmpty
      || !this.openedWithSlash
      || blockHasOnlySlashQuery;

    /**
     * On mobile version, we see the Plus Button even near non-empty blocks,
     * so if current block is not empty, add the new block below the current
     */
    const index = shouldReplaceBlock ? currentBlockIndex : currentBlockIndex + 1;

    /**
     * When inserting after a non-empty block (Notion parity: "/" pressed before,
     * mid- or end-of-text), only the literal "/query" the user typed is removed
     * from the current block — text before AND after it stays. When replacing in
     * place the whole block is discarded, so no stripping is needed there.
     */
    if (!shouldReplaceBlock && contentEditable !== null && slashQuerySpan !== null) {
      this.stripSlashQuery(contentEditable, slashQuerySpan);

      /**
       * Notion parity (M-1): with real content surrounding the "/query", TURN
       * the current block into the chosen tool in place — folding the leading
       * text into it — instead of inserting an empty sibling (which left an
       * orphan paragraph + empty block). The "/query" was just stripped above so
       * it is not carried into the converted data. Tools that cannot accept the
       * current text (no conversionConfig) make convert() throw; those fall
       * through to the insert-sibling path below so the tool is still created.
       */
      const convertedBlock = hasTypedSlashQuery
        ? await this.convertCurrentBlockInPlace(
          currentBlock.id,
          toolName,
          blockDataOverrides,
          slashQuerySpan.start
        )
        : null;

      if (convertedBlock !== null && convertedBlock !== undefined) {
        return;
      }
    }

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
   * Notion-parity in-place "turn into" for a slash command typed after real
   * content (M-1). Converts the block to the chosen tool, keeping its surrounding
   * text, restores the caret where the "/query" was, announces the result so the
   * toolbar clears its cancel context, and closes the toolbar. Returns the
   * converted block, or null when the conversion is not possible — the caller
   * then falls back to inserting a sibling.
   * @param blockId - id of the block to convert
   * @param toolName - target tool name
   * @param blockDataOverrides - predefined data for the target tool (from the toolbox entry)
   * @param caretOffset - plain-text offset to place the caret at after conversion
   */
  private async convertCurrentBlockInPlace(
    blockId: string,
    toolName: string,
    blockDataOverrides: BlockToolData | undefined,
    caretOffset: number
  ): Promise<BlockAPI | null> {
    try {
      const convertedBlock = await this.api.blocks.convert(blockId, toolName, blockDataOverrides);

      this.api.caret.setToBlock(convertedBlock, 'default', caretOffset);

      this.emit(ToolboxEvent.BlockAdded, {
        block: convertedBlock,
      });

      this.api.toolbar.close({ setExplicitlyClosed: false });

      return convertedBlock;
    } catch (_error) {
      return null;
    }
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
      this.applyComboboxRoles(this.currentContentEditable);
      this.setPopoverActiveDescendantHost(this.currentContentEditable);
    }
    this.listeners.on(this.currentBlockForSearch, 'input', this.handleBlockInput);
  }

  /**
   * Exposes the block's focused contentEditable as the ARIA combobox that owns
   * the open Toolbox listbox. The contentEditable keeps DOM focus in both slash
   * and plus-button modes, so aria-activedescendant on it lets screen readers
   * track the highlighted option while the caret stays in the editor.
   * @param host - the block's contentEditable element
   */
  private applyComboboxRoles(host: HTMLElement): void {
    host.setAttribute('role', 'combobox');
    host.setAttribute('aria-expanded', 'true');
    host.setAttribute('aria-autocomplete', 'list');
    host.setAttribute('aria-haspopup', 'listbox');

    if (this.listboxId !== undefined) {
      host.setAttribute('aria-controls', this.listboxId);
    }
  }

  /**
   * Removes the combobox ARIA attributes previously applied to the block's
   * contentEditable so it returns to a plain editor element once the Toolbox closes.
   * @param host - the block's contentEditable element
   */
  private removeComboboxRoles(host: HTMLElement): void {
    host.removeAttribute('role');
    host.removeAttribute('aria-expanded');
    host.removeAttribute('aria-autocomplete');
    host.removeAttribute('aria-haspopup');
    host.removeAttribute('aria-controls');
  }

  /**
   * Forwards the active-descendant host to the popover's flipper when supported
   * (desktop). Mobile popovers do not expose this and are skipped.
   * @param host - focus-owning element, or null to clear
   */
  private setPopoverActiveDescendantHost(host: HTMLElement | null): void {
    if (this.popover !== null && 'setActiveDescendantHost' in this.popover) {
      (this.popover as { setActiveDescendantHost: (h: HTMLElement | null) => void }).setActiveDescendantHost(host);
    }
  }

  /**
   * Stops listening to block input events and resets the filter.
   */
  private stopListeningToBlockInput(): void {
    if (this.currentBlockForSearch !== null) {
      this.listeners.off(this.currentBlockForSearch, 'input', this.handleBlockInput);
      if (this.currentContentEditable instanceof HTMLElement) {
        this.currentContentEditable.removeAttribute(DATA_ATTR.slashSearch);
        this.removeComboboxRoles(this.currentContentEditable);
      }
      this.setPopoverActiveDescendantHost(null);
      this.currentBlockForSearch = null;
      this.currentContentEditable = null;
    }

    this.slashQuerySpan = null;
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

    /**
     * The query is the text between the slash and the CARET — never the text
     * after the caret (Notion parity). When "/" is typed mid-block, everything
     * following the caret is the block's own content and must not pollute the
     * filter. Fall back to the end of the block when no live caret sits inside
     * this element (so behavior is unchanged for end-of-block typing).
     */
    const caretOffset = this.getCaretOffsetWithinSearchBlock(text.length);

    if (this.openedWithSlash) {
      const slashIndex = text.lastIndexOf('/', Math.max(0, caretOffset - 1));

      if (slashIndex === -1) {
        this.close();

        return;
      }

      /**
       * Notion parity: a space typed immediately after "/" cancels the menu and
       * leaves a literal "/ " in the block. Without this the query would become
       * a lone space and the toolbox would stay open filtering by whitespace
       * until the "/" itself is deleted.
       *
       * A contenteditable inserts a non-breaking space ( ) for the trailing
       * space after "/" (a regular trailing space would collapse), so accept
       * either form — otherwise the menu never dismisses.
       */
      const charAfterSlash = text.charAt(slashIndex + 1);

      if (charAfterSlash === ' ' || charAfterSlash === ' ') {
        this.close();

        return;
      }

      // Remember the slash→caret span so a later tool pick strips exactly this
      // range (and can tell whether any real content surrounds it).
      this.slashQuerySpan = { start: slashIndex, end: caretOffset };
    }

    const query = this.openedWithSlash
      ? text.slice(text.lastIndexOf('/', Math.max(0, caretOffset - 1)) + 1, caretOffset)
      : text;

    if (this.currentContentEditable instanceof HTMLElement) {
      this.currentContentEditable.setAttribute(
        DATA_ATTR.slashSearch,
        query.length === 0 ? this.i18nLabels.slashSearchPlaceholder : ''
      );
    }

    this.popover?.filterItems(query);
  };

  /**
   * Plain-text offset of the caret within the block being searched. Returns the
   * given fallback (typically the block's text length, i.e. "caret at end") when
   * the live selection is not collapsed inside the searched contentEditable —
   * keeping end-of-block typing behavior unchanged while letting mid-block "/"
   * bound its query at the caret.
   * @param fallback - offset to use when no caret sits inside the search block
   */
  private getCaretOffsetWithinSearchBlock(fallback: number): number {
    if (!(this.currentContentEditable instanceof HTMLElement)) {
      return fallback;
    }

    const selection = window.getSelection();

    if (selection === null || selection.rangeCount === 0) {
      return fallback;
    }

    const { startContainer } = selection.getRangeAt(0);

    if (!this.currentContentEditable.contains(startContainer)) {
      return fallback;
    }

    return getCaretOffset(this.currentContentEditable);
  }

  /**
   * Resolves the plain-text span (slash→caret) of the "/query" the user typed
   * in the current block. Prefers the span tracked on the last input event (so
   * a tool picked by mouse click — which has since moved the caret — still maps
   * to the right range). Falls back to the live caret, then to the last "/" and
   * end-of-text, so behavior is unchanged for end-of-block slash typing.
   * @param contentEditable - the current block's contentEditable element
   * @returns the slash-query span as plain-text offsets
   */
  private resolveSlashQuerySpan(contentEditable: HTMLElement): { start: number; end: number } {
    if (this.slashQuerySpan !== null) {
      return this.slashQuerySpan;
    }

    const text = contentEditable.textContent ?? '';
    const end = this.getCaretOffsetWithinSearchBlock(text.length);
    const start = text.lastIndexOf('/', Math.max(0, end - 1));

    return { start: start === -1 ? text.length : start,
      end };
  }

  /**
   * Returns `text` with the given plain-text [start, end) span removed.
   * @param text - source text
   * @param span - span to remove
   */
  private removeSpan(text: string, span: { start: number; end: number }): string {
    return text.slice(0, span.start) + text.slice(span.end);
  }

  /**
   * Removes the "/query" the user typed — exactly the plain-text [start, end)
   * span — from the current block's contentEditable, leaving any text BEFORE the
   * slash and AFTER the caret untouched. Used when the toolbox inserts a NEW
   * block after a non-empty block, so the literal slash command is not left
   * behind (Notion parity) and no surrounding content is lost.
   * @param contentEditable - the block's contentEditable element
   * @param span - plain-text offsets of the slash query to remove
   */
  private stripSlashQuery(contentEditable: HTMLElement, span: { start: number; end: number }): void {
    if (span.end - span.start <= 0) {
      return;
    }

    // Walk text nodes in document order, tracking each node's plain-text offset
    // and the characters left to remove, deleting the portion overlapping
    // [start, end). Threading the running totals through reduce keeps them
    // immutable while removing emptied nodes without disturbing the walk.
    this.collectTextNodes(contentEditable).reduce(
      ({ offset, charsToRemove }, textNode) => {
        const length = textNode.data.length;
        const nodeStart = offset;
        const nodeEnd = offset + length;

        if (charsToRemove <= 0 || nodeEnd <= span.start || nodeStart >= span.end) {
          return { offset: nodeEnd, charsToRemove };
        }

        const from = Math.max(0, span.start - nodeStart);
        const to = Math.min(length, span.end - nodeStart);
        const count = to - from;

        if (from === 0 && to === length) {
          textNode.remove();
        } else {
          textNode.deleteData(from, count);
        }

        return { offset: nodeEnd, charsToRemove: charsToRemove - count };
      },
      { offset: 0, charsToRemove: span.end - span.start }
    );
  }

  /**
   * Collects all descendant text nodes of a node in document order.
   * @param node - the root node to walk
   * @returns text nodes in order
   */
  private collectTextNodes(node: Node): Text[] {
    if (node.nodeType === Node.TEXT_NODE) {
      return [node as Text];
    }

    return Array.from(node.childNodes).flatMap((child) => this.collectTextNodes(child));
  }
}
