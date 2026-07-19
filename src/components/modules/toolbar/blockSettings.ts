import type { MenuConfigItem } from '../../../../types/tools';
import type { BlockTuneRenderContext } from '../../../../types/block-tunes/block-tune';
import { Module } from '../../__module';
import type { Block } from '../../block';
import { BlockAPI } from '../../block/api';
import { Dom as $ } from '../../dom';
import { BlockSettingsClosed, BlockSettingsOpened, BlokMobileLayoutToggled } from '../../events';
import { Flipper } from '../../flipper';
import { IconColumns, IconCopy, IconReplace, IconTrash } from '../../icons';
import { wrapBlocksInColumns } from '../../../tools/column-drop';
import { SelectionUtils } from '../../selection/index';
import { ScrollLocker } from '../../utils/scroll-locker';
import type { BlockToolAdapter } from '../../tools/block';
import { isMobileScreen, keyCodes } from '../../utils';
import { beautifyShortcut } from '../../utils/string';
import { getCaretOffset } from '../../utils/caret/selection';
import { findCommonNestedContainer, scheduleCaretIntoNestedContainer } from '../../utils/nested-container-caret';
import { getConvertibleToolsForBlock, getConvertibleToolsForBlocks } from '../../utils/blocks';
import { buildConvertMenuEntries } from '../../utils/convert-menu';
import type { PopoverItemParams, Popover } from '../../utils/popover';
import { PopoverDesktop, PopoverMobile, PopoverItemType } from '../../utils/popover';
import { css as popoverItemCls } from '../../utils/popover/components/popover-item';
import { isToolConvertable, translateToolName, translateToolTitle } from '../../utils/tools';

import type { PopoverParams } from '@/types/utils/popover/popover';
import { PopoverEvent } from '@/types/utils/popover/popover-event';


/**
 * Stable id applied to the block-settings popover element on open.
 * Referenced by the settings toggler's `aria-controls` (wired in Toolbar.make())
 * so assistive tech knows which menu the toggler expands.
 */
export const SETTINGS_POPOVER_ID = 'blok-block-settings-popover';

/**
 * HTML Elements that used for BlockSettings
 */
interface BlockSettingsNodes {
  /**
   * Block Settings wrapper. Undefined when before "make" method called
   */
  wrapper: HTMLElement | undefined;
  /**
   * Index signature to satisfy ModuleNodes constraint
   */
  [key: string]: unknown;
}

/**
 * Block Settings
 *  @todo Make Block Settings no-module but a standalone class, like Toolbox
 */
export class BlockSettings extends Module<BlockSettingsNodes> {
  /**
   * Module Events
   */
  public get events(): { opened: typeof BlockSettingsOpened; closed: typeof BlockSettingsClosed } {
    return {
      opened: BlockSettingsOpened,
      closed: BlockSettingsClosed,
    };
  }

  /**
   * Block Settings CSS
   * @deprecated Use data attributes for identification instead
   */
  public get CSS(): { [name: string]: string } {
    return {
      settings: '',
    };
  }

  /**
   * Opened state
   */
  public opened = false;

  /**
   * Flag to track if settings menu is in the process of opening
   * Used to prevent toolbar movement during async menu item creation
   */
  public isOpening = false;

  /**
   * Getter for inner popover's flipper instance
   * @todo remove once BlockSettings becomes standalone non-module class
   */
  public get flipper(): Flipper {
    return this.flipperInstance;
  }

  /**
   * Page selection utils
   */
  private selection: SelectionUtils = new SelectionUtils();

  /**
   * Locks page scroll while the menu is open so the anchored popover cannot
   * drift away from (or over) the content it belongs to
   */
  private scrollLocker = new ScrollLocker();

  /**
   * Popover instance. There is a util for vertical lists.
   * Null until popover is not initialized
   */
  private popover: Popover | null = null;

  /**
   * Shared flipper instance used for keyboard navigation in block settings popover
   */
  private readonly flipperInstance: Flipper = new Flipper({
    focusedItemClass: popoverItemCls.focused,
    allowedKeys: [
      keyCodes.TAB,
      keyCodes.UP,
      keyCodes.DOWN,
      keyCodes.ENTER,
      keyCodes.RIGHT,
      keyCodes.LEFT,
    ],
  });

  /**
   * Stored keydown handler reference to detach when block tunes are closed
   */
  private flipperKeydownHandler: ((event: KeyboardEvent) => void) | null = null;

  /**
   * Element that listens for keydown events while block tunes are opened
   */
  private flipperKeydownSource: HTMLElement | null = null;

  /**
   * Handler for Delete key shortcut, stored for cleanup
   */
  private deleteKeyHandler: ((event: KeyboardEvent) => void) | null = null;

  /**
   * The element (settings toggler) the popover was opened from. Used to return
   * focus to it when the popover is dismissed and focus would otherwise be lost.
   */
  private settingsTrigger: HTMLElement | null = null;

