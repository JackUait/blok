import type { ToolbarCloseOptions } from '../../../../types/api/toolbar';
import type { ModuleConfig } from '../../../types-internal/module-config';
import { Module } from '../../__module';
import { Block } from '../../block';
import { DATA_ATTR } from '../../constants';
import { Dom as $ } from '../../dom';
import type { BlockChangedPayload } from '../../events/BlockChanged';
import { BlockChanged } from '../../events/BlockChanged';
import { BlockHovered } from '../../events/BlockHovered';
import { BlockSettingsClosed } from '../../events/BlockSettingsClosed';
import { BlockSettingsOpened } from '../../events/BlockSettingsOpened';
import { Toolbox, ToolboxEvent } from '../../ui/toolbox';
import { getUserOS, isMobileScreen, log } from '../../utils';
import { hide } from '../../utils/tooltip';

/**
 * Refactored Toolbar module components
 */
import { ClickDragHandler } from './click-handler';
import { PlusButtonHandler } from './plus-button';
import { ToolbarPositioner } from './positioning';
import { SettingsTogglerHandler } from './settings-toggler';
import { getToolbarStyles } from './styles';
import type { ToolbarNodes } from './types';

/**
 *
 *«Toolbar» is the node that moves up/down over current block
 *
 *______________________________________ Toolbar ____________________________________________
 *|                                                                                           |
 *|  ..................... Content .........................................................  |
 *|  .                                                   ........ Block Actions ...........   |
 *|  .                                                   .        [Open Settings]         .   |
 *|  .  [Plus Button]  [Toolbox: {Tool1}, {Tool2}]       .                                .   |
 *|  .                                                   .        [Settings Panel]        .   |
 *|  .                                                   ..................................   |
 *|  .......................................................................................  |
 *|                                                                                           |
 *|___________________________________________________________________________________________|
 *
 *
 *Toolbox — its an Element contains tools buttons. Can be shown by Plus Button.
 *
 *_______________ Toolbox _______________
 *|                                       |
 *| [Header] [Image] [List] [Quote] ...   |
 *|_______________________________________|
 *
 *
 *Settings Panel — is an Element with block settings:
 *
 *____ Settings Panel ____
 *| ...................... |
 *| .   Tool Settings    . |
 *| ...................... |
 *| .  Default Settings  . |
 *| ...................... |
 *|________________________|
 * @class
 * @classdesc Toolbar module
 */
/**
 * @property {object} nodes - Toolbar nodes
 * @property {Element} nodes.wrapper        - Toolbar main element
 * @property {Element} nodes.content        - Zone with Plus button and toolbox.
 * @property {Element} nodes.actions        - Zone with Block Settings and Remove Button
 * @property {Element} nodes.blockActionsButtons   - Zone with Block Buttons: [Settings]
 * @property {Element} nodes.plusButton     - Button that opens or closes Toolbox
 * @property {Element} nodes.toolbox        - Container for tools
 * @property {Element} nodes.settingsToggler - open/close Settings Panel button
 * @property {Element} nodes.settings          - Settings Panel
 * @property {Element} nodes.pluginSettings    - Plugin Settings section of Settings Panel
 * @property {Element} nodes.defaultSettings   - Default Settings section of Settings Panel
 */
export class Toolbar extends Module<ToolbarNodes> {
  /**
   * Block near which we display the Toolbox
   */
  private hoveredBlock: Block | null = null;

  /**
   * Flag to track if toolbar was explicitly closed (e.g., after block deletion).
   * This prevents the toolbar from reopening on subsequent block-hovered events.
   */
  private explicitlyClosed: boolean = false;

  /**
   * Flag to track if the current hovered block was resolved from a table cell block.
   * When true, the toolbar suppresses plus button, settings toggler, and
   * prevents overriding the current block when the toolbox opens.
   */
  private hoveredBlockIsFromTableCell: boolean = false;

  /**
   * Toolbox class instance
   * It will be created in requestIdleCallback so it can be null in some period of time
   */
  private toolboxInstance: Toolbox | null = null;

  /**
   * Toolbar positioner instance
   */
  private positioner: ToolbarPositioner;

  /**
   * Click-vs-drag handler instance
   */
  private clickDragHandler: ClickDragHandler;

  /**
   * Plus button handler instance
   */
  private plusButtonHandler: PlusButtonHandler;

  /**
   * Settings toggler handler instance
   */
  private settingsTogglerHandler: SettingsTogglerHandler;

  /**
   * The block that had focus immediately before the plus button opened the toolbox.
   * Captured via the onFocusBlockCaptured callback in PlusButtonHandler.handleClick(),
   * before any block manipulation occurs.
   * Used to restore focus if the user dismisses the toolbox without selecting a tool.
   * Cleared when a tool is selected (ToolboxEvent.BlockAdded) or when focus is restored.
   */
  private preToolboxBlock: Block | null = null;

  /**
   * A newly-inserted empty block created by the plus button click (not a reused block).
   * If the user dismisses the toolbox without selecting a tool, this block is removed.
   * Cleared when a tool is selected or when the block is removed on cancel.
   */
  private plusInsertedBlock: Block | null = null;

  /**
   * @class
   * @param moduleConfiguration - Module Configuration
   * @param moduleConfiguration.config - Blok's config
   * @param moduleConfiguration.eventsDispatcher - Blok's event dispatcher
   */
  constructor({ config, eventsDispatcher }: ModuleConfig) {
    super({
      config,
      eventsDispatcher,
    });
    this.positioner = new ToolbarPositioner();
    this.clickDragHandler = new ClickDragHandler();

    /**
     * Initialize handlers with callbacks to toolbar methods
     */
    this.plusButtonHandler = new PlusButtonHandler(
      () => this.Blok,
      {
        getToolboxOpened: () => this.toolbox.opened ?? false,
        openToolbox: () => this.toolbox.open(),
        openToolboxWithoutSlash: () => this.toolbox.openWithoutSlash(),
        closeToolbox: () => this.toolbox.close(),
        moveAndOpenToolbar: (block, target) => this.moveAndOpen(block, target),
        onFocusBlockCaptured: (block, insertedBlock) => {
          this.preToolboxBlock = block;
          this.plusInsertedBlock = insertedBlock;
        },
      }
    );

    this.settingsTogglerHandler = new SettingsTogglerHandler(
      () => this.Blok,
      this.clickDragHandler,
      {
        setHoveredBlock: (block) => { this.hoveredBlock = block; },
        getToolboxOpened: () => this.toolbox.opened ?? false,
        closeToolbox: () => this.toolbox.close(),
      }
    );
  }

