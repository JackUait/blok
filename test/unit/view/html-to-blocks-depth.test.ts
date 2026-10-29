// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { htmlToBlocks, htmlToBlocksWithReport } from '../../../src/view/html-to-blocks';

// The old recursive converter overflowed the stack below this depth on every shape here.
const DEPTH = 5_000;
// Parsing deep nesting is quadratic; a loaded CI runner needs room.
const TIMEOUT = 60_000;

const nest = (open: string, inner: string, depth = DEPTH): string => `${open.repeat(depth)}${inner}`;

describe('htmlToBlocks on deeply nested HTML', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [ 'div', '<div>' ],
    [ 'span', '<span>' ],
    [ 'b', '<b>' ],
    [ 'unknown tag', '<x-wrap>' ],
  ])('reads text inside %s wrappers as one paragraph', (_, open) => {
    const blocks = htmlToBlocks(nest(open, 'x'));

    expect(blocks.map((block) => block.type)).toEqual([ 'paragraph' ]);
  }, TIMEOUT);

  it('reads nested blockquotes as one quote', () => {
    expect(htmlToBlocks(nest('<blockquote>', 'x')).map((block) => block.type)).toEqual([ 'quote' ]);
  }, TIMEOUT);

  it('reads nested lists as one list item per level', () => {
    const blocks = htmlToBlocks(nest('<ul><li>', 'x'));

    expect(blocks).toHaveLength(DEPTH);
    expect(blocks[DEPTH - 1].data).toMatchObject({ depth: DEPTH - 1 });
  }, TIMEOUT);

  it('reads nested details as a chain of toggles', () => {
    const blocks = htmlToBlocks(nest('<details><summary>t</summary>', 'x'));
    const toggles = blocks.filter((block) => block.type === 'toggle');

    expect(toggles).toHaveLength(DEPTH);
    expect(toggles[DEPTH - 1].parent).toBe(toggles[DEPTH - 2].id);
  }, TIMEOUT);

  it('flattens nested tables into the outer table', () => {
    const blocks = htmlToBlocks(nest('<table><tr><td>', 'x'));

    expect(blocks[0].type).toBe('table');
  }, TIMEOUT);

  it('reads the direction of a table under thousands of wrappers', () => {
    const { blocks } = htmlToBlocksWithReport(`<div dir="rtl">${nest('<div>', '<table><tr><td style="text-align: left">x</td><td>y</td></tr></table>')}`);
    const table = blocks.find((block) => block.type === 'table');

    expect(table?.data).toMatchObject({ content: [ [ { placement: 'top-right' }, {} ] ] });
  }, TIMEOUT);

  it('lifts an image out of thousands of inline wrappers', () => {
    const blocks = htmlToBlocks(`<p>${nest('<b>', 'x<img src="https://example.com/a.png">')}</p>`);

    expect(blocks.map((block) => block.type)).toEqual([ 'paragraph', 'image' ]);
  }, TIMEOUT);

  it('finds the image of a figure under thousands of wrappers', () => {
    const blocks = htmlToBlocks(`<figure>${nest('<div>', '<img src="https://example.com/a.png">')}<figcaption>c</figcaption></figure>`);

    expect(blocks).toEqual([ expect.objectContaining({ type: 'image', data: expect.objectContaining({ caption: 'c' }) }) ]);
  }, TIMEOUT);

  it('reads the text of a code block under thousands of wrappers', () => {
    const blocks = htmlToBlocks(`<pre>${nest('<span>', 'code<img src="https://example.com/a.png">')}</pre>`);

    expect(blocks.map((block) => block.type)).toEqual([ 'code', 'image' ]);
    expect(blocks[0].data).toMatchObject({ code: 'code' });
  }, TIMEOUT);

  it('reports each lossy inline tag under thousands of wrappers', () => {
    const { warnings } = htmlToBlocksWithReport(`<p>${nest('<kbd>', 'k')}</p>`);

    expect(warnings.filter((warning) => warning.construct === 'kbd')).toHaveLength(DEPTH);
  }, TIMEOUT);
});