  /**
   * Panel with block settings with 2 sections:
   *  - Tool's Settings
   *  - Default Settings [Move, Remove, etc]
   */
  public make(): void {
    this.nodes.wrapper = $.make('div');
    this.nodes.wrapper.setAttribute('data-blok-testid', 'block-tunes-wrapper');

    this.eventsDispatcher.on(BlokMobileLayoutToggled, this.close);
  }

  /**
   * Destroys module
   */
  public destroy(): void {
    this.scrollLocker.unlock();
    this.detachFlipperKeydownListener();
    this.removeAllNodes();
    this.listeners.destroy();
    this.eventsDispatcher.off(BlokMobileLayoutToggled, this.close);
  }

  /**
   * Open Block Settings pane
   * @param targetBlock - near which Block we should open BlockSettings
   * @param anchor - element to position the popover relative to, OR a virtual
   *   DOMRect (e.g. the cursor position for a right-click context menu, or the
   *   block holder rect for the Shift+F10 keyboard shortcut). A rect is
   *   forwarded to the popover as an explicit `position`, which
   *   {@link PopoverDesktop.calculatePosition} prefers over the trigger.
   * @param options - popover placement overrides
   */
  public async open(
    targetBlock?: Block,
    anchor?: HTMLElement | DOMRect,
    options?: { placeLeftOfAnchor?: boolean }
  ): Promise<void> {
    /**
     * readOnly: { hideControls: true } — no block settings popover at all
     * (covers keyboard shortcut paths; the settings toggler is already gone)
     */
    if (this.Blok.ReadOnly.isControlsHidden) {
      return;
    }

    /**
     * Split the anchor: an element is used as the trigger (and, on dismissal,
     * the focus return target); anything else is a virtual DOMRect that
     * positions the popover at an explicit point. We branch on `HTMLElement`
     * rather than `DOMRect` because a rect from `getBoundingClientRect()` is
     * not always a `DOMRect` instance across environments. When a rect is given
     * there is no trigger element, so the popover falls back to the settings
     * wrapper for mounting.
     */
    const trigger = anchor instanceof HTMLElement ? anchor : undefined;
    const providedAnchorRect = anchor instanceof HTMLElement ? undefined : anchor;

    const selectedBlocks = this.Blok.BlockSelection.selectedBlocks;
    const hasMultipleBlocksSelected = selectedBlocks.length > 1;

    /**
     * When multiple blocks are selected, use the first selected block as the anchor
     * Otherwise, use the target block or current block
     */
    const block = hasMultipleBlocksSelected
      ? selectedBlocks[0]
      : (targetBlock ?? this.Blok.BlockManager.currentBlock);

    if (block === undefined) {
      return;
    }

    /**
     * Set isOpening flag BEFORE async operations to prevent toolbar from moving
     * while menu items are being created. This fixes a bug where hovering over a different
     * block during async getTunesItems() causes the toolbar to reposition incorrectly.
     *
     * Wrapped in try/catch to guarantee isOpening is always reset — if any step
     * (getTunes, getTunesItems, PopoverClass constructor) throws, without cleanup
     * the flag stays true and the toolbar permanently stops appearing on hover.
     */
    this.isOpening = true;

    try {
      /**
       * If block settings contains any inputs, focus will be set there,
       * so we need to save current selection to restore it after block settings is closed
       */
      this.selection.save();

      /**
       * Capture the caret offset within the block BEFORE selectBlock highlights
       * the whole block content (which clears the collapsed caret). Turn-into
       * restores the caret to this offset rather than forcing it to the end.
       */
      const caretOffset = getCaretOffset();

      /**
       * Highlight content of a Block we are working with
       * For multiple blocks, they should already be selected
       */
      if (!hasMultipleBlocksSelected) {
        this.Blok.BlockSelection.selectBlock(block);
        this.Blok.BlockSelection.clearCache();
      }

      /**
       * Expose the (not-yet-created) tune popover element to custom tunes via
       * their render context. The popover is built further down, so the element
       * is filled in after construction; tunes capturing the context resolve it
       * lazily (e.g. when opening a sub-menu) instead of reaching into the DOM.
       */
      const popoverRef: { current: HTMLElement | null } = { current: null };
      const renderContext: BlockTuneRenderContext = {
        getPopoverElement: () => popoverRef.current,
      };

      /** Get tool-specific tunes and common tunes (delete, move, etc.) */
      const { toolTunes, commonTunes } = block.getTunes(renderContext);

      const items = await this.getTunesItems(block, commonTunes, toolTunes, caretOffset);

      /**
       * Without any anchor (keyboard ⌘+/ or API paths), anchor to the block
       * holder rect — same contract as the Shift+F10 context-menu path. The
       * previous fallback (the settings wrapper element) is an empty 0x0 div
       * whose rect collapses to all zeros whenever the toolbar is hidden,
       * which rendered the menu pinned at the viewport's top-left corner.
       */
      const anchorRect = providedAnchorRect
        ?? (trigger === undefined ? block.holder.getBoundingClientRect() : undefined);

      const activeEntry = hasMultipleBlocksSelected
        ? undefined
        : await block.getActiveToolboxEntry();
      const contextLabel = ((): string => {
        if (hasMultipleBlocksSelected) {
          return this.Blok.I18n.t('blockSettings.blocksSelected', { count: selectedBlocks.length });
        }

        if (activeEntry) {
          return translateToolTitle(this.Blok.I18n, activeEntry, block.name);
        }

        return translateToolName(this.Blok.I18n, undefined, block.name);
      })();

      const PopoverClass = isMobileScreen() ? PopoverMobile : PopoverDesktop;
      const popoverBaseParams = {
        searchable: true,
        trigger: trigger || this.nodes.wrapper,
        items,
        messages: {
          nothingFound: this.Blok.I18n.t('popover.nothingFound'),
          search: this.Blok.I18n.t('popover.search'),
          // Plumb the result-count announcement template so the search field
          // announces matches to screen readers (parity with the Toolbox).
          searchResults: this.Blok.I18n.t('a11y.searchResults'),
        },
        autoFocusFirstItem: false,
        minWidth: '220px',
        /**
         * A cursor/holder-anchored menu (context menu, Shift+F10) opens AT the
         * anchor going down/right; the dots-button menu opens to the LEFT of
         * the toggler. Default accordingly when the caller doesn't override.
         */
        placeLeftOfAnchor: options?.placeLeftOfAnchor ?? (anchorRect === undefined),
        viewportMargin: 50,
        contextLabel,
        /**
         * The block holder is the anchor's movement reference. For a trigger
         * (dots button) it backs the hidden-trigger snapshot: the toggler's
         * own ancestors shift when the plus button hides on open, which must
         * not be misread as anchor movement. For a virtual rect it supplies
         * motion deltas through nested scrolling.
         */
        positionContext: block.holder,
      };
      const popoverParams: PopoverParams & { flipper?: Flipper } = anchorRect === undefined
        ? popoverBaseParams
        : {
          ...popoverBaseParams,
          position: anchorRect,
        };

      if (PopoverClass === PopoverDesktop) {
        popoverParams.flipper = this.flipperInstance;
      }

      this.popover = new PopoverClass(popoverParams);
      popoverRef.current = this.popover.getElement();
      popoverRef.current.setAttribute('data-blok-testid', 'block-tunes-popover');
      popoverRef.current.id = SETTINGS_POPOVER_ID;

      /**
       * Remember the trigger (settings toggler) so focus can be returned to it
       * when the popover is dismissed via Escape — keyboard users land back on
       * the control they opened, not on document.body.
       */
      this.settingsTrigger = trigger ?? null;

      this.popover.on(PopoverEvent.Closed, this.onPopoverClose);

      this.attachDeleteKeyListener(items);

      /**
       * Set opened flag AFTER popover is created to prevent race conditions
       * where close() is called during the async getTunesItems() call
       * when opened=true but popover is still null
       */
      this.opened = true;
      this.isOpening = false;

      /**
       * Show the popover BEFORE dispatching the `opened` event.
       *
       * Listeners of that event toggle a data attribute on the UI wrapper
       * (`data-blok-block-settings-opened=true`) whose Tailwind rules restyle
       * the toolbar (the plus button hides; the toggler shows its active
       * state). If we emit first, layout can shift before `show()` measures
       * the trigger. Measure + place the popover while the toolbar is still
       * in its pre-open state, then announce the state change.
       */
      this.popover.show();
      this.scrollLocker.lock();
      this.attachFlipperKeydownListener(block);

      /** Tell to subscribers that block settings is opened */
      this.eventsDispatcher.emit(this.events.opened);
    } catch {
      this.isOpening = false;
    }
  }