  /**
   * CSS styles
   * @returns {object}
   * @deprecated Use data attributes via constants instead
   */
  public get CSS(): { [name: string]: string } {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- CSS getter is deprecated but still used internally
    return getToolbarStyles();
  }

  /**
   * Returns the Toolbar opening state
   * @returns {boolean}
   */
  public get opened(): boolean {
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    return this.nodes.wrapper?.classList.contains(this.CSS.toolbarOpened) ?? false;
  }

  /**
   * Check if the element is contained in the Toolbar or its components (Toolbox, BlockSettings)
   * @param element - element to check
   */
  public contains(element: HTMLElement): boolean {
    if (this.nodes.wrapper?.contains(element)) {
      return true;
    }

    if (this.toolboxInstance?.contains(element)) {
      return true;
    }

    if (this.Blok.BlockSettings.contains(element)) {
      return true;
    }

    return false;
  }

  /**
   * Public interface for accessing the Toolbox
   */
  public get toolbox(): {
    opened: boolean | undefined; // undefined is for the case when Toolbox is not initialized yet
    close: () => void;
    open: () => void;
    openWithoutSlash: () => void;
    toggle: () => void;
    hasFocus: () => boolean | undefined;
    } {
    return {
      opened: this.toolboxInstance?.opened,
      close: () => {
        this.toolboxInstance?.close();
      },
      openWithoutSlash: () => {
        if (this.toolboxInstance === null) {
          log('toolbox.openWithoutSlash() called before initialization is finished', 'warn');

          return;
        }

        if (this.hoveredBlock && !this.hoveredBlockIsFromTableCell) {
          const currentBlock = this.Blok.BlockManager.currentBlock;
          const isCurrentBlockInsideTableCell = currentBlock !== undefined
            && currentBlock.holder.closest('[data-blok-table-cell-blocks]') !== null;

          if (!isCurrentBlockInsideTableCell) {
            this.Blok.BlockManager.currentBlock = this.hoveredBlock;
          }
        }

        this.toolboxInstance.open(false);
      },
      open: () => {
        /**
         * If Toolbox is not initialized yet, do nothing
         */
        if (this.toolboxInstance === null)  {
          log('toolbox.open() called before initialization is finished', 'warn');

          return;
        }

        /**
         * Set current block to cover the case when the Toolbar showed near hovered Block but caret is set to another Block.
         * Skip this when:
         * - the hovered block was resolved from a table cell
         * - the current block's holder is nested inside a table cell container
         *   (e.g. "/" was typed in a cell while the toolbar was already open from hover,
         *   so hoveredBlockIsFromTableCell may be stale/false from the hover resolution)
         *
         * In both cases, overriding currentBlock with the resolved table block
         * would lose the cell-paragraph context the toolbox needs to hide restricted tools.
         */
        if (this.hoveredBlock && !this.hoveredBlockIsFromTableCell) {
          const currentBlock = this.Blok.BlockManager.currentBlock;
          const isCurrentBlockInsideTableCell = currentBlock !== undefined
            && currentBlock.holder.closest('[data-blok-table-cell-blocks]') !== null;

          if (!isCurrentBlockInsideTableCell) {
            this.Blok.BlockManager.currentBlock = this.hoveredBlock;
          }
        }

        this.toolboxInstance.open();
      },
      toggle: () => {
        /**
         * If Toolbox is not initialized yet, do nothing
         */
        if (this.toolboxInstance === null)  {
          log('toolbox.toggle() called before initialization is finished', 'warn');

          return;
        }

        this.toolboxInstance.toggle();
      },
      hasFocus: () => this.toolboxInstance?.hasFocus(),
    };
  }

  /**
   * Block actions appearance manipulations
   */
  private get blockActions(): { hide: () => void; show: () => void } {
    return {
      hide: (): void => {
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        this.nodes.actions?.classList.remove(this.CSS.actionsOpened);
        this.nodes.actions?.removeAttribute('data-blok-opened');
        if (this.nodes.actions) {
          this.nodes.actions.style.pointerEvents = 'none';
        }
      },
      show: (): void => {
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        this.nodes.actions?.classList.add(this.CSS.actionsOpened);
        this.nodes.actions?.setAttribute('data-blok-opened', 'true');
        if (this.nodes.actions) {
          this.nodes.actions.style.pointerEvents = 'auto';
        }
      },
    };
  }

  /**
   * Methods for working with Block Tunes toggler
   */
  private get blockTunesToggler(): { hide: () => void; show: () => void } {
    return {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      hide: (): void => this.nodes.settingsToggler?.classList.add(this.CSS.settingsTogglerHidden),
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      show: (): void => this.nodes.settingsToggler?.classList.remove(this.CSS.settingsTogglerHidden),
    };
  }


  /**
   * Toggles read-only mode
   * @param {boolean} readOnlyEnabled - read-only mode
   */
  public toggleReadOnly(readOnlyEnabled: boolean): void {
    if (!readOnlyEnabled) {
      window.requestIdleCallback(async () => {
        await this.drawUI();
        this.enableModuleBindings();
      }, { timeout: 2000 });
    } else {
      this.destroy();
      this.Blok.BlockSettings.destroy();
      this.disableModuleBindings();
    }
  }

