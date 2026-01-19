import { Module } from '../__module';
import type { Block } from '../block';
import { Dom as $ } from '../dom';
import { SelectionUtils as Selection } from '../selection/index';
import { getCaretXPosition, isCaretAtEndOfInput, isCaretAtFirstLine, isCaretAtLastLine, isCaretAtStartOfInput, setCaretAtXPosition } from '../utils/caret/index';

const ASCII_MAX_CODE_POINT = 0x7f;

/**
 * Determines whether the provided text is comprised only of punctuation and whitespace characters.
 * @param text - text to check
 */
const isPunctuationOnly = (text: string): boolean => {
  for (const character of text) {
    if (character.trim().length === 0) {
      continue;
    }

    if (character >= '0' && character <= '9') {
      return false;
    }

    if (character.toLowerCase() !== character.toUpperCase()) {
      return false;
    }

    const codePoint = character.codePointAt(0);

    if (typeof codePoint === 'number' && codePoint > ASCII_MAX_CODE_POINT) {
      return false;
    }
  }

  return true;
};

const collectTextNodes = (node: Node): Text[] => {
  if (node.nodeType === Node.TEXT_NODE) {
    return [ node as Text ];
  }

  if (!node.hasChildNodes?.()) {
    return [];
  }

  return Array.from(node.childNodes).flatMap((child) => collectTextNodes(child));
};

/**
 * Finds last text node suitable for placing caret near the end of the element.
 *
 * Prefers nodes that contain more than just punctuation so caret remains inside formatting nodes
 * whenever possible.
 * @param root - element to search within
 */
const findLastMeaningfulTextNode = (root: HTMLElement): Text | null => {
  const textNodes = collectTextNodes(root);

  if (textNodes.length === 0) {
    return null;
  }

  const lastTextNode = textNodes[textNodes.length - 1];
  const lastMeaningfulNode = [ ...textNodes ]
    .reverse()
    .find((node) => !isPunctuationOnly(node.textContent ?? '')) ?? null;

  if (
    lastMeaningfulNode &&
    lastMeaningfulNode !== lastTextNode &&
    isPunctuationOnly(lastTextNode.textContent ?? '') &&
    lastMeaningfulNode.parentNode !== root
  ) {
    return lastMeaningfulNode;
  }

  return lastTextNode;
};

/**
 * Caret
 * Contains methods for working Caret
 * @todo get rid of this module and separate it for utility functions
 */
export class Caret extends Module {
  /**
   * Allowed caret positions in input
   * @static
   * @returns {{START: string, END: string, DEFAULT: string}}
   */
  public get positions(): { START: string; END: string; DEFAULT: string } {
    return {
      START: 'start',
      END: 'end',
      DEFAULT: 'default',
    };
  }

  /**
   * Data attributes used by Caret Module
   */
  private static get DATA_ATTR(): { shadowCaret: string } {
    return {
      shadowCaret: 'data-blok-shadow-caret',
    };
  }

