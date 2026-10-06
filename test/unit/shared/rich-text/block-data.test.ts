import { describe, it, expect } from 'vitest';
import { blockDataToHtml, blockDataToSegments, outputBlocksToHtml, outputBlocksToSegments, richTextFieldsFor } from '../../../../src/shared/rich-text/block-data';
import { htmlToSegmentsNode } from '../../../../src/view/rich-text-parse5';

const resolve = richTextFieldsFor;
const paragraphOnly = (type: string): string[] => (type === 'paragraph' ? ['text'] : []);

describe('block data converters', () => {
  it('converts only the named fields and leaves the rest untouched', () => {
    const data = { text: '<b>a</b>', level: 2, caption: '<b>not rich</b>' };

    expect(blockDataToSegments(data, ['text'], resolve, htmlToSegmentsNode))
      .toEqual({ text: [{ text: 'a', marks: { bold: true } }], level: 2, caption: '<b>not rich</b>' });
  });

  it('reads segments back to HTML and leaves HTML strings alone', () => {
    expect(blockDataToHtml({ text: [{ text: 'a < b' }] }, ['text'], resolve)).toEqual({ text: 'a &lt; b' });
    expect(blockDataToHtml({ text: '<b>a</b>' }, ['text'], resolve)).toEqual({ text: '<b>a</b>' });
  });

  it('converts nested row documents inside properties when asked', () => {
    const row = { properties: { notes: { blocks: [{ id: 'n1', type: 'paragraph', data: { text: '<i>x</i>' } }] }, status: 'done' } };

    expect(blockDataToSegments(row, [], resolve, htmlToSegmentsNode, { nestedDocuments: true })).toEqual({
      properties: { notes: { blocks: [{ id: 'n1', type: 'paragraph', data: { text: [{ text: 'x', marks: { italic: true } }] } }] }, status: 'done' },
    });
  });

  it('leaves nested documents alone by default', () => {
    const row = { properties: { notes: { blocks: [{ id: 'n1', type: 'paragraph', data: { text: '<i>x</i>' } }] } } };
    const segments = { properties: { notes: { blocks: [{ id: 'n1', type: 'paragraph', data: { text: [{ text: 'x' }] } }] } } };

    expect(blockDataToSegments(row, [], resolve, htmlToSegmentsNode)).toEqual(row);
    expect(blockDataToHtml(segments, [], resolve)).toEqual(segments);
  });

  it('walks nested documents of database-row blocks only', () => {
    const data = { properties: { notes: { blocks: [{ id: 'n1', type: 'paragraph', data: { text: '<i>x</i>' } }] } } };
    const converted = { properties: { notes: { blocks: [{ id: 'n1', type: 'paragraph', data: { text: [{ text: 'x', marks: { italic: true } }] } }] } } };
    const blocks = [{ id: 'r', type: 'database-row', data }, { id: 'c', type: 'my-tool', data }];

    expect(outputBlocksToSegments(blocks, paragraphOnly, htmlToSegmentsNode)).toEqual([
      { id: 'r', type: 'database-row', data: converted },
      { id: 'c', type: 'my-tool', data },
    ]);
    expect(outputBlocksToHtml([{ id: 'c', type: 'my-tool', data: converted }], paragraphOnly)).toEqual([{ id: 'c', type: 'my-tool', data: converted }]);
    expect(outputBlocksToHtml([{ id: 'r', type: 'database-row', data: converted }], paragraphOnly)).toEqual([
      { id: 'r', type: 'database-row', data: { properties: { notes: { blocks: [{ id: 'n1', type: 'paragraph', data: { text: '<i>x</i>' } }] } } } },
    ]);
  });

  it('does not mutate its input', () => {
    const data = { text: '<b>a</b>' };

    blockDataToSegments(data, ['text'], resolve, htmlToSegmentsNode);

    expect(data).toEqual({ text: '<b>a</b>' });
  });

  it('reads a declared field\'s non-segment array leniently, never passing the array on', () => {
    const data = { text: [{ text: 'a', extra: 1 }, { nope: true }, 'x', { text: 'b', marks: { bold: true } }, { embed: { html: '<hr>' }, marks: 'bad' }] };

    expect(blockDataToHtml(data, ['text'], resolve)).toEqual({ text: 'a<strong>b</strong><hr>' });
  });

  it('returns the very same data object when no field converts', () => {
    const html = { text: '<b>a</b>', level: 2 };
    const row = { properties: { notes: { blocks: [{ id: 'n1', type: 'paragraph', data: { text: '<i>x</i>' } }] }, status: 'done' } };
    const blocks = [{ id: 'p', type: 'paragraph', data: html }];

    expect(blockDataToHtml(html, ['text'], resolve)).toBe(html);
    expect(blockDataToHtml(row, [], resolve, { nestedDocuments: true })).toBe(row);
    expect(outputBlocksToHtml(blocks, resolve)).toBe(blocks);
  });

  it('lists legacy rich fields', () => {
    expect(richTextFieldsFor('warning')).toEqual(['title', 'message']);
    expect(richTextFieldsFor('some-custom-tool')).toEqual([]);
  });

  it.each([
    ['<, & and quotes', 'a < b && "c"'],
    ['a trailing line break', 'a\n'],
  ])('round-trips %s through whole blocks byte-equal', (_label, text) => {
    const blocks = [{ id: 'p1', type: 'paragraph', data: { text: [{ text }] } }];
    const html = outputBlocksToHtml(blocks, resolve);

    expect(outputBlocksToSegments(html, resolve, htmlToSegmentsNode)).toEqual(blocks);
  });

  it('picks each block\'s fields by its type', () => {
    const blocks = [{ id: 'w1', type: 'warning', data: { title: '<b>t</b>', message: 'm', text: '<b>kept</b>' } }];

    expect(outputBlocksToSegments(blocks, resolve, htmlToSegmentsNode)).toEqual([
      { id: 'w1', type: 'warning', data: { title: [{ text: 't', marks: { bold: true } }], message: [{ text: 'm' }], text: '<b>kept</b>' } },
    ]);
  });
});