  /**
   * Move Toolbar to the passed (or current) Block
   * @param block - block to move Toolbar near it
   * @param target - optional target element that was hovered (for content offset calculation)
   */
  public moveAndOpen(block?: Block | null, target?: Element | null): void {
    /**
     * Some UI elements creates inside requestIdleCallback, so the can be not ready yet
     */
    if (this.toolboxInstance === null)  {
      log('Can\'t open Toolbar since Blok initialization is not finished yet', 'warn');

      return;
    }

    /**
     * Reset explicitlyClosed flag when toolbar is opened
     */
    this.explicitlyClosed = false;

    /**
     * Close Toolbox when we move toolbar
     */
    if (this.toolboxInstance.opened) {
      this.toolboxInstance.close();
    }

    if (this.Blok.BlockSettings.opened) {
      this.Blok.BlockSettings.close();
    }

    /**
     * If no one Block selected as a Current
     */
    const unresolvedBlock = block ?? this.Blok.BlockManager.currentBlock;

    if (!unresolvedBlock) {
      return;
    }

    /**
     * Track whether the hover originated from inside a table cell.
     *
     * Two scenarios:
     * 1. Called with an explicit `target` (via BlockHovered): blockHover.ts resolves
     *    cell paragraphs up to the TABLE block before emitting the event, so
     *    `unresolvedBlock` is always the TABLE block — its holder is at the top level.
     *    Use the raw `target` element to detect if the pointer is inside a cell.
     * 2. Called without args (from activateToolbox / slash menu): `unresolvedBlock`
     *    falls back to `BlockManager.currentBlock`, which IS the cell-paragraph.
     *    Check the block's holder directly.
     *
     * When this flag is true, the toolbox.open() getter preserves the cell-paragraph
     * as currentBlock so that restricted tools (table, header) can be hidden.
     *
     * NOTE: This flag is NOT used for plus button / settings toggler visibility.
     * Those are handled separately by the focusin listener (tableCellFocusHandler)
     * which detects when the user actually clicks/focuses inside a cell.
     */
    const targetIsInsideCell = target instanceof Element
      && target.closest('[data-blok-table-cell-blocks]') !== null;
    const blockIsInsideCell =
      unresolvedBlock.holder.closest('[data-blok-table-cell-blocks]') !== null;

    this.hoveredBlockIsFromTableCell = targetIsInsideCell || blockIsInsideCell;

    const targetBlock = this.resolveTableCellBlock(unresolvedBlock);

    /** Clean up draggable on previous block if any */
    if (this.hoveredBlock && this.hoveredBlock !== targetBlock) {
      this.hoveredBlock.cleanupDraggable();
    }

    this.hoveredBlock = targetBlock;
    this.plusButtonHandler.setHoveredBlock(targetBlock);
    this.settingsTogglerHandler.setHoveredBlock(targetBlock);
    this.positioner.setHoveredTarget(target ?? null);
    this.positioner.resetCachedPosition(); // Reset cached position when moving to a new block

    const { wrapper, plusButton, settingsToggler } = this.nodes;

    if (!wrapper || !plusButton) {
      return;
    }

    /**
     * Adjust toolbar button visibility based on context:
     * - Table cell focus: settings toggler hidden (drag/settings don't apply to cells)
     * - Callout first child: both plus button and settings toggler hidden
     *   to prevent overlap with the callout's emoji icon
     */
    const focusIsInsideCell = this.isFocusInsideTableCell();
    const isCalloutFirstChild = this.isFirstChildOfCallout(targetBlock);
    const isCalloutBlock = targetBlock.name === 'callout';

    // Hide plus button for callout blocks and their first children to avoid
    // overlap with the callout emoji icon in the left padding area.
    plusButton.style.display = (isCalloutFirstChild || isCalloutBlock) ? 'none' : '';

    if (settingsToggler) {
      settingsToggler.style.display = (focusIsInsideCell || isCalloutFirstChild) ? 'none' : '';
    }

    /**
     * Adapt toolbar button background for blocks inside a callout with custom colors.
     * Use color-mix() to create a subtly lighter variant of the callout background
     * so buttons are distinguishable from the callout surface.
     * Icon color stays default (text-text-secondary) regardless of callout colors.
     *
     * Skip when the target is the callout itself or its first child — their toolbar
     * buttons render outside the callout's visual background area.
     */
    const calloutBg = isCalloutFirstChild || targetBlock.name === 'callout'
      ? null
      : this.getCalloutBackgroundColor(targetBlock);

    if (calloutBg !== null) {
      wrapper.style.setProperty('--blok-bg-light', `light-dark(color-mix(in srgb, ${calloutBg} 70%, white), color-mix(in srgb, ${calloutBg} 85%, white))`);
    } else {
      wrapper.style.removeProperty('--blok-bg-light');
    }

    const targetBlockHolder = targetBlock.holder;
    const { isMobile } = this.Blok.UI;

    const toolbarY = this.positioner.calculateToolbarY(
      { targetBlock, hoveredTarget: target ?? null, isMobile },
      plusButton
    );

    if (toolbarY === null) {
      return;
    }

    /**
     * Move Toolbar to the Top coordinate of Block
     */
    this.positioner.moveToY(this.nodes, toolbarY);
    targetBlockHolder.appendChild(wrapper);

    /** Set up draggable on the target block using the settings toggler as drag handle */
    if (settingsToggler && !this.Blok.ReadOnly.isEnabled) {
      targetBlock.setupDraggable(settingsToggler, this.Blok.DragManager);
    }

    /**
     * Update toolbox left alignment to the block's content element so the popover
     * aligns with the actual visible content, not the toolbar's internal wrapper.
     */
    const blockContentElement = targetBlockHolder.querySelector<HTMLElement>(`[${DATA_ATTR.elementContent}]`);

    if (blockContentElement) {
      this.toolboxInstance.updateLeftAlignElement(blockContentElement);
    }

    /**
     * Apply content offset for nested elements (e.g., nested list items)
     */
    this.positioner.applyContentOffset(this.nodes, targetBlock);

    /**
     * Do not show Block Tunes Toggler near single and empty block
     */
    const tunes = targetBlock.getTunes();
    const hasAnyTunes = tunes.toolTunes.length > 0 || tunes.commonTunes.length > 0;

    if (this.Blok.BlockManager.blocks.length === 1 && targetBlock.isEmpty && !hasAnyTunes) {
      this.blockTunesToggler.hide();
    } else {
      this.blockTunesToggler.show();
    }

    this.open();

    /**
     * For blocks with interactive elements at the left edge (toggle arrows,
     * callout emoji buttons), disable pointer-events on the actions
     * container so clicks pass through to the block content.
     * Must run after open() which sets pointer-events: auto on actions.
     */
    const isToggleHeader = targetBlock.name === 'header'
      && targetBlock.holder.querySelector('[data-blok-toggle-arrow]') !== null;
    const hasLeftEdgeInteraction = targetBlock.name === 'callout'
      || targetBlock.name === 'toggle'
      || isToggleHeader;

    if (hasLeftEdgeInteraction && this.nodes.actions) {
      this.nodes.actions.style.pointerEvents = 'none';
      this.restoreSettingsTogglerForLeftEdgeBlock(targetBlock);
    }

    /**
     * Sync toolbar content wrapper's position and width with the block content element
     * so toolbar buttons align with the block content edge regardless of whether
     * the consumer uses CSS margin or overrides max-width (e.g. wide-mode).
     *
     * Uses getBoundingClientRect to get the actual visual offset rather than reading
     * CSS marginLeft, which does not account for cases where max-width is removed
     * and the content fills the full container width.
     *
     * Uses Math.max to guarantee the actions container (positioned via right:100%)
     * never extends beyond the left edge of the viewport, which would make the
     * drag handle unreachable by pointer events.
     */
    if (blockContentElement && this.nodes.content) {
      const holderRect = this.nodes.wrapper?.getBoundingClientRect();
      const contentRect = blockContentElement.getBoundingClientRect();
      const visualOffset = holderRect ? Math.max(0, contentRect.left - holderRect.left) : 0;
      const actionsWidth = this.nodes.actions?.offsetWidth ?? 0;

      this.nodes.content.style.marginLeft = `${Math.max(visualOffset, actionsWidth)}px`;
      this.nodes.content.style.maxWidth = `${contentRect.width}px`;
    }
  }

