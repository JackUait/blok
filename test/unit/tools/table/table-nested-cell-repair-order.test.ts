import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../src/blok';
import { Table } from '../../../../src/tools/table/index';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { API, OutputBlockData, OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
}

const blocks: OutputBlockData[] = [
  {
    id: 'outer',
    type: 'table',
    data: {
      withHeadings: false,
      content: [[{ blocks: ['inner', 'tail'] }, { blocks: ['right'] }]],
    },
    content: ['inner', 'tail', 'right'],
  },
  {
    id: 'inner',
    type: 'table',
    parent: 'outer',
    data: {
      withHeadings: false,
      content: [[{ blocks: ['inside'] }]],
    },
    content: ['inside'],
  },
  { id: 'inside', type: 'paragraph', parent: 'inner', data: { text: 'Inside' } },
  { id: 'tail', type: 'paragraph', parent: 'outer', data: { text: 'After inner table' } },
  { id: 'right', type: 'paragraph', parent: 'outer', data: { text: 'To remove' } },
];

describe('table cell repair after a nested table', () => {
  let holder: HTMLDivElement;
  let editor: TestEditor | null;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
    editor = null;
  });

  afterEach(() => {
    editor?.destroy();
    holder.remove();
    vi.restoreAllMocks();
  });

  it('keeps the repaired next cell after every block in the preceding cell', async () => {
    editor = new Blok({
      holder,
      tools: { table: Table, paragraph: Paragraph },
      data: { blocks },
    }) as unknown as TestEditor;
    await editor.isReady;
    // Boot keeps the Yjs sync guard active through a frame.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

    const index = editor.blocks.getBlockIndex('right');

    if (index === undefined) {
      throw new Error('right block is missing');
    }

    await editor.blocks.delete(index, false);
    await new Promise<void>(resolve => setTimeout(resolve, 0));

    const saved: OutputData = await editor.save();
    const outer = saved.blocks.find(block => block.id === 'outer');
    const content = outer?.data.content;

    if (!Array.isArray(content)) {
      throw new Error('outer table has no content');
    }

    const right = content[0]?.[1];

    if (typeof right !== 'object' || right === null || !('blocks' in right) || !Array.isArray(right.blocks)) {
      throw new Error('right cell has no blocks');
    }

    const repairId = right.blocks[0];

    if (typeof repairId !== 'string') {
      throw new Error('right cell has no repair block');
    }

    expect(editor.blocks.getChildren('outer').map(block => block.id)).toEqual(['inner', 'tail', repairId]);
    expect(editor.blocks.getById('inner')?.contentIds).toEqual(['inside']);
  });
});
