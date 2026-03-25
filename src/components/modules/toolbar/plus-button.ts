import type { BlokModules } from '../../../types-internal/blok-modules';
import type { Block } from '../../block';
import { Dom as $ } from '../../dom';
import { IconPlus } from '../../icons';
import { SelectionUtils } from '../../selection/index';
import { getUserOS } from '../../utils';
import { onHover } from '../../utils/tooltip';
import { twJoin } from '../../utils/tw';

import { createTooltipContent } from './tooltip';
import type { ToolbarNodes } from './types';

/**
 * PlusButtonHandler manages the plus button creation and behavior.
 * Creates the plus button element with tooltip.
 */
export class PlusButtonHandler {
  /**
   * Getter function to access Blok modules dynamically
   * This ensures the handler always has access to the current state
   */
  private getBlok: () => BlokModules;

  /**
   * Callback to get the current toolbox state
   */
  private getToolboxOpened: () => boolean;

  /**
   * Callback to open the toolbox in slash-search mode
   */
  private openToolbox: () => void;

  /**
   * Callback to open the toolbox in no-slash mode (used when clicking the plus button)
   */
  private openToolboxWithoutSlash: () => void;

  /**
   * Callback to close the toolbox
   */
  private closeToolbox: () => void;

  /**
   * Callback to move and open the toolbar
   */
  private moveAndOpenToolbar: (block?: Block | null, target?: Element | null) => void;

  /**
   * @param getBlok - Function to get Blok modules reference
   * @param callbacks - Object containing callback functions
   */
  constructor(
    getBlok: () => BlokModules,
    callbacks: {
      getToolboxOpened: () => boolean;
      openToolbox: () => void;
      openToolboxWithoutSlash: () => void;
      closeToolbox: () => void;
      moveAndOpenToolbar: (block?: Block | null, target?: Element | null) => void;
    }
  ) {
    this.getBlok = getBlok;
    this.getToolboxOpened = callbacks.getToolboxOpened;
    this.openToolbox = callbacks.openToolbox;
    this.openToolboxWithoutSlash = callbacks.openToolboxWithoutSlash;
    this.closeToolbox = callbacks.closeToolbox;
    this.moveAndOpenToolbar = callbacks.moveAndOpenToolbar;
  }

  /**
   * Gets the current hovered block
   */
  get hoveredBlock(): Block | null {
    return this.hoveredBlockInternal;
  }

  /**
   * Sets the hovered block
   */
  setHoveredBlock(block: Block | null): void {
    this.hoveredBlockInternal = block;
  }

  /**
   * Internal storage for the hovered block
   */
  private hoveredBlockInternal: Block | null = null;

  /**
   * Creates the plus button element with tooltip
   * @param nodes - Toolbar nodes object to populate with the plus button
   * @returns The created plus button element
   */
  public make(nodes: ToolbarNodes): HTMLElement {
    const blok = this.getBlok();
    const plusButton = $.make('div', [
      twJoin(
        // Base toolbox-button styles
        'text-text-secondary cursor-pointer w-6 h-6 rounded-[5px] inline-flex justify-center items-center select-none',
        'shrink-0',
        // SVG sizing
        '[&_svg]:h-[22px] [&_svg]:w-[22px]',
        // Hover (can-hover)
        'can-hover:hover:bg-bg-light',
        // Keep hover background when toolbox is open
        'group-data-[blok-toolbox-opened=true]:bg-bg-light',
        // Mobile styles (static positioning with overlay-pane appearance)
        'mobile:bg-popover-bg mobile:border mobile:border-mobile-border mobile:shadow-overlay-pane mobile:rounded-[6px] mobile:z-2',
        'mobile:w-toolbox-btn-mobile mobile:h-toolbox-btn-mobile',
        // RTL styles
        'group-data-[blok-rtl=true]:right-[calc(-1*(var(--spacing-toolbox-btn)))] group-data-[blok-rtl=true]:left-auto'
      ),
    ], {
      innerHTML: IconPlus,
    });

    plusButton.setAttribute('data-blok-testid', 'plus-button');

    // eslint-disable-next-line no-param-reassign -- nodes is mutated by design
    nodes.plusButton = plusButton;

    /**
     * Add events to show/hide tooltip for plus button
     */
    const userOS = getUserOS();
    const modifierClickText = blok.I18n.t(
      userOS.win
        ? 'toolbox.ctrlAddAbove'
        : 'toolbox.optionAddAbove'
    );

    const tooltipContent = createTooltipContent([
      blok.I18n.t('toolbox.addBelow'),
      modifierClickText,
    ]);

    onHover(plusButton, tooltipContent, {
      delay: 500,
    });

    return plusButton;
  }

