import { describe, expect, it } from 'vitest';

import { parseCellContentToBlocks, serializeCellBlocksToHtml } from '../../../../src/tools/table/table-cell-paste';

describe('parseCellContentToBlocks', () => {
  it('splits plain text on <br> into paragraphs (legacy behavior parity)', () => {
    expect(parseCellContentToBlocks('line one<br>line two')).toEqual([
      { tool: 'paragraph', data: { text: 'line one' } },
      { tool: 'paragraph', data: { text: 'line two' } },
    ]);
  });

  it('returns a single empty paragraph for empty content (legacy parity)', () => {
    expect(parseCellContentToBlocks('')).toEqual([
      { tool: 'paragraph', data: { text: '' } },
    ]);
  });

  it('keeps inline markup inside a paragraph', () => {
    expect(parseCellContentToBlocks('<strong>bold</strong> text')).toEqual([
      { tool: 'paragraph', data: { text: '<strong>bold</strong> text' } },
    ]);
  });

  it('converts an unordered list into unordered list blocks', () => {
    expect(parseCellContentToBlocks('<ul><li>alpha</li><li>beta</li></ul>')).toEqual([
      { tool: 'list', data: { text: 'alpha', style: 'unordered', checked: false, depth: 0 } },
      { tool: 'list', data: { text: 'beta', style: 'unordered', checked: false, depth: 0 } },
    ]);
  });

  it('converts an ordered list into ordered list blocks', () => {
    expect(parseCellContentToBlocks('<ol><li>one</li><li>two</li></ol>')).toEqual([
      { tool: 'list', data: { text: 'one', style: 'ordered', checked: false, depth: 0 } },
      { tool: 'list', data: { text: 'two', style: 'ordered', checked: false, depth: 0 } },
    ]);
  });

  it('derives depth from DOM nesting for nested lists', () => {
    const result = parseCellContentToBlocks('<ul><li>alpha<ul><li>nested</li></ul></li></ul>');

    expect(result).toEqual([
      { tool: 'list', data: { text: 'alpha', style: 'unordered', checked: false, depth: 0 } },
      { tool: 'list', data: { text: 'nested', style: 'unordered', checked: false, depth: 1 } },
    ]);
  });

  it('prefers aria-level for depth (stamped by the paste pre-pass)', () => {
    const result = parseCellContentToBlocks('<ul><li aria-level="1">a</li><li aria-level="2">b</li></ul>');

    expect(result[0].data.depth).toBe(0);
    expect(result[1].data.depth).toBe(1);
  });

  it('handles hoisted sibling nested lists (paste pre-pass output shape)', () => {
    const result = parseCellContentToBlocks(
      '<ul><li aria-level="1">alpha</li><ul><li aria-level="2">nested</li></ul></ul>'
    );

    expect(result).toEqual([
      { tool: 'list', data: { text: 'alpha', style: 'unordered', checked: false, depth: 0 } },
      { tool: 'list', data: { text: 'nested', style: 'unordered', checked: false, depth: 1 } },
    ]);
  });

  it('detects checklists from checkbox inputs and strips the input from text', () => {
    expect(parseCellContentToBlocks('<ul><li><input type="checkbox" checked>done</li></ul>')).toEqual([
      { tool: 'list', data: { text: 'done', style: 'checklist', checked: true, depth: 0 } },
    ]);
  });

  it('splits mixed cell content around lists', () => {
    expect(parseCellContentToBlocks('intro<br>more<ul><li>x</li></ul>after')).toEqual([
      { tool: 'paragraph', data: { text: 'intro' } },
      { tool: 'paragraph', data: { text: 'more' } },
      { tool: 'list', data: { text: 'x', style: 'unordered', checked: false, depth: 0 } },
      { tool: 'paragraph', data: { text: 'after' } },
    ]);
  });

  it('turns <p> children into their own paragraphs', () => {
    expect(parseCellContentToBlocks('<p>a</p><p>b</p>')).toEqual([
      { tool: 'paragraph', data: { text: 'a' } },
      { tool: 'paragraph', data: { text: 'b' } },
    ]);
  });

  it('trims trailing <br> inside list item text (Google Docs p→br conversion)', () => {
    expect(parseCellContentToBlocks('<ul><li>alpha<br></li></ul>')).toEqual([
      { tool: 'list', data: { text: 'alpha', style: 'unordered', checked: false, depth: 0 } },
    ]);
  });
});

describe('serializeCellBlocksToHtml', () => {
  it('joins paragraph blocks with <br> (legacy clipboard shape)', () => {
    expect(serializeCellBlocksToHtml([
      { tool: 'paragraph', data: { text: 'a' } },
      { tool: 'paragraph', data: { text: 'b' } },
    ])).toBe('a<br>b');
  });

  it('serializes list runs to semantic markup that round-trips through the parser', () => {
    const blocks = [
      { tool: 'paragraph', data: { text: 'intro' } },
      { tool: 'list', data: { text: 'alpha', style: 'unordered', checked: false, depth: 0 } },
      { tool: 'list', data: { text: 'nested', style: 'unordered', checked: false, depth: 1 } },
      { tool: 'list', data: { text: 'one', style: 'ordered', checked: false, depth: 0 } },
      { tool: 'paragraph', data: { text: 'after' } },
    ];

    expect(parseCellContentToBlocks(serializeCellBlocksToHtml(blocks))).toEqual(blocks);
  });

  it('round-trips checklist items', () => {
    const blocks = [
      { tool: 'list', data: { text: 'done', style: 'checklist', checked: true, depth: 0 } },
      { tool: 'list', data: { text: 'todo', style: 'checklist', checked: false, depth: 0 } },
    ];

    expect(parseCellContentToBlocks(serializeCellBlocksToHtml(blocks))).toEqual(blocks);
  });

  it('falls back to data.text for unknown tools', () => {
    expect(serializeCellBlocksToHtml([
      { tool: 'quote', data: { text: 'quoted' } },
    ])).toBe('quoted');
  });
});
