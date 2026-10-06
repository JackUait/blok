import { describe, it, expect } from 'vitest';
import { htmlToSegmentsNode } from '../../../../src/view/rich-text-parse5';
import { htmlToSegmentsDom } from '../../../../src/components/utils/rich-text-dom';
import { isRichText } from '../../../../src/shared/rich-text/guards';
import { canonicalizeSegments } from '../../../../src/shared/rich-text/html-to-segments';
import type { RichText } from '../../../../types/rich-text';

const readers = [['parse5', htmlToSegmentsNode], ['dom', htmlToSegmentsDom]] as const;

describe.each(readers)('htmlToSegments (%s)', (_name, read) => {
  it('decodes entities into plain text', () => {
    expect(read('a &lt; b &amp;&amp; "c"')).toEqual([{ text: 'a < b && "c"' }]);
  });

  it('flattens nested marks into runs', () => {
    expect(read('<strong>bold <i>both</i></strong> plain')).toEqual([
      { text: 'bold ', marks: { bold: true } },
      { text: 'both', marks: { bold: true, italic: true } },
      { text: ' plain' },
    ]);
  });

  it('treats alias tags as the same mark', () => {
    expect(read('<b>a</b><strong>b</strong><em>c</em><del>d</del>')).toEqual([
      { text: 'ab', marks: { bold: true } },
      { text: 'c', marks: { italic: true } },
      { text: 'd', marks: { strikethrough: true } },
    ]);
  });

  it('reads preset and raw colours into separate keys', () => {
    expect(read('<mark style="color: var(--blok-color-red-text); background-color: #fbecdd;">x</mark>'))
      .toEqual([{ text: 'x', marks: { color: 'red', background: '#fbecdd' } }]);
  });

  it('drops a transparent background', () => {
    expect(read('<mark style="color: var(--blok-color-red-text); background-color: transparent;">x</mark>'))
      .toEqual([{ text: 'x', marks: { color: 'red' } }]);
  });

  it('reads a bare mark as highlight', () => {
    expect(read('<mark>x</mark>')).toEqual([{ text: 'x', marks: { highlight: true } }]);
  });

  it('reads links with only the attributes that were there', () => {
    expect(read('<a href="https://x.com">x</a>')).toEqual([{ text: 'x', marks: { link: { href: 'https://x.com' } } }]);
    expect(read('<a href="https://x.com" target="_blank" rel="noopener">x</a>'))
      .toEqual([{ text: 'x', marks: { link: { href: 'https://x.com', target: '_blank', rel: 'noopener' } } }]);
  });

  it('reads embeds', () => {
    expect(read('<span data-latex="E=mc^2">E=mc^2</span>')).toEqual([{ embed: { equation: { expression: 'E=mc^2' } } }]);
    expect(read('<a data-blok-page-id="p1">Page</a>')).toEqual([{ embed: { page: { id: 'p1' } } }]);
    expect(read('a<img src="x.png">b')).toEqual([{ text: 'a' }, { embed: { html: '<img src="x.png">' } }, { text: 'b' }]);
  });

  it('reads br as a line break and drops the contenteditable placeholder', () => {
    expect(read('a<br>b')).toEqual([{ text: 'a\nb' }]);
    expect(read('a<br>')).toEqual([{ text: 'a' }]);
    expect(read('a<br><br>')).toEqual([{ text: 'a\n' }]);
  });

  it('keeps unknown inline tags as custom marks', () => {
    expect(read('<abbr title="X &amp; Y">x</abbr>')).toEqual([{ text: 'x', marks: { 'tag:abbr': { title: 'X & Y' } } }]);
  });

  it.each([
    ['input', '<input type="checkbox" checked="">'],
    ['video', '<video src="v.mp4"></video>'],
    ['audio', '<audio src="a.mp3"></audio>'],
    ['iframe', '<iframe src="https://x.com"></iframe>'],
    ['svg', '<svg viewBox="0 0 1 1"><path d="M0 0"></path></svg>'],
    ['math', '<math><mi>x</mi></math>'],
    ['canvas', '<canvas width="2"></canvas>'],
    ['object', '<object data="x.pdf"></object>'],
    ['embed', '<embed src="x.swf">'],
    ['picture', '<picture><img src="x.png"></picture>'],
    ['wbr', '<wbr>'],
    ['source', '<source src="x.mp4">'],
    ['track', '<track src="x.vtt">'],
  ])('keeps a text-less <%s> as an html embed', (_tag, html) => {
    expect(read(`a${html}b`)).toEqual([{ text: 'a' }, { embed: { html } }, { text: 'b' }]);
  });

  it('drops an empty known mark', () => {
    expect(read('a<b></b>b')).toEqual([{ text: 'ab' }]);
  });

  it('returns no segments for empty input', () => {
    expect(read('')).toEqual([]);
  });

  it('reads a raw newline in stored HTML as a space, like a browser does', () => {
    expect(read('line one\nline two')).toEqual([{ text: 'line one line two' }]);
    expect(read('<b>a</b> \n\t <i>b</i>')).toEqual([
      { text: 'a', marks: { bold: true } },
      { text: ' ' },
      { text: 'b', marks: { italic: true } },
    ]);
  });

  it('keeps <br> as the only line break and leaves non-breaking spaces alone', () => {
    expect(read('a<br>b')).toEqual([{ text: 'a\nb' }]);
    expect(read('a&nbsp;\nb')).toEqual([{ text: 'a\u00a0 b' }]);
  });
});

