/**
 * Line geometry for the code area. One logical line can wrap onto several
 * visual rows (`whitespace-pre-wrap`), so the gutter and the active-line band
 * read row counts from the rendered text instead of assuming one row per line.
 */

/** Height of one visual row, from the code area's computed line-height. */
export function rowHeight(code: HTMLElement): number {
  const style = getComputedStyle(code);
  const lineHeight = parseFloat(style.lineHeight);

  if (Number.isFinite(lineHeight) && lineHeight > 0) {
    return lineHeight;
  }

  // `normal` has no pixel value; 1.2 is the usual UA approximation.
  return parseFloat(style.fontSize) * 1.2 || 0;
}

function textPosition(root: Node, target: number): { node: Node; offset: number } | null {
  const walker = (root.ownerDocument ?? document).createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const step = (consumed: number): { node: Node; offset: number } | null => {
    const next = walker.nextNode() as Text | null;

    if (!next) {
      return null;
    }

    const length = next.data.length;

    return consumed + length >= target ? { node: next, offset: target - consumed } : step(consumed + length);
  };

  return step(0);
}

/** Visual rows one non-empty line occupies, read from its text's client rects. */
function rowsOf(code: HTMLElement, start: number, end: number, row: number): number {
  const from = textPosition(code, start);
  const to = textPosition(code, end);

  if (!from || !to) {
    return 1;
  }

  const range = code.ownerDocument.createRange();

  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);

  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0);

  if (rects.length === 0) {
    return 1;
  }

  const top = Math.min(...rects.map((rect) => rect.top));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));

  return Math.max(1, Math.round((bottom - top) / row));
}

/**
 * Visual rows per logical line. Skips per-line measuring when the text has no
 * wrapped line at all, which is the common case and keeps typing cheap.
 */
export function measureLineRows(code: HTMLElement): number[] {
  const text = code.textContent ?? '';
  const lines = text.split('\n');
  const row = rowHeight(code);
  const style = getComputedStyle(code);
  const contentHeight = code.clientHeight - parseFloat(style.paddingTop || '0') - parseFloat(style.paddingBottom || '0');

  if (row <= 0 || Math.round(contentHeight / row) <= lines.length) {
    return lines.map(() => 1);
  }

  const starts = lines.reduce<number[]>((acc, line, index) => [...acc, index === 0 ? 0 : acc[index - 1] + lines[index - 1].length + 1], []);

  return lines.map((line, index) => (line === '' ? 1 : rowsOf(code, starts[index], starts[index] + line.length, row)));
}

/** Logical line holding a collapsed caret inside `code`, or null when there is none. */
export function caretLineIndex(code: HTMLElement): number | null {
  const selection = code.ownerDocument.getSelection();

  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
    return null;
  }

  const caret = selection.getRangeAt(0);

  if (!code.contains(caret.startContainer)) {
    return null;
  }

  const before = code.ownerDocument.createRange();

  before.selectNodeContents(code);
  before.setEnd(caret.startContainer, caret.startOffset);

  return before.toString().split('\n').length - 1;
}