  /**
   * Method gets Block instance and puts caret to the text node with offset
   * There two ways that method applies caret position:
   * - first found text node: sets at the beginning, but you can pass an offset
   * - last found text node: sets at the end of the node. Also, you can customize the behaviour
   * @param {Block} block - Block class
   * @param {string} position - position where to set caret.
   *                            If default - leave default behaviour and apply offset if it's passed
   * @param {number} offset - caret offset regarding to the block content
   */
  public setToBlock(block: Block, position: string = this.positions.DEFAULT, offset = 0): void {
    const { BlockManager, BlockSelection } = this.Blok;

    /**
     * Clear previous selection since we possible will select the new Block
     */
    BlockSelection.clearSelection();

    /**
     * If Block is not focusable, just select (highlight) it
     */
    if (!block.focusable) {
      /**
       * Hide current cursor
       */
      window.getSelection()?.removeAllRanges();

      /**
       * Highlight Block
       */
      BlockSelection.selectBlock(block);
      BlockManager.currentBlock = block;

      return;
    }

    const getElement = (): HTMLElement | undefined => {
      if (position === this.positions.START) {
        return block.firstInput;
      }

      if (position === this.positions.END) {
        return block.lastInput;
      }

      return block.currentInput;
    };

    const element = getElement();

    if (!element) {
      return;
    }

    const getNodeAndOffset = (el: HTMLElement): { node: Node | null; offset: number } => {
      if (position === this.positions.START) {
        return {
          node: $.getDeepestNode(el, false),
          offset: 0,
        };
      }

      if (position === this.positions.END) {
        return this.resolveEndPositionNode(el);
      }

      const { node, offset: nodeOffset } = $.getNodeByOffset(el, offset);

      if (node) {
        return {
          node,
          offset: nodeOffset,
        };
      }

      // case for empty block's input
      return {
        node: $.getDeepestNode(el, false),
        offset: 0,
      };
    };

    const { node: nodeToSet, offset: offsetToSet } = getNodeAndOffset(element);

    if (!nodeToSet) {
      return;
    }

    this.set(nodeToSet as HTMLElement, offsetToSet);

    BlockManager.setCurrentBlockByChildNode(block.holder);

    const updatedBlock = BlockManager.currentBlock;
    if (updatedBlock) {
      updatedBlock.currentInput = element;
    }
  }

  /**
   * Calculates the node and offset when caret should be placed near element's end.
   * @param {HTMLElement} el - element to inspect
   */
  private resolveEndPositionNode(el: HTMLElement): { node: Node | null; offset: number } {
    const nodeToSet = $.getDeepestNode(el, true);

    if (nodeToSet instanceof HTMLElement && $.isNativeInput(nodeToSet)) {
      return {
        node: nodeToSet,
        offset: $.getContentLength(nodeToSet),
      };
    }

    const meaningfulTextNode = findLastMeaningfulTextNode(el);

    if (meaningfulTextNode) {
      return {
        node: meaningfulTextNode,
        offset: $.getContentLength(meaningfulTextNode),
      };
    }

    if (nodeToSet) {
      return {
        node: nodeToSet,
        offset: $.getContentLength(nodeToSet),
      };
    }

    return {
      node: null,
      offset: 0,
    };
  }

  /**
   * Set caret to the current input of current Block.
   * @param {HTMLElement} input - input where caret should be set
   * @param {string} position - position of the caret.
   *                            If default - leave default behaviour and apply offset if it's passed
   * @param {number} offset - caret offset regarding to the text node
   */
  public setToInput(input: HTMLElement, position: string = this.positions.DEFAULT, offset = 0): void {
    const { currentBlock } = this.Blok.BlockManager;

    this.setCaretToInputPosition(input, position, offset);

    if (currentBlock) {
      currentBlock.currentInput = input;
    }
  }

  /**
   * Sets caret to a block at a specific X position (horizontal coordinate).
   * Used for Notion-style vertical navigation to preserve horizontal caret position.
   * @param block - Block to set caret in
   * @param targetX - Target X coordinate, or null to use start/end position
   * @param atFirstLine - If true, place caret on first line; if false, place on last line
   */
  public setToBlockAtXPosition(block: Block, targetX: number | null, atFirstLine: boolean): void {
    const { BlockManager, BlockSelection } = this.Blok;

    BlockSelection.clearSelection();

    if (!block.focusable) {
      window.getSelection()?.removeAllRanges();
      BlockSelection.selectBlock(block);
      BlockManager.currentBlock = block;

      return;
    }

    const element = atFirstLine ? block.firstInput : block.lastInput;

    if (!element) {
      return;
    }

    if (targetX !== null) {
      setCaretAtXPosition(element, targetX, atFirstLine);
    } else {
      const position = atFirstLine ? this.positions.START : this.positions.END;

      this.setCaretToInputPosition(element, position, 0);
    }

    BlockManager.setCurrentBlockByChildNode(block.holder);
    const updatedBlock = BlockManager.currentBlock;
    if (updatedBlock) {
      updatedBlock.currentInput = element;
    }
  }