describe('isRichText', () => {
  it('accepts segment arrays and the empty array', () => {
    expect(isRichText([])).toBe(true);
    expect(isRichText([{ text: 'a' }, { embed: { page: { id: 'p' } } }])).toBe(true);
  });

  it('rejects strings and other arrays', () => {
    expect(isRichText('a')).toBe(false);
    expect(isRichText([{ content: 'a' }])).toBe(false);
    expect(isRichText(['a'])).toBe(false);
  });

  it('rejects items carrying keys a segment never has', () => {
    expect(isRichText([{ text: 'Buy milk', checked: true }])).toBe(false);
    expect(isRichText([{ embed: { page: { id: 'p' } }, extra: 1 }])).toBe(false);
    expect(isRichText([{ text: 'a', embed: { html: 'x' } }])).toBe(false);
  });

  it('treats a key whose value is undefined as absent', () => {
    expect(isRichText([{ text: 'a', marks: undefined }, { text: 'b', marks: { bold: true } }])).toBe(true);
    expect(isRichText([{ embed: { html: 'x' }, marks: undefined }])).toBe(true);
  });

  it('rejects an item holding both a text and an embed key, even when one is undefined', () => {
    expect(isRichText([{ text: undefined, embed: { html: '<hr>' } }])).toBe(false);
    expect(isRichText([{ text: 'a', embed: undefined }])).toBe(false);
  });

  it('rejects marks that are not a plain record', () => {
    expect(isRichText([{ text: 'a', marks: 'bold' }])).toBe(false);
    expect(isRichText([{ text: 'a', marks: ['bold'] }])).toBe(false);
    expect(isRichText([{ embed: { html: 'x' }, marks: null }])).toBe(false);
    expect(isRichText([{ text: 'a', marks: { bold: true } }])).toBe(true);
  });
});

describe('canonicalizeSegments', () => {
  it('keeps a typed trailing line break', () => {
    expect(canonicalizeSegments([{ text: 'a\n' }])).toEqual([{ text: 'a\n' }]);
  });

  it('merges runs whose marks differ only in key order, writing marks in canonical order', () => {
    const out = canonicalizeSegments([
      { text: 'a', marks: { italic: true, bold: true } },
      { text: 'b', marks: { bold: true, italic: true } },
    ]);

    expect(JSON.stringify(out)).toBe(JSON.stringify([{ text: 'ab', marks: { bold: true, italic: true } }]));
  });

  it('drops a boolean mark that is not true', () => {
    expect(JSON.stringify(canonicalizeSegments([{ text: 'a', marks: { bold: false, code: 'yes', italic: true } }] as unknown as RichText)))
      .toBe(JSON.stringify([{ text: 'a', marks: { italic: true } }]));
  });

  it('drops empty marks so the run merges with a plain neighbour', () => {
    expect(JSON.stringify(canonicalizeSegments([{ text: 'a', marks: {} }, { text: 'b' }])))
      .toBe(JSON.stringify([{ text: 'ab' }]));
  });

  it('writes a link as { href, target, rel }, dropping undefined members', () => {
    const out = canonicalizeSegments([
      { text: 'a', marks: { link: { rel: 'r', href: 'h', target: '_blank' } } },
      { text: 'b', marks: { link: { href: 'h', target: undefined } } },
    ]);

    expect(JSON.stringify(out)).toBe(JSON.stringify([
      { text: 'a', marks: { link: { href: 'h', target: '_blank', rel: 'r' } } },
      { text: 'b', marks: { link: { href: 'h' } } },
    ]));
  });

  it('sorts the attributes of a custom tag mark', () => {
    expect(JSON.stringify(canonicalizeSegments([{ text: 'a', marks: { 'tag:span': { 'data-a': '1', class: 'c' } } }])))
      .toBe(JSON.stringify([{ text: 'a', marks: { 'tag:span': { class: 'c', 'data-a': '1' } } }]));
  });
});