  /**
   * Returns root block settings element
   */
  public getElement(): HTMLElement | undefined {
    return this.nodes.wrapper;
  }

  /**
   * Checks if the element is contained in the BlockSettings or its Popover
   * @param element - element to check
   */
  public contains(element: HTMLElement): boolean {
    if (this.nodes.wrapper?.contains(element)) {
      return true;
    }

    if (this.popover?.hasNode(element)) {
      return true;
    }

    return false;
  }

  /**
   * Close Block Settings pane
   */
  public close = (): void => {
    if (!this.opened) {
      return;
    }

    this.opened = false;
    this.isOpening = false; // Clear isOpening flag when closing
    this.scrollLocker.unlock();

    /**
     * If selection is at blok on Block Settings closing,
     * it means that caret placed at some editable element inside the Block Settings.
     * Previously we have saved the selection, then open the Block Settings and set caret to the input
     *
     * So, we need to restore selection back to Block after closing the Block Settings
     */
    if (!SelectionUtils.isAtBlok) {
      this.selection.restore();
    }

    this.selection.clearSaved();
    this.detachDeleteKeyListener();
    this.detachFlipperKeydownListener();

    /**
     * Remove highlighted content of Blocks we are working with
     * Handle both single and multiple block selection
     */
    this.clearBlockSelectionOnClose();

    /** Tell to subscribers that block settings is closed */
    this.eventsDispatcher.emit(this.events.closed);

    if (this.popover) {
      this.popover.off(PopoverEvent.Closed, this.onPopoverClose);
      this.popover.destroy();
      this.popover.getElement().remove();
      this.popover = null;
    }
  };

