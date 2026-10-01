import { describe, it, expect, beforeEach } from 'vitest';
import { caretLineIndex, measureLineRows } from '../../../../src/tools/code/line-geometry';

const codeWith = (html: string): HTMLElement => {
  const code = document.createElement('code');

  code.innerHTML = html;
  document.body.appendChild(code);

  return code;
};

const putCaret = (node: Node, offset: number): void => {
  const range = document.createRange();

  range.setStart(node, offset);
  range.collapse(true);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
};

describe('caretLineIndex', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.getSelection()?.removeAllRanges();
  });

  it('counts newlines before the caret across highlight spans', () => {
    const code = codeWith('<span class="token">a</span>\nb\n<span>cc</span>');
    const last = code.querySelectorAll('span')[1].firstChild;

    if (!last) throw new Error('no text');
    putCaret(last, 1);

    expect(caretLineIndex(code)).toBe(2);
  });

  it('puts a caret right after a newline on the next line', () => {
    const code = codeWith('a\nb');
    const text = code.firstChild;

    if (!text) throw new Error('no text');
    putCaret(text, 2);

    expect(caretLineIndex(code)).toBe(1);
  });

  it('is null for a caret outside the code', () => {
    const code = codeWith('a');
    const other = codeWith('b');

    if (!other.firstChild) throw new Error('no text');
    putCaret(other.firstChild, 0);

    expect(caretLineIndex(code)).toBeNull();
  });

  it('is null for a ranged selection', () => {
    const code = codeWith('abc');
    const range = document.createRange();

    if (!code.firstChild) throw new Error('no text');
    range.setStart(code.firstChild, 0);
    range.setEnd(code.firstChild, 2);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);

    expect(caretLineIndex(code)).toBeNull();
  });
});

describe('measureLineRows', () => {
  it('gives every line one row when nothing wraps', () => {
    expect(measureLineRows(codeWith('a\n\nb'))).toStrictEqual([1, 1, 1]);
  });
});
