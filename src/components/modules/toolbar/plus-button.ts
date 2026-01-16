import type { Block } from '../../block';
import type { BlokModules } from '../../../types-internal/blok-modules';
import { createTooltipContent } from './tooltip';
import { Dom as $ } from '../../dom';
import { onHover } from '../../utils/tooltip';
import { IconPlus } from '../../icons';
import type { ToolbarNodes } from './types';
import { getUserOS } from '../../utils';
import { SelectionUtils } from '../../selection';

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
   * Callback to open the toolbox
   */
  private openToolbox: () => void;

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
      closeToolbox: () => void;
      moveAndOpenToolbar: (block?: Block | null, target?: Element | null) => void;
    }
  ) {
    this.getBlok = getBlok;
    this.getToolboxOpened = callbacks.getToolboxOpened;
    this.openToolbox = callbacks.openToolbox;
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
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- CSS getter now returns Tailwind classes
      blok.Toolbar.CSS.plusButton,
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

    // Determine target block: reuse empty/slash paragraph, or create new one
    const hoveredBlock = this.hoveredBlockInternal;
    const isParagraph = hoveredBlock?.name === 'paragraph';
    const startsWithSlash = isParagraph && hoveredBlock.pluginsContent.textContent?.startsWith('/');
    const isEmptyParagraph = isParagraph && hoveredBlock.isEmpty;

    // Calculate insert index based on direction
    const hoveredBlockIndex = hoveredBlock !== null
      ? BlockManager.getBlockIndex(hoveredBlock)
      : BlockManager.currentBlockIndex;
    const insertIndex = insertAbove ? hoveredBlockIndex : hoveredBlockIndex + 1;

    const targetBlock = isEmptyParagraph || startsWithSlash
      ? hoveredBlock
      : BlockManager.insertDefaultBlockAtIndex(insertIndex, true);

    // Insert "/" or position caret after existing one
    if (startsWithSlash) {
      Caret.setToBlock(targetBlock, Caret.positions.DEFAULT, 1);
    } else {
      Caret.setToBlock(targetBlock, Caret.positions.START);
      Caret.insertContentAtCaretPosition('/');
    }
    this.moveAndOpenToolbar(targetBlock);
    this.openToolbox();
  }
}
