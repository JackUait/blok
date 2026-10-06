import { describe, it, expect } from 'vitest';
import { segmentsToHtml } from '../../../../src/shared/rich-text/segments-to-html';
import { htmlToSegmentsNode } from '../../../../src/view/rich-text-parse5';
import { htmlToSegmentsDom } from '../../../../src/components/utils/rich-text-dom';
import type { RichText } from '../../../../types/rich-text';

const CANONICAL: RichText[] = [
  [],
  [{ text: 'a < b && "c"' }],
  [{ text: 'Hello ', marks: { color: 'red' } }, { text: 'bold ', marks: { bold: true } },
    { text: 'link', marks: { link: { href: 'https://x.com' }, bold: true } }, { text: ' x' }, { text: '2', marks: { sup: true } }],
  [{ text: 'line\nnext\n' }],
  [{ text: 'a', marks: { highlight: true } }, { embed: { equation: { expression: 'a^2' } } }, { embed: { page: { id: 'p1' } } }],
  [{ text: 'x', marks: { color: 'blue', background: 'yellow', italic: true } }],
  [{ text: 'x', marks: { 'tag:abbr': { title: 't' } } }],
  [{ text: 'a' }, { embed: { html: '<input type="checkbox" checked="">' } }, { text: 'b' }],
];

describe.each([['parse5', htmlToSegmentsNode], ['dom', htmlToSegmentsDom]] as const)('round trip (%s)', (_name, read) => {
  it.each(CANONICAL.map(rich => [JSON.stringify(rich), rich]))('segments → html → segments is the identity: %s', (_label, rich) => {
    expect(read(segmentsToHtml(rich))).toEqual(rich);
  });

  it.each(CANONICAL.map(rich => [JSON.stringify(rich), rich]))('the round trip keeps key order byte-equal: %s', (_label, rich) => {
    expect(JSON.stringify(read(segmentsToHtml(rich)))).toBe(JSON.stringify(rich));
  });

  it('html → segments → html is stable after one pass', () => {
    const html = '<b>a</b><strong>b</strong> <mark style="color: var(--blok-color-red-text);">c</mark><br>';
    const once = segmentsToHtml(read(html));

    expect(segmentsToHtml(read(once))).toBe(once);
  });
});
