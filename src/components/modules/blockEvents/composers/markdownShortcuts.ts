import { HEADER_PATTERN, CHECKLIST_PATTERN, UNORDERED_LIST_PATTERN, ORDERED_LIST_PATTERN, HEADER_TOOL_NAME, LIST_TOOL_NAME } from '../constants';
import { BlockEventComposer } from './__base';
import type { Block } from '../../../block';

/**
 * MarkdownShortcuts Composer handles markdown-like shortcuts for auto-converting to lists or headers.
 *
 * Shortcuts are triggered by typing a space after the pattern:
 * - Lists: "- ", "* ", "1. ", "1) ", "[] ", "[x] "
 * - Headers: "# ", "## ", etc. (or custom shortcuts configured in header tool)
 *
 * Preserves HTML content and maintains caret position after conversion.
 */
export class MarkdownShortcuts extends BlockEventComposer {
  /**
   * Handle input events to detect markdown shortcuts.
   * Only processes insertText events that end with a space.
   * @param event - input event
   * @returns true if a shortcut was triggered and handled
   */
  public handleInput(event: InputEvent): boolean {
    if (event.inputType !== 'insertText' || event.data !== ' ') {
      return false;
    }

    const handledList = this.handleListShortcut();
    const handledHeader = this.handleHeaderShortcut();

    return handledList || handledHeader;
  }

  /**
   * Check if current block content matches a list shortcut pattern
   * and convert to appropriate list type.
   */
  private handleListShortcut(): boolean {
    const { BlockManager, Tools } = this.Blok;
    const currentBlock = BlockManager.currentBlock;

    if (!currentBlock) {
      return false;
    }

    if (!currentBlock.tool.isDefault) {
      return false;
    }

    const listTool = Tools.blockTools.get(LIST_TOOL_NAME);

    if (!listTool) {
      return false;
    }

    const currentInput = currentBlock.currentInput;

    if (!currentInput) {
      return false;
    }

    const textContent = currentInput.textContent || '';

    const depthAttr = currentBlock.holder.getAttribute('data-blok-depth');
    const depth = depthAttr ? parseInt(depthAttr, 10) : 0;

    const checklistMatch = CHECKLIST_PATTERN.exec(textContent);

    if (checklistMatch) {
      this.Blok.YjsManager.stopCapturing();

      const isChecked = checklistMatch[1]?.toLowerCase() === 'x';
      const shortcutLength = checklistMatch[1] !== undefined ? 4 : 3;
      const remainingHtml = this.extractRemainingHtml(currentInput, shortcutLength);
      const caretOffset = this.getCaretOffset(currentInput) - shortcutLength;

      const newBlock = BlockManager.replace(currentBlock, LIST_TOOL_NAME, {
        text: remainingHtml,
        style: 'checklist',
        checked: isChecked,
        ...(depth > 0 ? { depth } : {}),
      });

      this.setCaretAfterConversion(newBlock, caretOffset);

      this.Blok.YjsManager.stopCapturing();

      return true;
    }

    const unorderedMatch = UNORDERED_LIST_PATTERN.exec(textContent);

    if (unorderedMatch) {
      this.Blok.YjsManager.stopCapturing();

      const shortcutLength = 2;
      const remainingHtml = this.extractRemainingHtml(currentInput, shortcutLength);
      const caretOffset = this.getCaretOffset(currentInput) - shortcutLength;

      const newBlock = BlockManager.replace(currentBlock, LIST_TOOL_NAME, {
        text: remainingHtml,
        style: 'unordered',
        checked: false,
        ...(depth > 0 ? { depth } : {}),
      });

      this.setCaretAfterConversion(newBlock, caretOffset);

      this.Blok.YjsManager.stopCapturing();

      return true;
    }

    const orderedMatch = ORDERED_LIST_PATTERN.exec(textContent);

    if (!orderedMatch) {
      return false;
    }

    this.Blok.YjsManager.stopCapturing();

    const startNumber = parseInt(orderedMatch[1], 10);
    const shortcutLength = orderedMatch[1].length + 2;
    const remainingHtml = this.extractRemainingHtml(currentInput, shortcutLength);
    const caretOffset = this.getCaretOffset(currentInput) - shortcutLength;

    const listData: { text: string; style: string; checked: boolean; start?: number; depth?: number } = {
      text: remainingHtml,
      style: 'ordered',
      checked: false,
    };

    if (startNumber !== 1) {
      listData.start = startNumber;
    }

    if (depth > 0) {
      listData.depth = depth;
    }

    const newBlock = BlockManager.replace(currentBlock, LIST_TOOL_NAME, listData);

    this.setCaretAfterConversion(newBlock, caretOffset);

    this.Blok.YjsManager.stopCapturing();

    return true;
  }