  /**
   * Move Toolbar to the specified block (or first selected block) and open it for multi-block selection.
   * Keeps the add button visible so users can still insert blocks while multiple are selected.
   * @param block - optional block to position the toolbar at (defaults to first selected block)
   */
  public moveAndOpenForMultipleBlocks(block?: Block): void {
    /**
     * Do not move toolbar if Block Settings is opened or opening.
     * The settings menu should remain anchored to where the user opened it.
     */
    if (this.Blok.BlockSettings.opened || this.Blok.BlockSettings.isOpening) {
      return;
    }

    const selectedBlocks = this.Blok.BlockSelection.selectedBlocks;

    if (selectedBlocks.length < 2) {
      return;
    }

    /**
     * Some UI elements creates inside requestIdleCallback, so they can be not ready yet
     */
    if (this.toolboxInstance === null) {
      log('Can\'t open Toolbar since Blok initialization is not finished yet', 'warn');

      return;
    }

    /**
     * Close Toolbox when we move toolbar
     */
    if (this.toolboxInstance.opened) {
      this.toolboxInstance.close();
    }

    /**
     * Reset explicitlyClosed flag to allow toolbar to reopen/move on hover
     */
    this.explicitlyClosed = false;

    /**
     * Don't close BlockSettings here - it should remain open if the user explicitly opened it via the settings toggler.
     * The hover behavior that calls this method shouldn't interfere with the user's intent to open the menu.
     */

    /**
     * Use the provided block or fall back to the first selected block as the anchor for the toolbar
     */
    const targetBlock = block ?? selectedBlocks[0];

    /** Clean up draggable on previous block if any */
    if (this.hoveredBlock && this.hoveredBlock !== targetBlock) {
      this.hoveredBlock.cleanupDraggable();
    }

    this.hoveredBlock = targetBlock;
    this.plusButtonHandler.setHoveredBlock(targetBlock);
    this.settingsTogglerHandler.setHoveredBlock(targetBlock);
    this.positioner.setHoveredTarget(null); // No target for multi-block selection
    this.positioner.resetCachedPosition(); // Reset cached position when moving to a new block

    const { wrapper, plusButton, settingsToggler } = this.nodes;

    if (!wrapper || !plusButton) {
      return;
    }

    /**
     * Restore plus button and settings toggler visibility for multi-block selection,
     * in case they were hidden for table cell blocks.
     */
    plusButton.style.display = '';
    plusButton.style.color = '';

    if (settingsToggler) {
      settingsToggler.style.display = '';
      settingsToggler.style.color = '';
    }

    const targetBlockHolder = targetBlock.holder;

    const toolbarY = this.positioner.calculateToolbarY(
      { targetBlock, hoveredTarget: null, isMobile: false },
      plusButton
    );

    if (toolbarY === null) {
      return;
    }

    this.positioner.moveToY(this.nodes, toolbarY);
    targetBlockHolder.appendChild(wrapper);

    if (settingsToggler && !this.Blok.ReadOnly.isEnabled) {
      targetBlock.setupDraggable(settingsToggler, this.Blok.DragManager);
    }

    const blockContentElement = targetBlockHolder.querySelector<HTMLElement>(`[${DATA_ATTR.elementContent}]`);

    if (blockContentElement) {
      this.toolboxInstance.updateLeftAlignElement(blockContentElement);
    }

    /**
     * Reset content offset for multi-block selection
     */
    this.positioner.applyContentOffset(this.nodes, targetBlock);

    /**
     * Always show the settings toggler for multi-block selection
     */
    this.blockTunesToggler.show();

    this.open();

    /**
     * Sync toolbar content wrapper's position and width with the block content element.
     * Uses getBoundingClientRect so wide-mode content (max-width: none) is handled correctly.
     * Clamp to actionsWidth so actions never extend beyond the left viewport edge.
     */
    if (blockContentElement && this.nodes.content) {
      const holderRect = this.nodes.wrapper?.getBoundingClientRect();
      const contentRect = blockContentElement.getBoundingClientRect();
      const visualOffset = holderRect ? Math.max(0, contentRect.left - holderRect.left) : 0;
      const actionsWidth = this.nodes.actions?.offsetWidth ?? 0;

      this.nodes.content.style.marginLeft = `${Math.max(visualOffset, actionsWidth)}px`;
      this.nodes.content.style.maxWidth = `${contentRect.width}px`;
    }
  }

