import { describe, expect, it } from 'vitest';

import { blocksAsHtml, blockTextAsHtml, htmlOf, savedAsHtml } from './saved-as-html';

const bold = [{ text: 'a', marks: { bold: true } }];

describe('saved-as-html test helper', () => {
  it('reads segments back as HTML', () => {
    expect(htmlOf(bold)).toBe('<strong>a</strong>');
    expect(savedAsHtml({ blocks: [{ type: 'paragraph', data: { text: bold } }] }).blocks[0].data.text).toBe('<strong>a</strong>');
  });

  it('fails on an HTML string in a built-in rich field, so a regression to HTML output is caught', () => {
    expect(() => htmlOf('<b>a</b>')).toThrow(/HTML string/);
    expect(() => blocksAsHtml([{ type: 'header', data: { text: 'h', level: 2 } }])).toThrow(/header\.text/);
    expect(() => blockTextAsHtml({ type: 'list', data: { text: 'i' } })).toThrow(/HTML string/);
  });

  it('accepts HTML strings only with an explicit opt-in', () => {
    expect(htmlOf('<b>a</b>', { allowHtml: true })).toBe('<b>a</b>');
    expect(blocksAsHtml([{ type: 'quote', data: { text: 'q' } }], { allowHtml: true })[0].data.text).toBe('q');
  });

  it('leaves non-rich tools alone', () => {
    expect(blockTextAsHtml({ type: 'code', data: { text: 'a < b' } })).toBe('a < b');
    expect(blocksAsHtml([{ type: 'code', data: { text: 'x' } }])[0].data.text).toBe('x');
  });
});
