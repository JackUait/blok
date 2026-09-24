/**
 * A block that the public API gives a table as parent while its holder is in
 * none of the table's cells lands in the first cell, and the table adopts it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../src/blok';
import { Table } from '../../../../src/tools/table/index';
import { Paragraph } from '../../../../src/tools/paragraph';
import { ToggleItem } from '../../../../src/tools/toggle';
import type { API, OutputBlockData, OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

const P = (id: string, parent?: string): OutputBlockData => ({ id, type: 'paragraph', data: { text: id }, ...(parent === undefined ? {} : { parent }) });

const boot = async (extra: OutputBlockData[] = [P('after')]): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, table: Table, toggle: ToggleItem },
    data: {
      blocks: [
        {
          id: 'tbl',
          type: 'table',
          data: { withHeadings: false, content: [[{ blocks: ['c1'] }, { blocks: ['c2'] }], [{ blocks: ['c3'] }, { blocks: ['c4'] }]] },
          content: ['c1', 'c2', 'c3', 'c4'],
        },
        P('c1', 'tbl'),
        P('c2', 'tbl'),
        P('c3', 'tbl'),
        P('c4', 'tbl'),
        ...extra,
      ],
    },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await settle();

  return instance;
};

const cellOf = (id: string): string | null => {
  const cell = holder?.querySelector(`[data-blok-id="${id}"]`)?.closest('[data-blok-table-cell]');

  return cell === null || cell === undefined
    ? null
    : `${cell.getAttribute('data-blok-table-cell-row')},${cell.getAttribute('data-blok-table-cell-col')}`;
};

const gridIds = async (instance: TestEditor): Promise<string[]> => {
  const saved = await instance.save();
  const table = saved.blocks.find(block => block.id === 'tbl');
  const content = (table?.data as { content: Array<Array<{ blocks?: string[] }>> }).content;

  return content.flat().flatMap(cell => cell.blocks ?? []);
};

describe('a block the API parents to a table from outside it', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    vi.restoreAllMocks();
  });

  it('setBlockParent puts it in the first cell and the saved grid lists it', async () => {
    const instance = await boot();

    instance.blocks.setBlockParent('after', 'tbl');
    await settle();

    expect(cellOf('after')).toBe('0,0');
    expect(await gridIds(instance)).toContain('after');
  });

  it('setBlockParent carries a paragraph\'s children into the first cell after it', async () => {
    const instance = await boot([
      { ...P('after'), content: ['kid', 'tog'] },
      P('kid', 'after'),
      { id: 'tog', type: 'toggle', data: { text: 'tog' }, parent: 'after', content: ['inner'] },
      P('inner', 'tog'),
    ]);

    instance.blocks.setBlockParent('after', 'tbl');
    await settle();

    const cell = holder?.querySelector('[data-blok-id="after"]')?.parentElement;
    const order = Array.from(cell?.children ?? []).map(child => child.getAttribute('data-blok-id'));

    expect([cellOf('after'), cellOf('kid'), cellOf('tog')]).toEqual(['0,0', '0,0', '0,0']);
    expect(order).toEqual(['c1', 'after', 'kid', 'tog']);
    expect(holder?.querySelector('[data-blok-id="inner"]')?.parentElement?.closest('[data-blok-id]')?.getAttribute('data-blok-id')).toBe('tog');
    await expect(instance.save()).resolves.toBeDefined();
  });

  it('insertInsideParent puts the new block in the first cell and the saved grid lists it', async () => {
    const instance = await boot();
    const created = instance.blocks.insertInsideParent('tbl', 1);

    await settle();

    expect(cellOf(created.id)).toBe('0,0');
    expect(await gridIds(instance)).toContain(created.id);
  });

  it('a cell block re-parented to its own table stays in its cell', async () => {
    const instance = await boot();

    instance.blocks.setBlockParent('c4', 'tbl');
    await settle();

    expect(cellOf('c4')).toBe('1,1');
    expect(await gridIds(instance)).toContain('c4');
  });
});
