/**
 * Block-selecting a table (alone or with everything) and deleting it must
 * remove the whole subtree, and undo must bring every cell back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import type { Block } from '../../../../../src/components/block';
import { Table } from '../../../../../src/tools/table/index';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { OutputBlockData, OutputData } from '../../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  history: { undo: () => void };
  module: {
    blockManager: { blocks: Block[]; deleteSelectedBlocksAndInsertReplacement: (force?: boolean) => Block | undefined };
    blockSelection: { selectBlock: (b: Block) => void; allBlocksSelected: boolean };
    yjsManager: { stopCapturing: () => void };
  };
}

const settle = (ms = 0): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, ms);
});
const frame = (): Promise<void> => new Promise(resolve => {
  requestAnimationFrame(() => resolve());
});
const flush = async (): Promise<void> => {
  await settle();
  await frame();
  await frame();
  await settle(20);
};

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const boot = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({ holder, tools: { paragraph: Paragraph, table: Table }, data: { blocks } }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await flush();
  instance.module.yjsManager.stopCapturing();

  return instance;
};

const doc = (): OutputBlockData[] => [
  { id: 'top', type: 'paragraph', data: { text: 'Top' } },
  {
    id: 'tbl',
    type: 'table',
    data: { withHeadings: true, content: [[{ blocks: ['a'], color: '#ff0000' }, { blocks: ['b'] }], [{ blocks: ['c'], colspan: 2 }, { blocks: [], mergedInto: [1, 0] }]] },
    content: ['a', 'b', 'c'],
  },
  { id: 'a', type: 'paragraph', data: { text: 'A' }, parent: 'tbl' },
  { id: 'b', type: 'paragraph', data: { text: 'B' }, parent: 'tbl' },
  { id: 'c', type: 'paragraph', data: { text: 'C' }, parent: 'tbl' },
  { id: 'after', type: 'paragraph', data: { text: 'After' } },
];

const snapshot = (out: OutputData): string[] => out.blocks.map(b => `${b.id}:${b.type}:${b.parent ?? '-'}:${JSON.stringify(b.type === 'table' ? (b.data as { content: unknown }).content : b.data)}`);

const visibleCells = (): string[] => Array.from(holder?.querySelectorAll('[data-blok-id="tbl"] td') ?? []).map(td => (td.textContent ?? '').trim());

describe('deleting a selected table', () => {
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

  it('select-all + delete, then undo, restores the table with its cells, merge and color', async () => {
    const instance = await boot(doc());
    const before = snapshot(await instance.save());

    instance.module.blockSelection.allBlocksSelected = true;
    instance.module.blockManager.deleteSelectedBlocksAndInsertReplacement(true);
    await flush();
    const cleared = await instance.save();

    expect(cleared.blocks.filter(b => b.type === 'table')).toHaveLength(0);
    instance.module.yjsManager.stopCapturing();
    instance.history.undo();
    await flush();
    const after = snapshot(await instance.save());

    expect(after).toEqual(before);
    expect(visibleCells()).toEqual(['A', 'B', 'C']);
  }, 30_000);

  it('block-selecting only the table and deleting it removes its cells too', async () => {
    const instance = await boot(doc());

    instance.module.blockSelection.selectBlock(instance.module.blockManager.blocks.find(b => b.id === 'tbl') as Block);
    instance.module.blockManager.deleteSelectedBlocksAndInsertReplacement();
    await flush();
    const out = await instance.save();

    expect(out.blocks.map(b => b.id).filter(id => id !== undefined && ['tbl', 'a', 'b', 'c'].includes(id))).toEqual([]);
    expect(out.blocks.map(b => b.id)).toEqual(expect.arrayContaining(['top', 'after']));
  }, 30_000);

  it('undo after block-deleting only the table restores it in place', async () => {
    const instance = await boot(doc());
    const before = snapshot(await instance.save());

    instance.module.blockSelection.selectBlock(instance.module.blockManager.blocks.find(b => b.id === 'tbl') as Block);
    instance.module.blockManager.deleteSelectedBlocksAndInsertReplacement();
    await flush();
    instance.module.yjsManager.stopCapturing();
    instance.history.undo();
    await flush();
    const after = snapshot(await instance.save()).filter(s => !s.startsWith('top') || true);

    expect(after.filter(s => !/^[^:]+:paragraph:-:\{"text":""\}$/.test(s))).toEqual(before);
    expect(visibleCells()).toEqual(['A', 'B', 'C']);
  }, 30_000);
});