  /**
   * Sets caret to an input at a specific X position (horizontal coordinate).
   * Used for Notion-style vertical navigation to preserve horizontal caret position.
   * @param input - Input element to set caret in
   * @param targetX - Target X coordinate, or null to use start/end position
   * @param atFirstLine - If true, place caret on first line; if false, place on last line
   */
  public setToInputAtXPosition(input: HTMLElement, targetX: number | null, atFirstLine: boolean): void {
    const { currentBlock } = this.Blok.BlockManager;

    if (targetX !== null) {
      setCaretAtXPosition(input, targetX, atFirstLine);
    } else {
      const position = atFirstLine ? this.positions.START : this.positions.END;

      this.setCaretToInputPosition(input, position, 0);
    }

    if (currentBlock) {
      currentBlock.currentInput = input;
    }
  }

  /**
   * Internal method to handle caret positioning within an input
   * @param input - the input element
   * @param position - position type (START, END, DEFAULT)
   * @param offset - character offset for DEFAULT position
   */
  private setCaretToInputPosition(input: HTMLElement, position: string, offset: number): void {
    if (position === this.positions.START) {
      this.setCaretToStart(input);

      return;
    }

    if (position === this.positions.END) {
      this.setCaretToEnd(input);

      return;
    }

    // DEFAULT position: use getNodeByOffset to find the correct node for the given offset
    // This properly handles multi-node content and clamps out-of-bounds offsets
    this.setCaretToOffset(input, offset);
  }

  /**
   * Sets caret to the start of an input
   * @param input - the input element
   */
  private setCaretToStart(input: HTMLElement): void {
    const nodeToSet = $.getDeepestNode(input, false);

    if (!nodeToSet) {
      return;
    }

    this.set(nodeToSet as HTMLElement, 0);
  }

  /**
   * Sets caret to the end of an input
   * @param input - the input element
   */
  private setCaretToEnd(input: HTMLElement): void {
    const nodeToSet = $.getDeepestNode(input, true);

    if (!nodeToSet) {
      return;
    }

    this.set(nodeToSet as HTMLElement, $.getContentLength(nodeToSet));
  }

  /**
   * Sets caret at a specific offset within an input
   * Falls back to end position if offset resolution fails
   * @param input - the input element
   * @param offset - the character offset
   */
  private setCaretToOffset(input: HTMLElement, offset: number): void {
    const { node, offset: nodeOffset } = $.getNodeByOffset(input, offset);

    if (node) {
      this.set(node as HTMLElement, nodeOffset);

      return;
    }

    // Fallback to end of input for empty inputs or when offset resolution fails
    this.setCaretToEnd(input);
  }

  /**
   * Creates Document Range and sets caret to the element with offset
   * @param {HTMLElement} element - target node.
   * @param {number} offset - offset
   */
  public set(element: HTMLElement, offset = 0): void {
    const scrollOffset = 30;
    const { top, bottom } = Selection.setCursor(element, offset);
    const { innerHeight } = window;

    /**
     * If new cursor position is not visible, scroll to it
     */
    if (top < 0) {
      window.scrollBy(0, top - scrollOffset);

      return;
    }

    if (bottom > innerHeight) {
      window.scrollBy(0, bottom - innerHeight + scrollOffset);
    }
  }

  /**
   * Set Caret to the last Block
   * If last block is not empty, append another empty block
   */
  public setToTheLastBlock(): void {
    const lastBlock = this.Blok.BlockManager.lastBlock;

    if (!lastBlock) {
      return;
    }

    /**
     * If last block is empty and it is an defaultBlock, set to that.
     * Otherwise, append new empty block and set to that
     */
    if (lastBlock.tool.isDefault && lastBlock.isEmpty) {
      this.setToBlock(lastBlock);
    } else {
      const newBlock = this.Blok.BlockManager.insertAtEnd();

      this.setToBlock(newBlock);
    }
  }