  /**
   * Close the Toolbar
   * @param options - Optional configuration
   */
  public close(options?: ToolbarCloseOptions): void {
    if (this.Blok.ReadOnly.isEnabled) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-deprecated
    this.nodes.wrapper?.classList.remove(this.CSS.toolbarOpened);
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    this.nodes.wrapper?.classList.add(this.CSS.toolbarClosed);
    this.nodes.wrapper?.removeAttribute('data-blok-opened');

    /** Close components */
    this.blockActions.hide();
    this.toolboxInstance?.close();
    this.Blok.BlockSettings.close();

    /**
     * Clear hovered block state and optionally mark as explicitly closed
     * to prevent toolbar from reopening on subsequent block-hovered events
     */
    this.hoveredBlock = null;
    this.hoveredBlockIsFromTableCell = false;
    // Only set explicitlyClosed if not explicitly disabled (e.g., when called from toolbox after block insertion)
    if (options?.setExplicitlyClosed !== false) {
      this.explicitlyClosed = true;

      /**
       * Reset the BlockHoverController's lastHoveredBlockId so that the next
       * mousemove over the same block re-emits BlockHovered.
       * Without this, deduplication in BlockHoverController suppresses the event
       * and the toolbar can never reopen on the same block after being closed by
       * a mousedown (e.g. from RectangleSelection.startSelection).
       */
      this.Blok.UI.resetBlockHoverState();
    }

    /**
     * Restore plus button and settings toggler visibility
     * in case they were hidden for table cell blocks
     */
    if (this.nodes.plusButton) {
      this.nodes.plusButton.style.display = '';
      this.nodes.plusButton.style.color = '';
    }

    if (this.nodes.settingsToggler) {
      this.nodes.settingsToggler.style.display = '';
      this.nodes.settingsToggler.style.color = '';
    }

    /**
     * Reset the content offset transform and margin sync
     */
    if (this.nodes.actions) {
      this.nodes.actions.style.transform = '';
    }
    if (this.nodes.content) {
      this.nodes.content.style.marginLeft = '';
      this.nodes.content.style.maxWidth = '';
    }
    this.positioner.setHoveredTarget(null);

    this.reset();
  }

  /**
   * Prevents the settings menu from opening on the next mouseup event
   * Used after block drop to avoid accidental menu opening
   */
  public skipNextSettingsToggle(): void {
    this.settingsTogglerHandler.skipNextToggle();
  }

  /**
   * Hides the block actions (plus button and settings toggler) without
   * closing the entire toolbar or setting explicitlyClosed.
   * Used when the toolbar should remain positioned but its action buttons
   * should temporarily step aside (e.g., during typing or inline toolbar use).
   */
  public hideBlockActions(): void {
    this.blockActions.hide();
  }

  /**
   * Resets the explicitlyClosed flag to allow the toolbar to reopen on hover.
   * Called when drag is cancelled to re-enable hover-based toolbar opening.
   */
  public resetExplicitlyClosed(): void {
    this.explicitlyClosed = false;
  }

  /**
   * Checks whether the currently focused element (document.activeElement) is
   * inside a table cell container.
   *
   * Used to decide whether the plus button and settings toggler should be hidden.
   * Focus-based check distinguishes click (buttons hidden) from hover (buttons visible).
   */
  /**
   * Checks whether the given block is the first child of a callout block.
   * Used to hide the plus button and prevent it from overlapping the callout emoji icon.
   */
  private isFirstChildOfCallout(block: Block): boolean {
    if (!block.parentId) {
      return false;
    }

    const parentBlock = this.Blok.BlockManager.getBlockById(block.parentId);

    if (!parentBlock || parentBlock.name !== 'callout') {
      return false;
    }

    return parentBlock.contentIds[0] === block.id;
  }

  /**
   * Returns the background color of the callout containing the given block,
   * or null if the block is not inside a colored callout (or the callout has
   * no background color set).
   */
  private getCalloutBackgroundColor(block: Block): string | null {
    const calloutBlock = this.resolveCalloutBlock(block);

    if (!calloutBlock) {
      return null;
    }

    try {
      const bg = calloutBlock.pluginsContent.style.backgroundColor;

      return bg || null;
    } catch {
      return null;
    }
  }

  /**
   * Returns the callout block if the given block is a callout or is a child of one.
   */
  private resolveCalloutBlock(block: Block): Block | null {
    if (block.name === 'callout') {
      return block;
    }

    if (!block.parentId) {
      return null;
    }

    const parent = this.Blok.BlockManager.getBlockById(block.parentId);

    if (!parent || parent.name !== 'callout') {
      return null;
    }

    return parent;
  }

  private isFocusInsideTableCell(): boolean {
    const active = document.activeElement;

    if (!active) {
      return false;
    }

    return active.closest('[data-blok-table-cell-blocks]') !== null;
  }

  /**
   * Updates toolbar button visibility based on whether a table cell has focus.
   * The plus button always stays visible; the settings toggler is hidden when
   * focus is inside a cell and restored when focus moves to a regular block.
   *
   * Called from the focusin listener so button state is updated immediately
   * on click, without waiting for the next hover/moveAndOpen cycle.
   */
  private updateToolbarButtonsForTableCellFocus(): void {
    const { plusButton, settingsToggler } = this.nodes;

    if (!plusButton) {
      return;
    }

    const focusIsInsideCell = this.isFocusInsideTableCell();
    const isCalloutFirstChild = this.hoveredBlock !== null && this.isFirstChildOfCallout(this.hoveredBlock);
    const isCalloutBlock = this.hoveredBlock?.name === 'callout';

    plusButton.style.display = (isCalloutFirstChild || isCalloutBlock) ? 'none' : '';

    if (settingsToggler) {
      settingsToggler.style.display = (focusIsInsideCell || isCalloutFirstChild) ? 'none' : '';
    }
  }

