import { describe, it, expect, beforeEach } from 'vitest';
import { findRanges } from '../../../../../src/components/modules/find/text-index';

const mount = (html: string): HTMLElement => {
  document.body.innerHTML = `<div id="root">${html}</div>`;
  const root = document.getElementById('root');

  if (root === null) {
    throw new Error('root missing');
  }

  return root;
};

const found = (root: HTMLElement, query: string, options = {}): string[] =>
  findRanges(root, query, options).map((range) => range.toString());

describe('findRanges', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds matches in document order across blocks', () => {
    const root = mount('<div contenteditable="true">one apple</div><div contenteditable="true">two apples</div>');

    expect(found(root, 'apple')).toEqual(['apple', 'apple']);
  });

  it('matches across inline formatting inside one block', () => {
    const root = mount('<div contenteditable="true">a <b>bo</b><i>ld</i> move</div>');
    const [range] = findRanges(root, 'bold');

    expect(range.toString()).toBe('bold');
    expect(range.startContainer.textContent).toBe('bo');
    expect(range.endContainer.textContent).toBe('ld');
  });

  it('never matches across two blocks', () => {
    const root = mount('<div contenteditable="true">end of one</div><div contenteditable="true">two starts</div>');

    expect(found(root, 'one two')).toEqual([]);
  });

  it('skips tool chrome like list markers and toggle arrows', () => {
    const root = mount('<div><span data-blok-chrome>1.</span><div contenteditable="true">1. item</div></div>');

    expect(found(root, '1.')).toEqual(['1.']);
    expect(findRanges(root, '1.')[0].startContainer.parentElement?.hasAttribute('contenteditable')).toBe(true);
  });

  it('finds text in read-only content', () => {
    const root = mount('<div contenteditable="false">read only words</div>');

    expect(found(root, 'only')).toEqual(['only']);
  });

  it('finds text hidden inside a collapsed container', () => {
    const root = mount('<div class="hidden" aria-hidden="true"><div contenteditable="true">secret word</div></div>');

    expect(found(root, 'secret')).toEqual(['secret']);
  });

  it('treats a line break as whitespace, so a match can wrap onto the next line', () => {
    const root = mount('<div contenteditable="true">hello<br>world</div>');
    const [range] = findRanges(root, 'hello world');

    expect(range.startContainer.textContent).toBe('hello');
    expect(range.endContainer.textContent).toBe('world');
    expect(range.endOffset).toBe(5);
  });

  it('ignores form fields, scripts and styles', () => {
    const root = mount('<textarea>apple</textarea><style>.apple{}</style><div contenteditable="true">apple</div>');

    expect(found(root, 'apple')).toEqual(['apple']);
  });

  it('passes case and whole-word options through', () => {
    const root = mount('<div contenteditable="true">Cat cat concat</div>');

    expect(found(root, 'cat', { matchCase: true })).toEqual(['cat', 'cat']);
    expect(found(root, 'cat', { matchCase: true, wholeWord: true })).toEqual(['cat']);
  });

  it('finds matches in nested blocks in their own right', () => {
    const root = mount(
      '<div data-blok-element><div contenteditable="true">parent</div>' +
      '<div data-blok-element><div contenteditable="true">child parent</div></div></div>'
    );

    expect(found(root, 'parent')).toEqual(['parent', 'parent']);
  });
});
