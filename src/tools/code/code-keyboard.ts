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
    insertNewline();
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

function insertNewline(): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);
  range.deleteContents();

  const newline = document.createTextNode('\n');
  range.insertNode(newline);
  range.setStartAfter(newline);
  range.collapse(true);

  selection.removeAllRanges();
  selection.addRange(range);
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