  /**
   * Re-enables pointer-events on the settings toggler (and callout drag zone) after
   * the actions container has been set to pointer-events: none for left-edge blocks.
   *
   * For callout blocks: also wires the dedicated drag zone as the drag handle and
   * re-enables the settings toggler so the settings menu remains accessible.
   * The emoji button (at x=32px) no longer overlaps the actions zone (x=[0,29px])
   * because the callout uses pl-8 (32px) left padding.
   *
   * For all other left-edge blocks (toggle, header with arrow): simply re-enables the
   * settings toggler so it continues to function as the drag handle.
   */
  private restoreSettingsTogglerForLeftEdgeBlock(targetBlock: Block): void {
    if (targetBlock.name === 'callout') {
      if (this.nodes.settingsToggler) {
        this.nodes.settingsToggler.style.pointerEvents = 'auto';
      }

      const calloutDragZone = targetBlock.holder.querySelector<HTMLElement>('[data-callout-drag-zone]');

      if (calloutDragZone) {
        calloutDragZone.style.pointerEvents = 'auto';
        targetBlock.setupDraggable(calloutDragZone, this.Blok.DragManager);
      }

      return;
    }

    if (this.nodes.settingsToggler) {
      this.nodes.settingsToggler.style.pointerEvents = 'auto';
    }
  }

  /**
   * If the block is inside a table cell, resolve to the parent table block.
   * This ensures the toolbar shows for the table when clicking/focusing inside cells.
   * Uses the DOM attribute directly to avoid cross-module dependency on the table tool.
   *
   * @param block - the block to resolve
   * @returns the parent table block if inside a cell, the original block otherwise
   */
  private resolveTableCellBlock(block: Block): Block {
    const cellBlocksContainer = block.holder.closest('[data-blok-table-cell-blocks]');

    if (!cellBlocksContainer) {
      return block;
    }

    const tableBlockHolder = cellBlocksContainer.closest('[data-blok-testid="block-wrapper"]');

    if (!tableBlockHolder) {
      return block;
    }

    return this.Blok.BlockManager.getBlockByChildNode(tableBlockHolder) ?? block;
  }

  /**
   * Reset the Toolbar position to prevent DOM height growth, for example after blocks deletion
   */
  private reset(): void {
    this.positioner.resetCachedPosition(); // Reset cached position when toolbar is reset

    if (this.nodes.wrapper) {
      this.nodes.wrapper.style.top = 'unset';

      /**
       * Move Toolbar back to the Blok wrapper to save it from deletion
       */
      this.Blok.UI.nodes.wrapper.appendChild(this.nodes.wrapper);
    }
  }

  /**
   * Open Toolbar with Plus Button and Actions
   * @param {boolean} withBlockActions - by default, Toolbar opens with Block Actions.
   *                                     This flag allows to open Toolbar without Actions.
   */
  private open(withBlockActions = true): void {
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    this.nodes.wrapper?.classList.remove(this.CSS.toolbarClosed);
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    this.nodes.wrapper?.classList.add(this.CSS.toolbarOpened);
    this.nodes.wrapper?.setAttribute('data-blok-opened', 'true');

    if (withBlockActions) {
      this.blockActions.show();
    } else {
      this.blockActions.hide();
    }
  }

  /**
   * Draws Toolbar elements
   */
  private async make(): Promise<void> {
    const wrapper = $.make('div', [
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- CSS getter now returns Tailwind classes
      this.CSS.toolbar,
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- CSS getter now returns Tailwind classes
      this.CSS.toolbarClosed,
      'group-data-[blok-dragging=true]:pointer-events-none',
    ]);

    this.nodes.wrapper = wrapper;
    wrapper.setAttribute(DATA_ATTR.toolbar, '');
    wrapper.setAttribute('data-blok-testid', 'toolbar');

    /**
     * Make Content Zone and Actions Zone
     */
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- CSS getter now returns Tailwind classes
    const content = $.make('div', this.CSS.content);
    const actions = $.make('div', [
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- CSS getter now returns Tailwind classes
      this.CSS.actions,
    ]);

    /**
     * Start with pointer-events disabled so invisible (opacity-0) actions
     * don't intercept clicks on elements underneath (e.g. toggle arrows).
     * blockActions.show()/hide() toggles this inline style.
     */
    actions.style.pointerEvents = 'none';

    this.nodes.content = content;

    this.nodes.actions = actions;
    actions.setAttribute('data-blok-testid', 'toolbar-actions');

    /**
     * Actions will be included to the toolbar content so we can align in to the right of the content
     */
    $.append(wrapper, content);
    $.append(content, actions);

    /**
     * Fill Content Zone:
     *  - Plus Button (created by handler)
     *  - Toolbox
     */
    const plusButton = this.plusButtonHandler.make(this.nodes);
    $.append(actions, plusButton);

    /**
     * Fill Actions Zone:
     *  - Settings Toggler (created by handler)
     *  - Remove Block Button
     *  - Settings Panel
     */
    const settingsToggler = this.settingsTogglerHandler.make(this.nodes);
    $.append(actions, settingsToggler);

    /**
     * Appending Toolbar components to itself
     */
    $.append(actions, this.makeToolbox());

    const blockSettingsElement = this.Blok.BlockSettings.getElement();

    if (!blockSettingsElement) {
      throw new Error('Block Settings element was not created');
    }

    $.append(actions, blockSettingsElement);

    /**
     * Append toolbar to the Blok
     */
    $.append(this.Blok.UI.nodes.wrapper, wrapper);
  }