  /**
   * Extract content fragment of current Block from Caret position to the end of the Block
   */
  public extractFragmentFromCaretPosition(): void | DocumentFragment {
    const selection = Selection.get();

    if (!selection || !selection.rangeCount) {
      return;
    }

    const selectRange = selection.getRangeAt(0);
    const currentBlock = this.Blok.BlockManager.currentBlock;

    if (!currentBlock) {
      return;
    }

    const currentBlockInput = currentBlock.currentInput;

    selectRange.deleteContents();

    if (!currentBlockInput) {
      return;
    }

    if ($.isNativeInput(currentBlockInput)) {
      /**
       * If input is native text input we need to use it's value
       * Text before the caret stays in the input,
       * while text after the caret is returned as a fragment to be inserted after the block.
       */
      const input = currentBlockInput;
      const newFragment = document.createDocumentFragment();
      const selectionStart = input.selectionStart ?? 0;

      const inputRemainingText = input.value.substring(0, selectionStart);
      const fragmentText = input.value.substring(selectionStart);

      newFragment.textContent = fragmentText;
      input.value = inputRemainingText;

      return newFragment;
    }

    const range = selectRange.cloneRange();

    range.selectNodeContents(currentBlockInput);
    range.setStart(selectRange.endContainer, selectRange.endOffset);

    return range.extractContents();
  }

  /**
   * Set's caret to the next Block or Tool`s input
   * Before moving caret, we should check if caret position is at the end of Plugins node
   * Using {@link Dom#getDeepestNode} to get a last node and match with current selection
   * @param {boolean} force - pass true to skip check for caret position
   */
  public navigateNext(force = false): boolean {
    const { BlockManager } = this.Blok;
    const { currentBlock, nextBlock } = BlockManager;

    if (currentBlock === undefined) {
      return false;
    }

    const { nextInput, currentInput } = currentBlock;
    const isAtEnd = currentInput !== undefined ? isCaretAtEndOfInput(currentInput) : undefined;

    /**
     * We should jump to the next block if:
     * - 'force' is true (Tab-navigation)
     * - caret is at the end of the current block
     * - block does not contain any inputs (e.g. to allow go next when Delimiter is focused)
     */
    const navigationAllowed = force || isAtEnd || !currentBlock.focusable;

    /** If next Tool`s input exists, focus on it. Otherwise set caret to the next Block */
    if (nextInput && navigationAllowed) {
      this.setToInput(nextInput, this.positions.START);

      return true;
    }

    const getBlockToNavigate = (): Block | null => {
      if (nextBlock !== null) {
        return nextBlock;
      }

      /**
       * This code allows to exit from the last non-initial tool:
       * https://github.com/codex-team/editor.js/issues/1103
       */

      /**
       * 1. If there is a last block and it is default, do nothing
       * 2. If there is a last block and it is non-default --> and caret not at the end <--, do nothing
       *    (https://github.com/codex-team/editor.js/issues/1414)
       */
      if (currentBlock.tool.isDefault || !navigationAllowed) {
        return null;
      }

      /**
       * If there is no nextBlock, but currentBlock is not default,
       * insert new default block at the end and navigate to it
       */
      return BlockManager.insertAtEnd();
    };

    const blockToNavigate = getBlockToNavigate();

    if (blockToNavigate !== null && navigationAllowed) {
      this.setToBlock(blockToNavigate, this.positions.START);

      return true;
    }

    return false;
  }