  /**
   * Returns list of items to be displayed in block tunes menu.
   * Merges conversion menu, tool-specific tunes, and common tunes in one list in predefined order
   * @param currentBlock –  block we are about to open block tunes for
   * @param commonTunes – common tunes
   * @param toolTunes – tool-specific tunes from renderSettings()
   * @param caretOffset – caret offset captured before the block was highlighted, restored after a turn-into conversion
   */
  private async getTunesItems(currentBlock: Block, commonTunes: MenuConfigItem[], toolTunes?: MenuConfigItem[], caretOffset = 0): Promise<PopoverItemParams[]> {
    const items = [] as MenuConfigItem[];
    const selectedBlocks = this.Blok.BlockSelection.selectedBlocks;
    const hasMultipleBlocksSelected = selectedBlocks.length > 1;
    const isReadOnly = this.Blok.ReadOnly.isEnabled;

    const allBlockTools = Array.from(this.Blok.Tools.blockTools.values());

    /**
     * Read-only (Notion-style): expose only the copy-link tune, plus the
     * edit-metadata footer if present. No convert-to, no delete, no moves,
     * no tool-specific tunes.
     */
    if (isReadOnly) {
      const copyLinkItems = commonTunes.filter(
        (tune): tune is MenuConfigItem & { name: string } => 'name' in tune && tune.name === 'copy-link'
      );

      items.push(...copyLinkItems);

      if (currentBlock.lastEditedAt !== undefined) {
        items.push({ type: PopoverItemType.Separator });
        items.push({
          type: PopoverItemType.Html,
          element: this.createEditMetadataFooter(currentBlock),
          name: 'edit-metadata',
        });
      }

      return items;
    }

    /**
     * Tool-specific tunes come first (e.g. heading level selector)
     */
    if (!hasMultipleBlocksSelected && toolTunes !== undefined && toolTunes.length > 0) {
      items.push(...toolTunes);
      items.push({
        type: PopoverItemType.Separator,
      });
    }

    /**
     * Get convertible tools based on selection:
     * - For single block: use existing single-block conversion logic
     * - For multiple blocks: find tools that ALL selected blocks can convert to
     */
    const convertibleTools = hasMultipleBlocksSelected
      ? await getConvertibleToolsForBlocks(
          selectedBlocks.map((block) => new BlockAPI(block)),
          allBlockTools
        )
      : await getConvertibleToolsForBlock(new BlockAPI(currentBlock), allBlockTools);

    const convertToItems = buildConvertMenuEntries(convertibleTools, this.Blok.I18n)
      .map<PopoverItemParams>((entry) => ({
        icon: entry.icon,
        title: entry.title,
        name: entry.name,
        englishTitle: entry.englishTitle,
        searchTerms: entry.searchTerms,
        closeOnActivate: true,
        onActivate: async () => {
          const { Caret, Toolbar } = this.Blok;

          // The builder returns a tool NAME; convertBlock needs the adapter.
          const tool = convertibleTools.find((candidate) => candidate.name === entry.toolName);

          if (tool === undefined) {
            return;
          }

          // Convert immediately — no blocking confirm() prompt. A child-bearing
          // block's children are outdented to its original parent (see
          // BlockOperations.replace), matching Notion's instant "Turn into".
          const newBlock = await this.convertBlock(
            currentBlock,
            selectedBlocks,
            hasMultipleBlocksSelected,
            tool,
            entry.data
          );

          Toolbar.close();

          if (newBlock) {
            /**
             * Multi-block conversions have no single caret to preserve, so
             * land at the end; a single-block turn-into keeps its prior offset.
             */
            if (hasMultipleBlocksSelected) {
              Caret.setToBlock(newBlock, Caret.positions.END);
            } else {
              Caret.setToBlock(newBlock, Caret.positions.DEFAULT, caretOffset);
            }
          }
        },
      }));

    /**
     * For a multi-block selection, "Turn into columns" belongs in the same
     * "Convert to" submenu as the other tool conversions. The selected ids are
     * captured HERE, at build time — reading BlockSelection.selectedBlocks
     * inside onActivate returns an empty list, because the document mousedown
     * that fires when the popover item is clicked clears the block selection
     * before onActivate runs.
     */
    if (hasMultipleBlocksSelected) {
      const selectedBlockIds = selectedBlocks.map((selected) => selected.id);

      convertToItems.push({
        icon: IconColumns,
        title: this.Blok.I18n.t('toolNames.columns'),
        name: 'turn-into-columns',
        closeOnActivate: true,
        onActivate: () => {
          const { Caret, Toolbar, BlockManager } = this.Blok;
          const api = this.Blok.API.methods;

          const listId = wrapBlocksInColumns(api, selectedBlockIds);

          if (listId === null) {
            Toolbar.close();

            return;
          }

          const firstColumn = api.blocks.getChildren(listId)[0];
          const firstChild = firstColumn !== undefined
            ? api.blocks.getChildren(firstColumn.id)[0]
            : undefined;
          const block = firstChild !== undefined
            ? BlockManager.getBlockById(firstChild.id)
            : undefined;

          if (block !== undefined) {
            Caret.setToBlock(block, Caret.positions.START);
          }

          Toolbar.close();
        },
      });
    }

    if (convertToItems.length > 0) {
      items.push({
        icon: IconReplace,
        name: 'convert-to',
        title: this.Blok.I18n.t('popover.convertTo'),
        children: {
          items: convertToItems,
          minWidth: '200px',
        },
      });
      items.push({
        type: PopoverItemType.Separator,
      });
    }

    /**
     * Explicit "Duplicate" item (Notion parity) — sits beside delete and runs
     * the SAME pipeline as Cmd/Ctrl+D (DragManager.duplicateBlocksInPlace), so
     * nested children/colors/flat-indent followers are carried into the copy.
     *
     * The target blocks are captured HERE, at build time: the document mousedown
     * that fires when the popover item is clicked clears the block selection
     * before onActivate runs (same caveat as "turn-into-columns" above). For a
     * multi-block selection we re-select the captured blocks so the whole group
     * is duplicated; for a single block we duplicate the menu's own block.
     */
    const duplicateSelected = hasMultipleBlocksSelected ? [...selectedBlocks] : [];
    const duplicateItem: MenuConfigItem = {
      icon: IconCopy,
      title: this.Blok.I18n.t('blockSettings.duplicate'),
      name: 'duplicate',
      secondaryLabel: beautifyShortcut('CMD+D'),
      closeOnActivate: true,
      onActivate: () => {
        const { BlockSelection, DragManager, Toolbar } = this.Blok;

        if (duplicateSelected.length > 1) {
          BlockSelection.clearSelection();
          duplicateSelected.forEach((selected) => BlockSelection.selectBlock(selected));
        }

        void DragManager?.duplicateBlocksInPlace(currentBlock);

        Toolbar.close();
      },
    };

    /**
     * For single block selection, show common tunes (delete, move, etc.).
     * Duplicate sits directly before the delete entry so it reads "Duplicate /
     * Delete" like Notion (and delete stays the trailing action). When there is
     * no delete entry (nothing to sit beside) the duplicate is omitted.
     * For multiple blocks, show Duplicate + a multi-block delete.
     */
    if (!hasMultipleBlocksSelected) {
      const deleteIndex = commonTunes.findIndex(
        (tune) => 'name' in tune && tune.name === 'delete'
      );

      if (deleteIndex === -1) {
        items.push(...commonTunes);
      } else {
        items.push(...commonTunes.slice(0, deleteIndex), duplicateItem, ...commonTunes.slice(deleteIndex));
      }
    } else {
      items.push(duplicateItem);
      items.push({
        icon: IconTrash,
        title: this.Blok.I18n.t('blockSettings.delete'),
        name: 'delete',
        isDestructive: true,
        secondaryLabel: beautifyShortcut('DELETE'),
        closeOnActivate: true,
        onActivate: () => {
          const { BlockManager, Caret, Toolbar } = this.Blok;

          const nestedContainer = findCommonNestedContainer(BlockManager.blocks.filter((block) => block.selected));

          const insertedBlock = BlockManager.deleteSelectedBlocksAndInsertReplacement();

          if (insertedBlock) {
            Caret.setToBlock(insertedBlock, Caret.positions.END);
          } else {
            /**
             * A partial multi-block delete inserts no replacement and sets no
             * caret. When the deleted blocks all lived in one nested-blocks
             * container (e.g. a table cell), restore the caret there so focus
             * does not fall to <body>.
             */
            scheduleCaretIntoNestedContainer(nestedContainer, {
              getBlock: (holder) => BlockManager.getBlock(holder),
              setCaretToBlockStart: (block) => Caret.setToBlock(block, Caret.positions.START),
            });
          }

          Toolbar.close();
        },
      });
    }

    if (currentBlock.lastEditedAt !== undefined) {
      items.push({
        type: PopoverItemType.Separator,
      });
      items.push({
        type: PopoverItemType.Html,
        element: this.createEditMetadataFooter(currentBlock),
        name: 'edit-metadata',
      });
    }

    return items;
  }