  /**
   * Creates the Toolbox instance and return it's rendered element
   */
  private makeToolbox(): Element {
    /**
     * Make the Toolbox
     */
    this.toolboxInstance = new Toolbox({
      api: this.Blok.API.methods,
      tools: this.Blok.Tools.blockTools,
      i18nLabels: {
        filter: this.Blok.I18n.t('popover.search'),
        nothingFound: this.Blok.I18n.t('popover.nothingFound'),
        slashSearchPlaceholder: this.Blok.I18n.t('toolbox.typeToSearch'),
      },
      i18n: this.Blok.I18n,
      triggerElement: this.nodes.plusButton,
    });

    this.toolboxInstance.on(ToolboxEvent.Opened, () => {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      this.Blok.UI.nodes.wrapper.classList.add(this.CSS.openedToolboxHolderModifier);
      this.Blok.UI.nodes.wrapper.setAttribute(DATA_ATTR.toolboxOpened, 'true');

      /**
       * Adapt search input colors when toolbox opens inside a colored callout.
       */
      const calloutBg = this.hoveredBlock !== null
        ? this.getCalloutBackgroundColor(this.hoveredBlock)
        : null;

      this.toolboxInstance?.setCalloutBackground(calloutBg);
    });

    this.toolboxInstance.on(ToolboxEvent.Closed, () => {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      this.Blok.UI.nodes.wrapper.classList.remove(this.CSS.openedToolboxHolderModifier);
      this.Blok.UI.nodes.wrapper.removeAttribute(DATA_ATTR.toolboxOpened);

      /**
       * If the toolbox was opened via the plus button and the user dismissed
       * it without selecting a tool (Escape / click outside), restore focus to
       * the block that was focused BEFORE the plus button was clicked and
       * remove the orphan empty block that was inserted.
       *
       * When a tool IS selected, ToolboxEvent.BlockAdded fires first and clears
       * preToolboxBlock, so this branch is skipped for that case.
       */
      if (this.preToolboxBlock !== null) {
        const blockToRestore = this.preToolboxBlock;

        this.preToolboxBlock = null;

        // Remove the orphan block that was inserted by the plus button click,
        // then restore focus. removeBlock() is Promise-based but resolves
        // synchronously; chaining ensures setToBlock runs after removal.
        if (this.plusInsertedBlock !== null) {
          const orphan = this.plusInsertedBlock;

          this.plusInsertedBlock = null;
          void this.Blok.BlockManager.removeBlock(orphan, false).then(() => {
            if (blockToRestore.inputs.length > 0) {
              this.Blok.Caret.setToBlock(blockToRestore, this.Blok.Caret.positions.END);
            }
          });
        } else if (blockToRestore.inputs.length > 0) {
          // Reused an existing block (emptyBlockToReuse path) — just restore focus
          this.Blok.Caret.setToBlock(blockToRestore, this.Blok.Caret.positions.END);
        }

        return;
      }

      /**
       * Restore focus to the current block when the toolbox closes via any
       * non-plus-button path (e.g. slash-search dismissed via Escape).
       * Without this, focus falls to document.body after non-keyboard close
       * paths, causing subsequent keystrokes to be lost.
       */
      const currentBlock = this.Blok.BlockManager.currentBlock;

      if (currentBlock && currentBlock.inputs.length > 0) {
        this.Blok.Caret.setToBlock(currentBlock, this.Blok.Caret.positions.END);
      }
    });

    this.toolboxInstance.on(ToolboxEvent.BlockAdded, ({ block }) => {
      /**
       * A tool was selected and a block was added — clear the cancel context so
       * ToolboxEvent.Closed (which fires after this) does not try to undo the
       * insertion and restore focus to the pre-plus block.
       */
      this.preToolboxBlock = null;
      this.plusInsertedBlock = null;

      const { BlockManager, Caret } = this.Blok;
      const newBlock = BlockManager.getBlockById(block.id);

      if (!newBlock) {
        return;
      }

      if (newBlock.inputs.length !== 0) {
        return;
      }

      /**
       * If the new block doesn't contain inputs, insert the new paragraph below
       */
      if (newBlock === BlockManager.lastBlock) {
        BlockManager.insertAtEnd();
        Caret.setToBlock(BlockManager.lastBlock);

        return;
      }

      const nextBlock = BlockManager.nextBlock;

      if (nextBlock) {
        Caret.setToBlock(nextBlock);
      }
    });

    const element = this.toolboxInstance.getElement();

    if (element === null) {
      throw new Error('Toolbox element was not created');
    }

    return element;
  }