  /**
   * Set's caret to the previous Tool`s input or Block
   * Before moving caret, we should check if caret position is start of the Plugins node
   * Using {@link Dom#getDeepestNode} to get a last node and match with current selection
   * @param {boolean} force - pass true to skip check for caret position
   */
  public navigatePrevious(force = false): boolean {
    const { currentBlock, previousBlock } = this.Blok.BlockManager;

    if (!currentBlock) {
      return false;
    }

    const { previousInput, currentInput } = currentBlock;

    /**
     * We should jump to the previous block if:
     * - 'force' is true (Tab-navigation)
     * - caret is at the start of the current block
     * - block does not contain any inputs (e.g. to allow go back when Delimiter is focused)
     */
    const caretAtStart = currentInput !== undefined ? isCaretAtStartOfInput(currentInput) : undefined;
    const navigationAllowed = force || caretAtStart || !currentBlock.focusable;

    /** If previous Tool`s input exists, focus on it. Otherwise set caret to the previous Block */
    if (previousInput && navigationAllowed) {
      this.setToInput(previousInput, this.positions.END);

      return true;
    }

    if (previousBlock !== null && navigationAllowed) {
      this.setToBlock(previousBlock, this.positions.END);

      return true;
    }

    return false;
  }

  /**
   * Helper method to navigate to a target block.
   * If target is focusable, sets caret to it; otherwise selects it.
   * @param targetBlock - Block to navigate to (or null)
   * @param atFirstLine - If true, place caret at first line; if false, at last line
   * @returns {boolean} - true if navigation occurred
   */
  private navigateToBlock(targetBlock: Block | null, atFirstLine: boolean): boolean {
    if (targetBlock === null) {
      return false;
    }

    const { BlockManager, BlockSelection } = this.Blok;

    BlockSelection.clearSelection();

    if (targetBlock.focusable) {
      this.setToBlockAtXPosition(targetBlock, null, atFirstLine);
    } else {
      BlockSelection.selectBlock(targetBlock);
      BlockManager.currentBlock = targetBlock;
    }

    return true;
  }

  /**
   * Navigates to the next block using vertical (Arrow Down) navigation.
   * Implements Notion-style behavior: line-by-line within block, then jump to next block.
   * Preserves horizontal caret position when moving between blocks.
   * @returns {boolean} - true if navigation to next block occurred
   */
  public navigateVerticalNext(): boolean {
    const { BlockManager } = this.Blok;
    const { currentBlock, nextBlock } = BlockManager;

    if (currentBlock === undefined) {
      return false;
    }

    /**
     * For non-focusable blocks (images, embeds, contentless), navigate to next block
     */
    if (!currentBlock.focusable) {
      return this.navigateToBlock(nextBlock, true);
    }

    /**
     * For empty blocks, jump immediately to the next block
     */
    if (currentBlock.isEmpty) {
      return this.navigateToBlock(nextBlock, true);
    }

    const { currentInput } = currentBlock;

    /**
     * Check if caret is at the last line - if not, let browser handle line navigation
     */
    const isAtLastLine = currentInput !== undefined ? isCaretAtLastLine(currentInput) : true;

    if (!isAtLastLine) {
      return false;
    }

    /**
     * Save the current caret X position before navigation
     */
    const caretX = getCaretXPosition();

    /**
     * Navigate to next input within the block first
     */
    const { nextInput } = currentBlock;

    if (nextInput) {
      this.setToInputAtXPosition(nextInput, caretX, true);

      return true;
    }

    /**
     * Navigate to next block, preserving horizontal position
     */
    if (nextBlock !== null) {
      this.setToBlockAtXPosition(nextBlock, caretX, true);

      return true;
    }

    /**
     * At the last block - check if we should create a new block
     */
    const isAtEnd = currentInput !== undefined ? isCaretAtEndOfInput(currentInput) : true;

    if (!currentBlock.tool.isDefault && isAtEnd) {
      const newBlock = BlockManager.insertAtEnd();

      this.setToBlock(newBlock, this.positions.START);

      return true;
    }

    return false;
  }