  /**
   * Check if current block matches a header shortcut pattern and convert it.
   */
  private handleHeaderShortcut(): boolean {
    const { BlockManager, Tools } = this.Blok;
    const currentBlock = BlockManager.currentBlock;

    if (!currentBlock?.tool.isDefault) {
      return false;
    }

    const headerTool = Tools.blockTools.get(HEADER_TOOL_NAME);

    if (!headerTool) {
      return false;
    }

    const currentInput = currentBlock.currentInput;

    if (!currentInput) {
      return false;
    }

    const textContent = currentInput.textContent || '';
    const { levels, shortcuts } = headerTool.settings as { levels?: number[]; shortcuts?: Record<number, string> };
    const match = shortcuts === undefined
      ? this.matchDefaultHeaderShortcut(textContent)
      : this.matchCustomHeaderShortcut(textContent, shortcuts);

    if (!match || (levels && !levels.includes(match.level))) {
      return false;
    }

    this.Blok.YjsManager.stopCapturing();

    const remainingHtml = this.extractRemainingHtml(currentInput, match.shortcutLength);
    const caretOffset = this.getCaretOffset(currentInput) - match.shortcutLength;

    const newBlock = BlockManager.replace(currentBlock, HEADER_TOOL_NAME, {
      text: remainingHtml,
      level: match.level,
    });

    this.setCaretAfterConversion(newBlock, caretOffset);

    this.Blok.YjsManager.stopCapturing();

    return true;
  }

  /**
   * Match default header shortcuts like "# ", "## ", etc.
   */
  private matchDefaultHeaderShortcut(text: string): { level: number; shortcutLength: number } | null {
    const match = HEADER_PATTERN.exec(text);

    return match ? { level: match[1].length, shortcutLength: match[1].length + 1 } : null;
  }

  /**
   * Match custom header shortcuts configured in the header tool.
   */
  private matchCustomHeaderShortcut(
    text: string,
    shortcuts: Record<number, string>
  ): { level: number; shortcutLength: number } | null {
    for (const [levelStr, prefix] of Object.entries(shortcuts).sort((a, b) => b[1].length - a[1].length)) {
      if (text.length <= prefix.length || !text.startsWith(prefix)) {
        continue;
      }

      const charAfterPrefix = text.charCodeAt(prefix.length);

      if (charAfterPrefix === 32 || charAfterPrefix === 160) {
        return { level: parseInt(levelStr, 10), shortcutLength: prefix.length + 1 };
      }
    }

    return null;
  }

  /**
   * Extract HTML content after a shortcut prefix.
   */
  private extractRemainingHtml(input: HTMLElement, shortcutLength: number): string {
    const innerHTML = input.innerHTML || '';

    const temp = document.createElement('div');

    temp.innerHTML = innerHTML;

    const walker = document.createTreeWalker(temp, NodeFilter.SHOW_TEXT, null);
    const nodesToModify = this.collectNodesToModify(walker, shortcutLength);

    for (const { node, removeCount } of nodesToModify) {
      const text = node.textContent || '';

      if (removeCount >= text.length) {
        node.remove();
      } else {
        node.textContent = text.slice(removeCount);
      }
    }

    return temp.innerHTML;
  }

  /**
   * Collect text nodes that need modification to remove shortcut characters.
   */
  private collectNodesToModify(
    walker: TreeWalker,
    charsToRemove: number
  ): Array<{ node: Text; removeCount: number }> {
    const result: Array<{ node: Text; removeCount: number }> = [];

    if (charsToRemove <= 0 || !walker.nextNode()) {
      return result;
    }

    const textNode = walker.currentNode as Text;
    const nodeLength = textNode.textContent?.length || 0;

    if (nodeLength <= charsToRemove) {
      result.push({ node: textNode, removeCount: nodeLength });

      return result.concat(this.collectNodesToModify(walker, charsToRemove - nodeLength));
    }

    result.push({ node: textNode, removeCount: charsToRemove });

    return result;
  }

  /**
   * Get the current caret offset within the input element.
   */
  private getCaretOffset(input: HTMLElement): number {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return 0;
    }

    const range = selection.getRangeAt(0);

    const preCaretRange = document.createRange();

    preCaretRange.selectNodeContents(input);
    preCaretRange.setEnd(range.startContainer, range.startOffset);

    return preCaretRange.toString().length;
  }

  /**
   * Set caret position in the new block after conversion.
   */
  private setCaretAfterConversion(block: Block, offset: number): void {
    const { Caret } = this.Blok;

    if (offset <= 0) {
      Caret.setToBlock(block, Caret.positions.START);

      return;
    }

    Caret.setToBlock(block, Caret.positions.DEFAULT, offset);
  }
}
