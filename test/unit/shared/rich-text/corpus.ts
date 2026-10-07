import type { RichText } from '../../../../types/rich-text';

/** Canonical segment documents every rich-text converter must round-trip unchanged. */
export const CANONICAL: RichText[] = [
  [],
  [{ text: 'a < b && "c"' }],
  [{ text: 'Hello ', marks: { color: 'red' } }, { text: 'bold ', marks: { bold: true } },
    { text: 'link', marks: { link: { href: 'https://x.com' }, bold: true } }, { text: ' x' }, { text: '2', marks: { sup: true } }],
  [{ text: 'line\nnext\n' }],
  [{ text: 'a', marks: { highlight: true } }, { embed: { equation: { expression: 'a^2' } } }, { embed: { page: { id: 'p1' } } }],
  [{ text: 'x', marks: { color: 'blue', background: 'yellow', italic: true } }],
  [{ text: 'x', marks: { 'tag:abbr': { title: 't' } } }],
  [{ text: 'a' }, { embed: { html: '<input type="checkbox" checked="">' } }, { text: 'b' }],
  [{ text: 'go', marks: { link: { href: 'https://y.com', target: '_blank', rel: 'noopener' }, italic: true } }],
];
