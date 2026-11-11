import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { noteDeleteForNbsp, restoreDeletedBoundarySpace } from '../../../../src/components/utils/delete-boundary-nbsp';

const NBSP = ' ';

/**
 * Drives one native delete the way Chrome does it: beforeinput while the doomed
 * range is selected, then the DOM write Chrome makes, then input at the caret.
 */
const runDelete = (options: {
  html: string;
  select: (root: HTMLElement) => Range;
  /** The DOM Chrome leaves: new inner HTML, or an edit of the old DOM. */
  chromeWrite: string | ((root: HTMLElement) => void);
  caret: (root: HTMLElement) => [Node, number];
  inputType?: string;
}): HTMLElement => {
  const root = document.createElement('div');

  root.contentEditable = 'true';
  root.innerHTML = options.html;
  document.body.appendChild(root);

  const inputType = options.inputType ?? 'deleteByCut';
  const selection = window.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(options.select(root));
  noteDeleteForNbsp(new InputEvent('beforeinput', { inputType }), root);

  if (typeof options.chromeWrite === 'string') {
    root.innerHTML = options.chromeWrite;
  } else {
    options.chromeWrite(root);
  }
  const [node, offset] = options.caret(root);

  selection?.removeAllRanges();
  selection?.setBaseAndExtent(node, offset, node, offset);
  restoreDeletedBoundarySpace(new InputEvent('input', { inputType }), root);

  return root;
};

const textOf = (root: HTMLElement): string => root.innerHTML.replace(/&nbsp;/g, NBSP);

describe('delete-boundary-nbsp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('turns the nbsp Chrome writes after a cut at an inline boundary back into a space', () => {
    const root = runDelete({
      html: 'Alpha <b>bold</b> <i>ital</i> omega',
      select: (r) => {
        const range = document.createRange();

        range.setStart(r.querySelector('b')?.firstChild as Text, 1);
        range.setEnd(r.querySelector('i')?.firstChild as Text, 4);

        return range;
      },
      chromeWrite: `Alpha <b>b</b>${NBSP}omega`,
      caret: r => [r.lastChild as Text, 0],
    });

    expect(textOf(root)).toBe('Alpha <b>b</b> omega');
    expect(window.getSelection()?.focusNode).toBe(root.lastChild);
    expect(window.getSelection()?.focusOffset).toBe(0);
  });

  it('works for Backspace too', () => {
    const root = runDelete({
      html: 'Alpha <b>bold</b> <i>ital</i> omega',
      inputType: 'deleteContentBackward',
      select: (r) => {
        const range = document.createRange();

        range.setStart(r.querySelector('b')?.firstChild as Text, 1);
        range.setEnd(r.querySelector('i')?.firstChild as Text, 4);

        return range;
      },
      chromeWrite: `Alpha <b>b</b>${NBSP}omega`,
      caret: r => [r.querySelector('b')?.firstChild as Text, 1],
    });

    expect(textOf(root)).toBe('Alpha <b>b</b> omega');
  });

  it('keeps an nbsp the text already had when the delete adds none', () => {
    const root = runDelete({
      html: `10${NBSP}akm`,
      inputType: 'deleteContentBackward',
      select: (r) => {
        const range = document.createRange();

        range.setStart(r.firstChild as Text, 3);
        range.setEnd(r.firstChild as Text, 4);

        return range;
      },
      chromeWrite: (r) => {
        (r.firstChild as Text).deleteData(3, 1);
      },
      caret: r => [r.firstChild as Text, 3],
    });

    expect(textOf(root)).toBe(`10${NBSP}km`);
  });

  const keeps: Array<[string, string, (r: HTMLElement) => [Node, number]]> = [
    ['a leading nbsp', `${NBSP}omega`, r => [r.firstChild as Text, 0]],
    ['a trailing nbsp', `<b>b</b>${NBSP}`, r => [r.lastChild as Text, 0]],
    ['a double nbsp', `<b>b</b>${NBSP}${NBSP}omega`, r => [r.lastChild as Text, 0]],
    ['an nbsp next to a br', `<b>b</b>${NBSP}<br>omega`, r => [r.childNodes[1], 0]],
    ['an nbsp inside code', `<code>a${NBSP}b</code>`, r => [r.querySelector('code')?.firstChild as Text, 1]],
  ];

  it.each(keeps)('keeps %s Chrome needs to draw', (_label, after, caret) => {
    const root = runDelete({
      html: '<b>bold</b> x',
      select: (r) => {
        const range = document.createRange();

        range.setStart(r.querySelector('b')?.firstChild as Text, 1);
        range.setEnd(r.querySelector('b')?.firstChild as Text, 4);

        return range;
      },
      chromeWrite: after,
      caret,
    });

    expect(textOf(root)).toBe(after);
  });

  it('does nothing on an input that had no beforeinput (Blok\'s own cut)', () => {
    const root = document.createElement('div');

    root.contentEditable = 'true';
    root.innerHTML = `Alpha <b>b</b>${NBSP}omega`;
    document.body.appendChild(root);
    window.getSelection()?.setBaseAndExtent(root.lastChild as Text, 0, root.lastChild as Text, 0);
    restoreDeletedBoundarySpace(new InputEvent('input', { inputType: 'deleteByCut' }), root);

    expect(textOf(root)).toBe(`Alpha <b>b</b>${NBSP}omega`);
  });
});
