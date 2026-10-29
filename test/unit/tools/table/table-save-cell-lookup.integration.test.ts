import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Table } from '../../../../src/tools/table';
import type { OutputBlockData, OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
}

const tableOf = (rows: number): OutputBlockData[] => {
  const ids = Array.from({ length: rows }, (_, r) => [`p${r}a`, `p${r}b`]);

  return [
    {
      id: 'table',
      type: 'table',
      data: { withHeadings: false, content: ids.map(row => row.map(id => ({ blocks: [id] }))) },
      content: ids.flat(),
    },
    ...ids.flat().map(id => ({ id, type: 'paragraph', parent: 'table', data: { text: id } })),
  ];
};

/**
 * A drag saves the table on every step, so finding each cell must not search
 * the whole grid once per cell.
 */
describe('table save finds its cells in one pass', () => {
  let holder: HTMLDivElement;
  let editor: TestEditor | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = null;
    holder.remove();
    vi.restoreAllMocks();
  });

  const gridLookupsOnSave = async (rows: number): Promise<{ lookups: number; saved: OutputData }> => {
    editor?.destroy();
    editor = new Blok({ holder, tools: { table: Table, paragraph: Paragraph }, data: { blocks: tableOf(rows) } }) as unknown as TestEditor;
    await editor.isReady;

    const spy = vi.spyOn(Element.prototype, 'querySelector');
    const saved = await editor.save();
    const lookups = spy.mock.calls.filter(([selector]) => selector.includes('data-blok-table-cell-row')).length;

    spy.mockRestore();

    return { lookups, saved };
  };

  it('does not look cells up one by one', async () => {
    const small = await gridLookupsOnSave(2);
    const big = await gridLookupsOnSave(30);

    expect(big.lookups).toBe(small.lookups);

    const table = big.saved.blocks.find(block => block.type === 'table');

    expect((table?.data as { content: Array<Array<{ blocks: string[] }>> }).content[29][1].blocks).toEqual(['p29b']);
  });
});