  /**
   * Handles the plus button click.
   * Inserts "/" into target block and opens toolbox, or toggles toolbox closed if already open.
   * @param insertAbove - if true, insert above the current block instead of below
   */
  public handleClick(insertAbove = false): void {
    const { BlockManager, BlockSettings, BlockSelection, Caret } = this.getBlok();

    // Close other menus and clear selections
    if (BlockSettings.opened) {
      BlockSettings.close();
    }
    if (BlockSelection.anyBlockSelected) {
      BlockSelection.clearSelection();
    }
    SelectionUtils.get()?.removeAllRanges();

    // Toggle closed if already open
    if (this.getToolboxOpened()) {
      this.closeToolbox();

      return;
    }

    // Determine target block: reuse any empty block, or create a new one
    const hoveredBlock = this.hoveredBlockInternal;
    const isParagraph = hoveredBlock?.name === 'paragraph';
    const startsWithSlash = isParagraph && hoveredBlock.pluginsContent.textContent?.startsWith('/');

    // Reuse the hovered block if it's empty (any type, not just paragraphs).
    // If hoveredBlock is not empty (e.g. a table), check if the focused block
    // is empty and nested inside it (e.g. an empty paragraph in a table cell).
    const currentBlock = BlockManager.currentBlock ?? null;
    const emptyBlockToReuse = hoveredBlock !== null && hoveredBlock.isEmpty
      ? hoveredBlock
      : currentBlock !== null && currentBlock !== hoveredBlock && currentBlock.isEmpty
          && hoveredBlock !== null && hoveredBlock.holder.contains(currentBlock.holder)
        ? currentBlock
        : null;

    // Calculate insert index based on direction
    const hoveredBlockIndex = hoveredBlock !== null
      ? BlockManager.getBlockIndex(hoveredBlock)
      : BlockManager.currentBlockIndex;
    const baseInsertIndex = insertAbove ? hoveredBlockIndex : hoveredBlockIndex + 1;

    // When inserting below, skip past any blocks nested inside another block's
    // DOM (e.g. paragraph blocks inside table cells). The block array may
    // interleave nested blocks from multiple parents, so check whether each
    // block's holder lives inside any block-wrapper ancestor rather than only
    // the hovered block's holder.
    const blocksAfterInsert = BlockManager.blocks.slice(baseInsertIndex);
    const isNested = (block: Block): boolean =>
      block.holder.parentElement?.closest('[data-blok-testid="block-wrapper"]') !== null;
    const firstNonNestedOffset = !insertAbove && hoveredBlock && blocksAfterInsert.length > 0
      ? blocksAfterInsert.findIndex((block) => !isNested(block))
      : 0;
    const insertIndex = baseInsertIndex + (firstNonNestedOffset === -1 ? blocksAfterInsert.length : firstNonNestedOffset);

    const targetBlock = startsWithSlash
      ? hoveredBlock
      : emptyBlockToReuse !== null
        ? emptyBlockToReuse
        : BlockManager.insertDefaultBlockAtIndex(insertIndex, true);

    // The DOM insertion may place the new block's holder inside a nested
    // container (e.g. a table cell) because the previous block in the array
    // is inside another block's DOM. Move the holder to be a sibling after
    // the hovered block so it becomes a top-level block.
    if (targetBlock !== hoveredBlock && emptyBlockToReuse === null && isNested(targetBlock)) {
      hoveredBlock?.holder.after(targetBlock.holder);
    }

    // Position caret and open toolbox
    if (startsWithSlash) {
      // Block already has "/" - keep slash-search mode, position after the slash
      Caret.setToBlock(targetBlock, Caret.positions.DEFAULT, 1);
      this.moveAndOpenToolbar(targetBlock);
      this.openToolbox();
    } else {
      // New empty block - open toolbox directly without inserting "/"
      Caret.setToBlock(targetBlock, Caret.positions.START);
      this.moveAndOpenToolbar(targetBlock);
      this.openToolboxWithoutSlash();
    }
  }
}
