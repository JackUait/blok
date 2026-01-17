import type { BlokModules } from '../../../../types-internal/blok-modules';
import type { InlineToolAdapter } from '../../../tools/inline';
import type { SelectionValidationResult } from './types';
import { Dom as $ } from '../../../dom';
import { SelectionUtils } from '../../../selection';

/**
 * InlineSelectionValidator determines if inline toolbar should be shown based on selection.
 *
 * Responsibilities:
 * - Check if selection is valid (not null, not collapsed, has content)
 * - Check if target element is compatible (not IMG/INPUT)
 * - Check if current block has inline tools available
 * - Check if target is contenteditable or in read-only mode with valid selection
 */
export class InlineSelectionValidator {
  /**
   * Getter function to access Blok modules dynamically
   */
  private getBlok: () => BlokModules;

  constructor(getBlok: () => BlokModules) {
    this.getBlok = getBlok;
  }

  /**
   * Check if inline toolbar can be shown
   */
  public canShow(): SelectionValidationResult {
    /**
     * Tags conflicts with window.selection function.
     * Ex. IMG tag returns null (Firefox) or Redactors wrapper (Chrome)
     */
    const tagsConflictsWithSelection = ['IMG', 'INPUT'];
    const currentSelection = this.resolveSelection();
    const selectedText = SelectionUtils.text;

    // old browsers
    if (!currentSelection || !currentSelection.anchorNode) {
      return { allowed: false, reason: 'Selection is null or has no anchor node' };
    }

    // empty selection
    if (currentSelection.isCollapsed || selectedText.length < 1) {
      return { allowed: false, reason: 'Selection is collapsed or empty' };
    }

    const target = !$.isElement(currentSelection.anchorNode)
      ? currentSelection.anchorNode.parentElement
      : currentSelection.anchorNode;

    if (target === null) {
      return { allowed: false, reason: 'Target element is null' };
    }

    if (tagsConflictsWithSelection.includes(target.tagName)) {
      return { allowed: false, reason: `Target tag ${target.tagName} conflicts with selection` };
    }

    const anchorElement = $.isElement(currentSelection.anchorNode)
      ? currentSelection.anchorNode as HTMLElement
      : currentSelection.anchorNode.parentElement;
    const { BlockManager } = this.getBlok();
    const blockFromAnchor = anchorElement
      ? BlockManager.getBlock(anchorElement)
      : null;
    const currentBlock = blockFromAnchor ?? BlockManager.currentBlock;

    if (currentBlock === null || currentBlock === undefined) {
      return { allowed: false, reason: 'Current block is null or undefined' };
    }

    const toolsAvailable = this.getTools();
    const isAtLeastOneToolAvailable = toolsAvailable.some((tool) => currentBlock.tool.inlineTools.has(tool.name));

    if (isAtLeastOneToolAvailable === false) {
      return { allowed: false, reason: 'No inline tools available for current block' };
    }

    const contenteditableSelector = '[contenteditable]';
    const contenteditableTarget = target.closest(contenteditableSelector);

    if (contenteditableTarget !== null) {
      return { allowed: true };
    }

    const blockHolder = currentBlock.holder;
    const holderContenteditable = blockHolder &&
      (
        blockHolder.matches(contenteditableSelector)
          ? blockHolder
          : blockHolder.closest(contenteditableSelector)
      );

    if (holderContenteditable) {
      return { allowed: true };
    }

    const { ReadOnly } = this.getBlok();

    if (ReadOnly.isEnabled) {
      return SelectionUtils.isSelectionAtBlok(currentSelection)
        ? { allowed: true }
        : { allowed: false, reason: 'Read-only mode and selection not at Blok' };
    }

    return { allowed: false, reason: 'Target is not contenteditable' };
  }

  /**
   * Returns tools that are available for current block
   */
  private getTools(): InlineToolAdapter[] {
    const { BlockManager, ReadOnly } = this.getBlok();
    const currentBlock = BlockManager.currentBlock
      ?? (() => {
        const selection = this.resolveSelection();
        const anchorNode = selection?.anchorNode;

        if (!anchorNode) {
          return null;
        }

        const anchorElement = $.isElement(anchorNode) ? anchorNode as HTMLElement : anchorNode.parentElement;

        if (!anchorElement) {
          return null;
        }

        return BlockManager.getBlock(anchorElement);
      })();

    if (!currentBlock) {
      return [];
    }

    return Array.from(currentBlock.tool.inlineTools.values()).filter((tool) => {
      return !(ReadOnly.isEnabled && tool.isReadOnlySupported !== true);
    });
  }

  /**
   * Resolves the current selection, handling test mocks
   */
  private resolveSelection(): Selection | null {
    const selectionOverride = (SelectionUtils as unknown as { selection?: Selection | null }).selection;

    if (selectionOverride !== undefined) {
      return selectionOverride;
    }

    const instanceOverride = (SelectionUtils as unknown as { instance?: Selection | null }).instance;

    if (instanceOverride !== undefined) {
      return instanceOverride;
    }

    return SelectionUtils.get();
  }
}
