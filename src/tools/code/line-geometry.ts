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

interface TextRun {
  node: Text;
  start: number;
}

/** Every text node under `root` with its starting offset, from one walk. */
function textRuns(root: Node): TextRun[] {
  const walker = (root.ownerDocument ?? document).createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const runs: TextRun[] = [];
  const total = { offset: 0 };

  // eslint-disable-next-line no-restricted-syntax -- TreeWalker requires iteration with nextNode()
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;

    runs.push({ node: text, start: total.offset });
    total.offset += text.data.length;
  }

  return runs;
}

/** The run holding `target`, by binary search. A boundary offset resolves to the earlier run's end. */
function positionIn(runs: TextRun[], target: number): { node: Text; offset: number } | null {
  if (runs.length === 0) {
    return null;
  }

  const search = (low: number, high: number): number => {
    if (low >= high) {
      return low;
    }

    const mid = Math.ceil((low + high) / 2);

    return runs[mid].start < target ? search(mid, high) : search(low, mid - 1);
  };

  const run = runs[search(0, runs.length - 1)];

  return { node: run.node, offset: Math.min(target - run.start, run.node.data.length) };
}

/** Visual rows one non-empty line occupies, read from its text's client rects. */
function rowsOf(code: HTMLElement, runs: TextRun[], start: number, end: number, row: number): number {
  const from = positionIn(runs, start + 1);
  const to = positionIn(runs, end);

  if (!from || !to) {
    return 1;
  }

  const range = code.ownerDocument.createRange();

  range.setStart(from.node, Math.max(0, from.offset - 1));
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

  const runs = textRuns(code);
  const starts = lines.reduce<number[]>((acc, _line, index) => {
    acc.push(index === 0 ? 0 : acc[index - 1] + lines[index - 1].length + 1);

    return acc;
  }, []);

  return lines.map((line, index) => (line === '' ? 1 : rowsOf(code, runs, starts[index], starts[index] + line.length, row)));
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