  /**
   * Enable bindings
   */
  private enableModuleBindings(): void {
    /**
     * Plus button mousedown handler
     * Uses click-vs-drag detection to distinguish clicks from drags.
     */
    const plusButton = this.nodes.plusButton;

    if (plusButton) {
      this.readOnlyMutableListeners.on(plusButton, 'mousedown', (e) => {
        /**
         * Prevent focus from moving away from the currently-active contenteditable block.
         * Without this, clicking the plus button steals DOM focus, causing subsequent
         * keystrokes to land in the wrong block (text-jumping bug).
         */
        (e as MouseEvent).preventDefault();
        hide();

        this.clickDragHandler.setup(
          e as MouseEvent,
          (mouseUpEvent) => {
            /**
             * Check for modifier key to determine insert direction:
             * - Option/Alt on Mac, Ctrl on Windows → insert above
             * - No modifier → insert below (default)
             */
            const userOS = getUserOS();
            const insertAbove = userOS.win ? mouseUpEvent.ctrlKey : mouseUpEvent.altKey;

            this.plusButtonHandler.handleClick(insertAbove);
          }
        );
      }, true);
    }

    /**
     * Settings toggler mousedown handler
     * Uses click-vs-drag detection to distinguish clicks from drags.
     */
    const settingsToggler = this.nodes.settingsToggler;

    if (settingsToggler) {
      this.readOnlyMutableListeners.on(settingsToggler, 'mousedown', this.settingsTogglerHandler.createMousedownHandler(), true);
    }

    /**
     * Listen for focus changes inside the editor.
     * When the user clicks/tabs into a table cell, hide the plus button and
     * settings toggler. When focus moves to a regular block, restore them.
     *
     * This runs on every focusin event (not throttled) to ensure buttons
     * update immediately on click — no 300ms delay.
     */
    this.readOnlyMutableListeners.on(this.Blok.UI.nodes.wrapper, 'focusin', () => {
      this.updateToolbarButtonsForTableCellFocus();
    });

    /**
     * Subscribe to the 'block-hovered' event if current view is not mobile
     * @see https://github.com/codex-team/editor.js/issues/1972
     */
    if (!isMobileScreen()) {
      /**
       * Subscribe to the 'block-hovered' event
       */
      this.eventsDispatcher.on(BlockHovered, (data) => {
        /**
         * Do not move toolbar during drag, rectangle selection, or when the user
         * started a mouse-drag from within the editor's content area (even if the
         * drag originated on a contentEditable element, i.e. rubber-band is not
         * activated but the toolbar was closed and should stay closed).
         */
        if (this.Blok.DragManager.isDragging || this.Blok.RectangleSelection.isRectActivated() || this.Blok.RectangleSelection.isMouseDownWithinBounds) {
          return;
        }

        const hoveredBlock = (data as { block?: Block; target?: Element }).block;
        const hoveredTarget = (data as { block?: Block; target?: Element }).target;

        if (!(hoveredBlock instanceof Block)) {
          return;
        }

        /**
         * Do not move toolbar if Block Settings or Toolbox opened
         */
        if (this.Blok.BlockSettings.opened || this.Blok.BlockSettings.isOpening || this.toolboxInstance?.opened) {
          return;
        }

        /**
         * Do not move toolbar if it was explicitly closed and the user is still
         * hovering the same block. When the user hovers a DIFFERENT block
         * (or hoveredBlock is null after close()), reset the flag and allow
         * the toolbar to reopen — this is an intentional user action.
         */
        if (this.explicitlyClosed) {
          if (this.hoveredBlock !== null && this.hoveredBlock === hoveredBlock) {
            return;
          }

          this.explicitlyClosed = false;
        }

        /**
         * Check if multiple blocks are selected
         */
        const selectedBlocks = this.Blok.BlockSelection.selectedBlocks;
        const isMultiBlockSelection = selectedBlocks.length > 1;
        const isHoveredBlockSelected = isMultiBlockSelection && selectedBlocks.some(block => block === hoveredBlock);

        /**
         * For multi-block selection, only move toolbar if the hovered block is one of the selected blocks
         */
        if (isMultiBlockSelection && isHoveredBlockSelected) {
          this.moveAndOpenForMultipleBlocks(hoveredBlock);

          return;
        }

        /**
         * For multi-block selection where hovered block is not selected, do nothing
         */
        if (isMultiBlockSelection) {
          return;
        }

        this.moveAndOpen(hoveredBlock, hoveredTarget);
      });
    }

    /**
     * Subscribe to the Block Settings events to toggle 'opened' state of the Settings Toggler
     */
    this.eventsDispatcher.on(BlockSettingsOpened, this.onBlockSettingsOpen);
    this.eventsDispatcher.on(BlockSettingsClosed, this.onBlockSettingsClose);

    /**
     * Subscribe to block changes to reposition toolbar when block content changes
     */
    this.eventsDispatcher.on(BlockChanged, this.onBlockChanged);
  }

  /**
   * Disable bindings
   */
  private disableModuleBindings(): void {
    this.readOnlyMutableListeners.clearAll();
    this.eventsDispatcher.off(BlockSettingsOpened, this.onBlockSettingsOpen);
    this.eventsDispatcher.off(BlockSettingsClosed, this.onBlockSettingsClose);
    this.eventsDispatcher.off(BlockChanged, this.onBlockChanged);
  }

  /**
   * Handler for BlockSettingsOpened event
   */
  private onBlockSettingsOpen = (): void => {
    this.Blok.UI.nodes.wrapper.setAttribute(DATA_ATTR.blockSettingsOpened, 'true');
  };

  /**
   * Handler for BlockSettingsClosed event
   */
  private onBlockSettingsClose = (): void => {
    this.Blok.UI.nodes.wrapper.removeAttribute(DATA_ATTR.blockSettingsOpened);
  };

  /**
   * Handler for BlockChanged event - repositions toolbar when block content changes
   */
  private onBlockChanged = (payload: BlockChangedPayload): void => {
    /**
     * Only reposition if toolbar is opened and we have a hovered block
     */
    if (!this.opened || !this.hoveredBlock) {
      return;
    }

    /**
     * Don't reposition if Block Settings or Toolbox is opened or opening
     */
    if (this.Blok.BlockSettings.opened || this.Blok.BlockSettings.isOpening || this.toolboxInstance?.opened) {
      return;
    }

    /**
     * Only reposition if the changed block is the hovered block.
     * This prevents unnecessary repositioning when other blocks change,
     * and avoids toolbar jumping when interacting with checklist items.
     */
    const changedBlockId = payload.event.detail.target.id;

    if (changedBlockId !== this.hoveredBlock.id) {
      return;
    }

    this.repositionToolbar();
  };

  /**
   * Repositions the toolbar to stay centered on the first line of the current block
   * without closing/opening toolbox or block settings
   */
  private repositionToolbar(): void {
    if (!this.hoveredBlock || !this.nodes.plusButton) {
      return;
    }

    this.positioner.repositionToolbar(
      this.nodes,
      {
        targetBlock: this.hoveredBlock,
        hoveredTarget: this.positioner.target,
        isMobile: this.Blok.UI.isMobile,
      },
      this.nodes.plusButton
    );
  }


  /**
   * Draws Toolbar UI
   *
   * Toolbar contains BlockSettings and Toolbox.
   * That's why at first we draw its components and then Toolbar itself
   *
   * Steps:
   *  - Make Toolbar dependent components like BlockSettings, Toolbox and so on
   *  - Make itself and append dependent nodes to itself
   *
   */
  private async drawUI(): Promise<void> {
    /**
     * Make BlockSettings Panel
     */
    this.Blok.BlockSettings.make();

    /**
     * Make Toolbar
     */
    await this.make();
  }

  /**
   * Removes all created and saved HTMLElements
   * It is used in Read-Only mode
   */
  private destroy(): void {
    this.removeAllNodes();
    if (this.toolboxInstance) {
      this.toolboxInstance.destroy();
    }

    /**
     * Clean up any pending click-drag handlers
     */
    this.clickDragHandler.destroy();
  }
}
