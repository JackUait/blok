import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cutBlockToRange, sliceHtmlByText } from '../../../../src/components/utils/range-cut';

describe('sliceHtmlByText', () => {
  it('keeps the marks around the kept text', () => {
    expect(sliceHtmlByText('RO <b>bold</b> para', 5, 12)).toBe('<b>ld</b> para');
  });

  it('cuts both ends', () => {
    expect(sliceHtmlByText('a <i>bc</i> d', 0, 3)).toBe('a <i>b</i>');
  });

  it('counts an entity as one character and keeps it escaped', () => {
    expect(sliceHtmlByText('a &amp; b &lt;c', 2, 7)).toBe('&amp; b &lt;');
  });
});

describe('cutBlockToRange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const mount = (html: string): HTMLElement => {
    document.body.innerHTML = html;

    return document.body.firstElementChild as HTMLElement;
  };

  const textPoint = (root: Node, needle: string, atEnd: boolean): [Node, number] => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const at = (node.textContent ?? '').indexOf(needle);

      if (at !== -1) {
        return [node, atEnd ? at + needle.length : at];
      }
    }
    throw new Error(`no ${needle}`);
  };

  const rangeBetween = (from: [Node, number], to: [Node, number]): Range => {
    const range = document.createRange();

    range.setStart(...from);
    range.setEnd(...to);

    return range;
  };

  it('reports a block the range covers fully as whole', () => {
    const holder = mount('<div data-blok-element><h2>RO heading</h2></div>');
    const range = document.createRange();

    range.selectNodeContents(document.body);

    expect(cutBlockToRange(holder, range)).toEqual({ kind: 'whole' });
  });

  it('cuts the text before the range start and keeps the tag', () => {
    const holder = mount('<div data-blok-element><h2>RO heading</h2></div><p>after</p>');
    const range = rangeBetween(textPoint(holder, 'heading', false), textPoint(document.body, 'after', true));

    expect(cutBlockToRange(holder, range)).toEqual({ kind: 'part', from: 3, to: 10, text: 'RO heading', html: '<h2>heading</h2>' });
  });

  it('leaves out tool chrome and nested blocks', () => {
    const holder = mount('<div data-blok-element><span data-blok-chrome>▶</span><div>RO toggle</div><div data-blok-element><p>RO child</p></div></div>');
    const range = rangeBetween([document.body, 0], textPoint(holder, 'RO tog', true));

    expect(cutBlockToRange(holder, range)).toEqual({ kind: 'part', from: 0, to: 6, text: 'RO toggle', html: '<div>RO tog</div>' });
  });

  it('reports a block whose own text is outside the range as none', () => {
    const holder = mount('<div data-blok-element><div>RO toggle</div><div data-blok-element><p>RO child</p></div></div>');
    const range = rangeBetween(textPoint(holder, 'child', false), [document.body, 1]);

    expect(cutBlockToRange(holder, range)).toEqual({ kind: 'none' });
  });

  it('reports a block the range does not reach as none', () => {
    mount('<p>before</p><div data-blok-element><img src="data:,"></div>');
    const holder = document.querySelector('[data-blok-element]') as HTMLElement;
    const range = rangeBetween(textPoint(document.body, 'before', false), textPoint(document.body, 'before', true));

    expect(cutBlockToRange(holder, range)).toEqual({ kind: 'none' });
  });
});