  /**
   * Creates the "Last edited" footer element for block settings.
   * If a resolveUser callback is configured, resolves the user ID to a display name.
   * @param block - the block whose metadata to display
   * @returns the footer DOM element
   */
  private createEditMetadataFooter(block: Block): HTMLElement {
    const container = document.createElement('div');

    container.classList.add(
      'px-3', 'py-2', 'text-xs', 'leading-snug',
      'text-[color:var(--popover-text-secondary,_#888)]',
      'select-none'
    );

    const label = document.createElement('div');

    label.setAttribute('data-edit-meta-label', '');

    label.textContent = this.Blok.I18n.t('blockSettings.lastEdited');

    if (block.lastEditedBy != null && this.config.resolveUser != null) {
      void Promise.resolve(this.config.resolveUser(block.lastEditedBy)).then((userInfo) => {
        if (userInfo?.name != null) {
          label.textContent = this.Blok.I18n.t('blockSettings.lastEditedBy', { name: userInfo.name });
        }
      });
    }

    container.appendChild(label);

    if (block.lastEditedAt !== undefined) {
      const dateEl = document.createElement('div');

      dateEl.classList.add('mt-1');
      const locale = this.Blok.I18n.getLocale();
      const date = new Date(block.lastEditedAt);

      const dateParts = new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).formatToParts(date);

      /**
       * Strip trailing literal parts that are abbreviations (contain a period),
       * e.g. " г." in Russian or " р." in Ukrainian, while preserving essential
       * trailing literals like "日" in Japanese/Chinese.
       */
      while (dateParts.length > 0
        && dateParts[dateParts.length - 1].type === 'literal'
        && dateParts[dateParts.length - 1].value.includes('.')) {
        dateParts.pop();
      }

      const dateStr = dateParts.map(p => p.value).join('');
      const timeStr = new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(date);

      dateEl.textContent = `${dateStr}, ${timeStr}`;
      container.appendChild(dateEl);
    }

