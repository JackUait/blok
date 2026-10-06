import { describe, expect, it } from 'vitest';
import { blocksToHtml, blocksToMarkdown } from '../../../../../src/view';
import type { OutputBlockData, OutputData } from '../../../../../types';

const coloured: OutputData = {
  blocks: [
    {
      id: 't',
      type: 'table',
      data: {
        withHeadings: false,
        content: [[
          { blocks: ['a'], color: '#fbecdd', textColor: '#d9730d', placement: 'middle-center' },
          { blocks: ['b'] },
        ]],
      },
      content: ['a', 'b'],
    },
    { id: 'a', type: 'paragraph', parent: 't', data: { text: 'A' } },
    { id: 'b', type: 'paragraph', parent: 't', data: { text: 'B' } },
  ] as OutputBlockData[],
};

const nested: OutputData = {
  blocks: [
    { id: 't', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['inner'] }, { blocks: ['b'] }]] }, content: ['inner', 'b'] },
    { id: 'inner', type: 'table', parent: 't', data: { withHeadings: false, content: [[{ blocks: ['x'] }, { blocks: ['y'] }]] }, content: ['x', 'y'] },
    { id: 'x', type: 'paragraph', parent: 'inner', data: { text: 'Xval' } },
    { id: 'y', type: 'paragraph', parent: 'inner', data: { text: 'Yval' } },
    { id: 'b', type: 'paragraph', parent: 't', data: { text: 'B' } },
  ] as OutputBlockData[],
};

describe('table export from the view package', () => {
  it('blocksToHtml carries a cell\'s background, text colour and placement', () => {
    const html = blocksToHtml(coloured);

    expect(html).toMatch(/#fbecdd/i);
    expect(html).toMatch(/#d9730d/i);
    expect(html).toMatch(/middle|center/);
  });

  it('blocksToMarkdown emits a nested table\'s cell text once', () => {
    const md = blocksToMarkdown(nested);

    expect(md.match(/Xval/g)).toHaveLength(1);
    expect(md.match(/Yval/g)).toHaveLength(1);
  });
});
