import { describe, it, expect } from 'vitest';
import { blockDataToHtml, blockDataToSegments, outputBlocksToHtml, outputBlocksToSegments, richTextFieldsFor } from '../../../../src/shared/rich-text/block-data';
import { htmlToSegmentsNode } from '../../../../src/view/rich-text-parse5';

const resolve = richTextFieldsFor;

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

  it('converts nested row documents inside properties', () => {
    const row = { properties: { notes: { blocks: [{ id: 'n1', type: 'paragraph', data: { text: '<i>x</i>' } }] }, status: 'done' } };

    expect(blockDataToSegments(row, [], resolve, htmlToSegmentsNode)).toEqual({
      properties: { notes: { blocks: [{ id: 'n1', type: 'paragraph', data: { text: [{ text: 'x', marks: { italic: true } }] } }] }, status: 'done' },
    });
  });

  it('does not mutate its input', () => {
    const data = { text: '<b>a</b>' };

    blockDataToSegments(data, ['text'], resolve, htmlToSegmentsNode);

    expect(data).toEqual({ text: '<b>a</b>' });
  });

  it('lists legacy rich fields', () => {
    expect(richTextFieldsFor('warning')).toEqual(['title', 'message']);
    expect(richTextFieldsFor('some-custom-tool')).toEqual(['text']);
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
