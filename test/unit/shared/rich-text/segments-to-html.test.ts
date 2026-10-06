import { describe, it, expect } from 'vitest';
import { segmentsToHtml } from '../../../../src/shared/rich-text/segments-to-html';
import type { RichText } from '../../../../types/rich-text';

describe('segmentsToHtml', () => {
  it('writes no wrapper for a boolean mark set to false', () => {
    expect(segmentsToHtml([{ text: 'x', marks: { bold: false, italic: true } }] as unknown as RichText)).toBe('<i>x</i>');
  });

  it('keeps a typed trailing line break when an empty run follows it', () => {
    expect(segmentsToHtml([{ text: 'a\n' }, { text: '' }])).toBe('a<br><br>');
  });

  it('escapes markup characters typed as text', () => {
    expect(segmentsToHtml([{ text: 'a < b && "c" > d' }])).toBe('a &lt; b &amp;&amp; "c" &gt; d');
  });

  it('writes one wrapper around adjacent runs that share a mark', () => {
    expect(segmentsToHtml([
      { text: 'bold ', marks: { bold: true } },
      { text: 'both', marks: { bold: true, italic: true } },
    ])).toBe('<strong>bold <i>both</i></strong>');
  });

  it('puts a link outside other marks', () => {
    expect(segmentsToHtml([
      { text: 'x', marks: { bold: true, link: { href: 'https://x.com' } } },
    ])).toBe('<a href="https://x.com"><strong>x</strong></a>');
  });

  it('maps preset colours to Blok tokens and keeps raw colours', () => {
    expect(segmentsToHtml([{ text: 'x', marks: { color: 'red', background: '#ffeeaa' } }]))
      .toBe('<mark style="color: var(--blok-color-red-text); background-color: #ffeeaa;">x</mark>');
  });

  it('writes a bare mark for highlight', () => {
    expect(segmentsToHtml([{ text: 'x', marks: { highlight: true } }])).toBe('<mark>x</mark>');
  });

  it('writes line breaks as br and keeps a trailing one visible', () => {
    expect(segmentsToHtml([{ text: 'a\nb' }])).toBe('a<br>b');
    expect(segmentsToHtml([{ text: 'a\n' }])).toBe('a<br><br>');
  });

  it('writes embeds', () => {
    expect(segmentsToHtml([{ embed: { equation: { expression: 'a<b' } } }]))
      .toBe('<span data-latex="a&lt;b">a&lt;b</span>');
    expect(segmentsToHtml([{ embed: { page: { id: 'p1' } } }]))
      .toBe('<a data-blok-page-id="p1">Page</a>');
    expect(segmentsToHtml([{ embed: { html: '<img src="a.png">' } }])).toBe('<img src="a.png">');
  });

  it('writes custom marks by tag name', () => {
    expect(segmentsToHtml([{ text: 'x', marks: { 'tag:abbr': { title: 'X & Y' } } }]))
      .toBe('<abbr title="X &amp; Y">x</abbr>');
  });

  it('renders a custom mark with an invalid tag name unwrapped', () => {
    expect(segmentsToHtml([{ text: 'x', marks: { 'tag:img src=x onerror=alert(1)': {} } }])).toBe('x');
    expect(segmentsToHtml([{ text: 'x', marks: { 'tag:': {} } }])).toBe('x');
  });

  it('skips attributes with invalid names', () => {
    expect(segmentsToHtml([{ text: 'x', marks: { 'tag:abbr': { 'onclick="a"': 'b', title: 'T' } } }]))
      .toBe('<abbr title="T">x</abbr>');
  });

  it('writes one link for runs whose link objects differ only in key order', () => {
    expect(segmentsToHtml([
      { text: 'a', marks: { link: { href: 'https://x.com', target: '_blank' } } },
      { text: 'b', marks: { link: { target: '_blank', href: 'https://x.com' } } },
    ])).toBe('<a href="https://x.com" target="_blank">ab</a>');
  });

  it('writes custom attributes in sorted name order', () => {
    expect(segmentsToHtml([{ text: 'x', marks: { 'tag:abbr': { title: 'T', lang: 'en' } } }]))
      .toBe('<abbr lang="en" title="T">x</abbr>');
  });

  it('renders an embed whose item also carries an undefined text key', () => {
    const rich = [{ text: 'a' }, { text: undefined, embed: { html: '<hr>' } }] as unknown as RichText;

    expect(segmentsToHtml(rich)).toBe('a<hr>');
  });

  it('returns an empty string for no segments', () => {
    expect(segmentsToHtml([])).toBe('');
  });
});