  /**
   * Navigates to the previous block using vertical (Arrow Up) navigation.
   * Implements Notion-style behavior: line-by-line within block, then jump to previous block.
   * Preserves horizontal caret position when moving between blocks.
   * @returns {boolean} - true if navigation to previous block occurred
   */
  public navigateVerticalPrevious(): boolean {
    const { BlockManager } = this.Blok;
    const { currentBlock, previousBlock } = BlockManager;

    if (currentBlock === undefined) {
      return false;
    }

    /**
     * For non-focusable blocks (images, embeds, contentless), navigate to previous block
     */
    if (!currentBlock.focusable) {
      return this.navigateToBlock(previousBlock, false);
    }

    /**
     * For empty blocks, jump immediately to the previous block
     */
    if (currentBlock.isEmpty) {
      return this.navigateToBlock(previousBlock, false);
    }

    const { currentInput } = currentBlock;

    /**
     * Check if caret is at the first line - if not, let browser handle line navigation
     */
    const isAtFirstLine = currentInput !== undefined ? isCaretAtFirstLine(currentInput) : true;

    if (!isAtFirstLine) {
      return false;
    }

    /**
     * Save the current caret X position before navigation
     */
    const caretX = getCaretXPosition();

    /**
     * Navigate to previous input within the block first
     */
    const { previousInput } = currentBlock;

    if (previousInput) {
      this.setToInputAtXPosition(previousInput, caretX, false);

      return true;
    }

    /**
     * Navigate to previous block, preserving horizontal position
     */
    if (previousBlock !== null) {
      this.setToBlockAtXPosition(previousBlock, caretX, false);

      return true;
    }

    return false;
  }

  /**
   * Inserts shadow element after passed element where caret can be placed
   * @param {Element} element - element after which shadow caret should be inserted
   */
  public createShadow(element: Element): void {
    const shadowCaret = document.createElement('span');

    shadowCaret.setAttribute(Caret.DATA_ATTR.shadowCaret, '');
    shadowCaret.setAttribute('data-blok-testid', 'shadow-caret');
    element.insertAdjacentElement('beforeend', shadowCaret);
  }

  /**
   * Restores caret position
   * @param {HTMLElement} element - element where caret should be restored
   */
  public restoreCaret(element: HTMLElement): void {
    const shadowCaret = element.querySelector('[data-blok-testid="shadow-caret"]');

    if (!shadowCaret) {
      return;
    }

    /**
     * After we set the caret to the required place
     * we need to clear shadow caret
     *
     * - make new range
     * - select shadowed span
     * - use extractContent to remove it from DOM
     */
    const sel = new Selection();

    sel.expandToTag(shadowCaret as HTMLElement);

    const newRange = document.createRange();

    newRange.selectNode(shadowCaret);
    newRange.extractContents();
  }

  /**
   * Inserts passed content at caret position
   * @param {string} content - content to insert
   */
  public insertContentAtCaretPosition(content: string): void {
    const fragment = document.createDocumentFragment();
    const wrapper = document.createElement('div');
    const selection = Selection.get();
    const range = Selection.range;

    if (!selection || !range) {
      return;
    }

    wrapper.innerHTML = content;

    Array.from(wrapper.childNodes).forEach((child: Node) => fragment.appendChild(child));

    /**
     * If there is no child node, append empty one
     */
    if (fragment.childNodes.length === 0) {
      fragment.appendChild(new Text());
    }

    const lastChild = fragment.lastChild as ChildNode;

    range.deleteContents();
    range.insertNode(fragment);

    /** Cross-browser caret insertion */
    const newRange = document.createRange();

    const nodeToSetCaret = lastChild.nodeType === Node.TEXT_NODE ? lastChild : lastChild.firstChild;

    if (nodeToSetCaret !== null && nodeToSetCaret.textContent !== null) {
      newRange.setStart(nodeToSetCaret, nodeToSetCaret.textContent.length);
    }

    selection.removeAllRanges();
    selection.addRange(newRange);
  }
}
