import { TAB_STRING } from './constants';

/**
 * Handle keydown events inside the code block.
 * Returns true if the event was handled (caller should preventDefault).
 */
export function handleCodeKeydown(
  event: KeyboardEvent,
  codeElement: HTMLElement,
  onExit: () => void
): boolean {
  if (event.key === 'Enter' && event.shiftKey) {
    onExit();
    return true;
  }

  if (event.key === 'Enter') {
    insertNewline(codeElement);
    return true;
  }

  if (event.key === 'Tab' && !event.shiftKey) {
    insertTab();
    return true;
  }

  if (event.key === 'Tab' && event.shiftKey) {
    removeTab(codeElement);
    return true;
  }

  return false;
}

/**
 * Map of opening brackets to their matching closers. Used by Enter handling to
 * decide whether the caret sits between a paired set of brackets, in which
 * case the closer is pushed to its own dedented line and the caret lands on
 * an indented middle line — same shape as VSCode/JetBrains defaults.
 */
const BRACKET_PAIRS: Record<string, string> = {
  '{': '}',
  '(': ')',
  '[': ']',
};

function insertNewline(codeElement: HTMLElement): void {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);

  const startOffset = computeCaretOffset(codeElement, range.startContainer, range.startOffset);
  const endOffset = computeCaretOffset(codeElement, range.endContainer, range.endOffset);

  const text = codeElement.textContent ?? '';
  const before = text.substring(0, startOffset);
  const after = text.substring(endOffset);

  // Leading whitespace of the line where the caret sits — auto-indent baseline.
  const lineStart = before.lastIndexOf('\n') + 1;
  const indentMatch = before.substring(lineStart).match(/^[ \t]*/);
  const indent = indentMatch ? indentMatch[0] : '';

  const charBefore = before.length > 0 ? before.charAt(before.length - 1) : '';
  const expectedCloser = BRACKET_PAIRS[charBefore];
  const charAfter = after.charAt(0);

  const { inserted, caretDelta } = computeNewlineInsertion({
    indent,
    afterOpener: expectedCloser !== undefined,
    betweenMatchedPair: expectedCloser !== undefined && charAfter === expectedCloser,
  });

  while (codeElement.firstChild) {
    codeElement.removeChild(codeElement.firstChild);
  }
  codeElement.appendChild(document.createTextNode(before + inserted + after));

  restoreCaretOffset(codeElement, startOffset + caretDelta);
}

function computeNewlineInsertion(opts: {
  indent: string;
  afterOpener: boolean;
  betweenMatchedPair: boolean;
}): { inserted: string; caretDelta: number } {
  const { indent, afterOpener, betweenMatchedPair } = opts;

  if (betweenMatchedPair) {
    return {
      inserted: `\n${indent}${TAB_STRING}\n${indent}`,
      caretDelta: 1 + indent.length + TAB_STRING.length,
    };
  }

  if (afterOpener) {
    return {
      inserted: `\n${indent}${TAB_STRING}`,
      caretDelta: 1 + indent.length + TAB_STRING.length,
    };
  }

  return {
    inserted: `\n${indent}`,
    caretDelta: 1 + indent.length,
  };
}

function computeCaretOffset(root: HTMLElement, container: Node, offset: number): number {
  const range = document.createRange();

  range.selectNodeContents(root);
  range.setEnd(container, offset);

  return range.toString().length;
}

function insertTab(): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);
  range.deleteContents();

  const tab = document.createTextNode(TAB_STRING);
  range.insertNode(tab);
  range.setStartAfter(tab);
  range.collapse(true);

  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Count leading spaces on the line (up to TAB_STRING length).
 */
function countLeadingSpaces(lineContent: string): number {
  const limit = Math.min(TAB_STRING.length, lineContent.length);
  const match = lineContent.substring(0, limit).match(/^ */);

  return match ? match[0].length : 0;
}

function removeTab(codeElement: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);
  const textContent = codeElement.textContent ?? '';

  const preCaretRange = range.cloneRange();
  preCaretRange.selectNodeContents(codeElement);
  preCaretRange.setEnd(range.startContainer, range.startOffset);

  const caretOffset = preCaretRange.toString().length;
  const lineStart = textContent.lastIndexOf('\n', caretOffset - 1) + 1;
  const lineContent = textContent.substring(lineStart);

  const spacesToRemove = countLeadingSpaces(lineContent);

  if (spacesToRemove === 0) return;

  const before = textContent.substring(0, lineStart);
  const after = textContent.substring(lineStart + spacesToRemove);
  const updated = before + after;

  // Replace text by clearing children and inserting a new text node
  while (codeElement.firstChild) {
    codeElement.removeChild(codeElement.firstChild);
  }
  codeElement.appendChild(document.createTextNode(updated));

  const newCaretOffset = Math.max(lineStart, caretOffset - spacesToRemove);
  restoreCaretOffset(codeElement, newCaretOffset);
}

function restoreCaretOffset(element: HTMLElement, offset: number): void {
  const selection = window.getSelection();
  if (!selection) return;

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);

  const findNode = (accumulated: number): void => {
    const current = walker.nextNode();
    if (!current) return;

    const nodeLength = (current.textContent ?? '').length;

    if (accumulated + nodeLength >= offset) {
      const range = document.createRange();
      range.setStart(current, offset - accumulated);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }

    findNode(accumulated + nodeLength);
  };

  findNode(0);
}