    return container;
  }

  /**
   * Handles popover close event
   */
  private onPopoverClose = (): void => {
    const trigger = this.settingsTrigger;

    this.close();

    /**
     * On dismissal (Escape / click-outside) focus can fall to document.body,
     * stranding keyboard users. Return focus to the settings toggler that
     * opened the menu — but only when focus was actually lost, so we never
     * steal it from a caret an activated item just placed inside a block.
     */
    if (trigger !== null && document.activeElement === document.body) {
      trigger.focus();
    }
  };

  /**
   * Clears block selection when block settings is closed
   * Handles both single and multiple block selection scenarios
   */
  private clearBlockSelectionOnClose(): void {
    if (this.Blok.CrossBlockSelection.isCrossBlockSelectionStarted) {
      return;
    }

    const selectedBlocks = this.Blok.BlockSelection.selectedBlocks;
    const hasMultipleBlocksSelected = selectedBlocks.length > 1;

    if (hasMultipleBlocksSelected) {
      this.Blok.BlockSelection.allBlocksSelected = false;

      return;
    }

    const currentBlock = this.Blok.BlockManager.currentBlock;

    if (currentBlock) {
      this.Blok.BlockSelection.unselectBlock(currentBlock);
    }
  }

  /**
   * Converts multiple selected blocks to a target tool type.
   * For tools that support multi-item data (like lists), all blocks are combined into a single block.
   * Otherwise, each block is converted individually and remains as a separate block.
   * @param blocks - array of blocks to convert
   * @param targetToolName - name of the tool to convert to
   * @param toolboxData - optional data overrides for the new blocks
   * @returns the resulting block (merged or last converted) or null if all conversions failed
   */
  private async convertBlock(
    currentBlock: Block,
    selectedBlocks: Block[],
    hasMultipleBlocksSelected: boolean,
    tool: BlockToolAdapter,
    toolboxData?: Record<string, unknown>
  ): Promise<Block | null> {
    const { BlockManager } = this.Blok;

    if (hasMultipleBlocksSelected) {
      return this.convertMultipleBlocks(selectedBlocks, tool.name, toolboxData);
    }

    /**
     * Check if we should explode a multi-item block (like List) into separate blocks
     * This happens when converting to a tool that doesn't support multiple items
     */
    const explodableItems = await this.getExplodableItems(currentBlock);
    const shouldExplode = !this.canToolMergeMultipleItems(tool) && explodableItems !== null;

    if (shouldExplode) {
      return this.convertMultiItemBlockToSeparateBlocks(currentBlock, tool.name, toolboxData);
    }

    return BlockManager.convert(currentBlock, tool.name, toolboxData);
  }

  /**
   * Converts multiple selected blocks to a target tool type.
   * For tools that support multi-item data (like lists), all blocks are combined into a single block.
   * Otherwise, each block is converted individually and remains as a separate block.
   * @param blocks - array of blocks to convert
   * @param targetToolName - name of the tool to convert to
   * @param toolboxData - optional data overrides for the new blocks
   * @returns the resulting block (merged or last converted) or null if all conversions failed
   */
  private async convertMultipleBlocks(
    blocks: Block[],
    targetToolName: string,
    toolboxData?: Record<string, unknown>
  ): Promise<Block | null> {
    const { Tools } = this.Blok;

    if (blocks.length === 0) {
      return null;
    }

    /**
     * Convert only the "roots" of the selection that can actually convert.
     * Mirrors {@link getConvertibleToolsForBlocks}: a block nested under another
     * selected block (e.g. the contents of a selected column_list) rides with
     * its container and must be left intact, and a non-convertible container
     * block (no «export» rule) is skipped. Without this filter the merge path
     * would pull a columns block's inner paragraphs out into the merged block,
     * tearing the columns apart.
     */
    const selectedIds = new Set(blocks.map((block) => block.id));
    const convertibleBlocks = blocks.filter((block) => {
      if (block.parentId !== null && selectedIds.has(block.parentId)) {
        return false;
      }

      const blockTool = Tools.blockTools.get(block.name);

      return blockTool === undefined || isToolConvertable(blockTool, 'export');
    });

    if (convertibleBlocks.length === 0) {
      return null;
    }

    /**
     * Check if the target tool's conversion config import function can handle
     * newline-separated content to create multiple items (like lists do).
     * We detect this by checking if the import function returns data with an 'items' array.
     */
    const targetTool = Tools.blockTools.get(targetToolName);
    const shouldMergeIntoSingleBlock = targetTool && this.canToolMergeMultipleItems(targetTool);

    if (shouldMergeIntoSingleBlock) {
      return this.convertBlocksToSingleMergedBlock(convertibleBlocks, targetToolName, toolboxData);
    }

    /**
     * Convert each block individually, maintaining them as separate blocks
     */
    return this.convertBlocksIndividually(convertibleBlocks, targetToolName, toolboxData);
  }

  /**
   * Checks if a tool can merge multiple items into a single block.
   * This is determined by testing if the tool's import function creates an 'items' array.
   * @param tool - the target tool adapter
   * @returns true if the tool supports merging multiple items
   */
  private canToolMergeMultipleItems(tool: BlockToolAdapter): boolean {
    const conversionConfig = tool.conversionConfig;

    if (!conversionConfig?.import) {
      return false;
    }

    /**
     * Test the import function with a sample multi-line string
     * to see if it creates multiple items
     */
    try {
      const testResult = typeof conversionConfig.import === 'function'
        ? conversionConfig.import('line1\nline2', tool.settings)
        : { [conversionConfig.import]: 'line1\nline2' };

      return Array.isArray(testResult?.items) && testResult.items.length > 1;
    } catch {
      return false;
    }
  }

  /**
   * Converts multiple blocks into a single merged block by combining their exported content.
   * Used for tools like lists that can hold multiple items.
   * @param blocks - blocks to convert and merge
   * @param targetToolName - name of the tool to convert to
   * @param toolboxData - optional data overrides
   * @returns the merged block or null if conversion failed
   */
  private async convertBlocksToSingleMergedBlock(
    blocks: Block[],
    targetToolName: string,
    toolboxData?: Record<string, unknown>
  ): Promise<Block | null> {
    const { BlockManager } = this.Blok;

    /**
     * Export all blocks' content and combine with newlines
     */
    const exportedContents: string[] = [];

    for (const block of blocks) {
      try {
        const content = await block.exportDataAsString();

        exportedContents.push(content);
      } catch {
        // Skip blocks that fail to export
      }
    }

    if (exportedContents.length === 0) {
      return null;
    }

    /**
     * Convert the first block with combined content
     */
    const firstBlock = blocks[0];
    const combinedContent = exportedContents.join('\n');

    /**
     * Get the target tool to use its conversion config
     */
    const targetTool = this.Blok.Tools.blockTools.get(targetToolName);

    if (!targetTool) {
      return null;
    }

    /**
     * Import the combined content using the target tool's conversion config
     */
    const importedData = typeof targetTool.conversionConfig?.import === 'function'
      ? targetTool.conversionConfig.import(combinedContent, targetTool.settings)
      : { [targetTool.conversionConfig?.import as string]: combinedContent };

    const newBlockData = toolboxData
      ? Object.assign(importedData, toolboxData)
      : importedData;

    /**
     * Replace the first block with the new merged block
     */
    const newBlock = BlockManager.replace(firstBlock, targetToolName, newBlockData);

    /**
     * Remove the remaining blocks (they've been merged into the first one)
     */
    const remainingBlocks = blocks.slice(1);

    for (const block of remainingBlocks) {
      await BlockManager.removeBlock(block, false);
    }

    return newBlock;
  }

  /**
   * Converts blocks individually, keeping them as separate blocks.
   * @param blocks - blocks to convert
   * @param targetToolName - name of the tool to convert to
   * @param toolboxData - optional data overrides
   * @returns the last converted block or null if all conversions failed
   */
  private async convertBlocksIndividually(
    blocks: Block[],
    targetToolName: string,
    toolboxData?: Record<string, unknown>
  ): Promise<Block | null> {
    const { BlockManager } = this.Blok;
    const convertedBlocks: Block[] = [];

    for (const block of blocks) {
      const convertedBlock = await this.convertBlockSafely(BlockManager, block, targetToolName, toolboxData);

      if (convertedBlock) {
        convertedBlocks.push(convertedBlock);
      }
    }

    return convertedBlocks.length > 0
      ? convertedBlocks[convertedBlocks.length - 1]
      : null;
  }

  /**
   * Safely converts a single block, catching any errors
   * @param blockManager - the block manager instance
   * @param block - block to convert
   * @param targetToolName - name of the tool to convert to
   * @param toolboxData - optional data overrides
   * @returns the converted block or null if conversion failed
   */
  private async convertBlockSafely(
    blockManager: typeof this.Blok.BlockManager,
    block: Block,
    targetToolName: string,
    toolboxData?: Record<string, unknown>
  ): Promise<Block | null> {
    try {
      return await blockManager.convert(block, targetToolName, toolboxData);
    } catch (e) {
      console.warn(`Failed to convert block ${block.id}:`, e);

      return null;
    }
  }

  /**
   * Checks if a block contains multiple items that should be exploded into separate blocks
   * when converting to a single-item tool.
   * @param block - block to check
   * @returns array of content strings if block should be exploded, null otherwise
   */
  private async getExplodableItems(block: Block): Promise<string[] | null> {
    try {
      const blockData = await block.data;

      /**
       * Check if block has an 'items' array with multiple items (like List tool)
       */
      if (!Array.isArray(blockData?.items) || blockData.items.length <= 1) {
        return null;
      }

      /**
       * Type guard to check if an item is a valid list item with content and nested items
       */
      const isValidListItem = (item: unknown): item is { content?: string; items?: unknown[] } => {
        return typeof item === 'object' && item !== null;
      };

      /**
       * Extract content from each item, handling nested items recursively
       */
      const extractContent = (items: unknown[]): string[] => {
        const contents: string[] = [];

        for (const item of items) {
          if (!isValidListItem(item)) {
            continue;
          }
          if (item.content !== undefined && item.content !== '') {
            contents.push(item.content);
          }
          if (Array.isArray(item.items) && item.items.length > 0) {
            contents.push(...extractContent(item.items));
          }
        }

        return contents;
      };

      return extractContent(blockData.items);
    } catch {
      return null;
    }
  }

  /**
   * Converts a multi-item block (like List) into multiple single-item blocks.
   * Each item becomes a separate block of the target type.
   * @param block - block to convert
   * @param targetToolName - name of the tool to convert to
   * @param toolboxData - optional data overrides
   * @returns the last created block or null if conversion failed
   */
  private async convertMultiItemBlockToSeparateBlocks(
    block: Block,
    targetToolName: string,
    toolboxData?: Record<string, unknown>
  ): Promise<Block | null> {
    const { BlockManager, Tools } = this.Blok;
    const items = await this.getExplodableItems(block);

    if (!items || items.length === 0) {
      return null;
    }

    const targetTool = Tools.blockTools.get(targetToolName);
    const conversionImport = targetTool?.conversionConfig?.import;

    if (!conversionImport) {
      return null;
    }

    const blockIndex = BlockManager.getBlockIndex(block);

    /**
     * Remove the original block first
     */
    await BlockManager.removeBlock(block, false);

    /**
     * Create a new block for each item
     */
    const createdBlocks = items.map((content, index) => {
      /**
       * Import the content using the target tool's conversion config
       */
      const importedData = typeof conversionImport === 'function'
        ? conversionImport(content, targetTool?.settings)
        : { [conversionImport]: content };

      const newBlockData = toolboxData
        ? Object.assign(importedData, toolboxData)
        : importedData;

      return BlockManager.insert({
        tool: targetToolName,
        data: newBlockData,
        index: blockIndex + index,
        needToFocus: false,
      });
    });

    return createdBlocks.length > 0 ? createdBlocks[createdBlocks.length - 1] : null;
  }

  /**
   * Attaches keydown listener to delegate navigation events to the shared flipper
   * @param block - block that owns the currently focused content
   */
  private attachFlipperKeydownListener(block: Block): void {
    this.detachFlipperKeydownListener();

    const pluginsContent = block?.pluginsContent;

    if (!(pluginsContent instanceof HTMLElement)) {
      return;
    }

    this.flipperInstance.setHandleContentEditableTargets(true);

    this.flipperKeydownHandler = (event: KeyboardEvent) => {
      this.flipperInstance.handleExternalKeydown(event);
    };

    pluginsContent.addEventListener('keydown', this.flipperKeydownHandler, true);
    this.flipperKeydownSource = pluginsContent;
  }

  /**
   * Removes keydown listener from the previously active block
   */
  private detachFlipperKeydownListener(): void {
    if (this.flipperKeydownSource !== null && this.flipperKeydownHandler !== null) {
      this.flipperKeydownSource.removeEventListener('keydown', this.flipperKeydownHandler, true);
    }

    this.flipperInstance.setHandleContentEditableTargets(false);

    this.flipperKeydownSource = null;
    this.flipperKeydownHandler = null;
  }

  /**
   * Attaches a keydown listener on the popover element to handle the Delete key shortcut
   * @param items - popover items to search for the delete action
   */
  private attachDeleteKeyListener(items: PopoverItemParams[]): void {
    this.detachDeleteKeyListener();

    if (this.popover === null) {
      return;
    }

    const deleteItem = items.find(
      (item): item is PopoverItemParams & { name: string; onActivate: () => void } =>
        'name' in item && item.name === 'delete' && 'onActivate' in item
    );

    if (deleteItem === undefined) {
      return;
    }

    this.deleteKeyHandler = (event: KeyboardEvent) => {
      if (event.key === 'Delete') {
        event.preventDefault();
        deleteItem.onActivate(deleteItem);
        this.close();
      }
    };

    this.popover.getElement().addEventListener('keydown', this.deleteKeyHandler);
  }

  /**
   * Removes the Delete key shortcut listener from the popover element
   */
  private detachDeleteKeyListener(): void {
    if (this.popover !== null && this.deleteKeyHandler !== null) {
      this.popover.getElement().removeEventListener('keydown', this.deleteKeyHandler);
    }

    this.deleteKeyHandler = null;
  }
}
