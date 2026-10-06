/**
 * Alt-drag duplicate dropped onto a table, and Cmd+D on selections that end
 * with a table, must produce real copies outside the table's cells.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import type { Block } from '../../../../../src/components/block';
import { Table } from '../../../../../src/tools/table/index';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Header } from '../../../../../src/tools/header';
import { CalloutTool } from '../../../../../src/tools/callout';
import type { OutputBlockData, OutputData } from '../../../../../types';

interface DragManager {
  lazyInit: () => void;
  handleDuplicate: (sources: Block[], target: Block, edge: 'top' | 'bottom') => Promise<void>;
  duplicateBlocksInPlace: (block: Block) => Promise<Block[]>;
}

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  module: {
    blockManager: { blocks: Block[] };
    blockSelection: { selectBlock: (b: Block) => void };
    dragManager: DragManager;
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
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, header: Header, table: Table, callout: CalloutTool },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await flush();
  instance.module.yjsManager.stopCapturing();

  return instance;
};

const table = (parent?: string): OutputBlockData[] => [
  {
    id: 'tbl',
    type: 'table',
    data: { withHeadings: false, content: [[{ blocks: ['a'] }, { blocks: ['b'] }]] },
    content: ['a', 'b'],
    ...(parent ? { parent } : {}),
  },
  { id: 'a', type: 'paragraph', data: { text: 'A' }, parent: 'tbl' },
  { id: 'b', type: 'paragraph', data: { text: 'B' }, parent: 'tbl' },
];

const prodSave = async (instance: TestEditor): Promise<OutputData> => {
  vi.stubEnv('NODE_ENV', 'production');

  try {
    return await instance.save();
  } finally {
    vi.unstubAllEnvs();
  }
};

const byId = (instance: TestEditor, id: string): Block => {
  const block = instance.module.blockManager.blocks.find(b => b.id === id);

  if (block === undefined) {
    throw new Error(`no ${id}`);
  }

  return block;
};

const savedCell = (out: OutputData, row: number, col: number): string[] =>
  (out.blocks.find(b => b.id === 'tbl')?.data as { content: Array<Array<{ blocks: string[] }>> }).content[row][col].blocks;

describe('duplicates landing next to a table', () => {
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
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('alt-drag of a heading dropped below a table copies a heading at the root, outside the cells', async () => {
    const instance = await boot([{ id: 'h', type: 'header', data: { text: 'Head', level: 2 } }, ...table()]);

    instance.module.dragManager.lazyInit();
    await instance.module.dragManager.handleDuplicate([byId(instance, 'h')], byId(instance, 'tbl'), 'bottom');
    await flush();
    const out = await prodSave(instance);
    const copies = out.blocks.filter(b => b.id !== 'h' && (b.data as { text?: string }).text === 'Head');

    expect(copies.map(b => `${b.type}:${b.parent ?? '-'}`)).toEqual(['header:-']);
    expect(savedCell(out, 0, 1)).toEqual(['b']);
  }, 30_000);

  it('alt-drag of a table dropped below another table copies a table', async () => {
    const instance = await boot([...table(), { id: 'z', type: 'paragraph', data: { text: 'z' } }]);

    instance.module.dragManager.lazyInit();
    await instance.module.dragManager.handleDuplicate(
      [byId(instance, 'tbl'), byId(instance, 'a'), byId(instance, 'b')], byId(instance, 'z'), 'bottom',
    );
    await flush();
    const out = await prodSave(instance);

    expect(out.blocks.filter(b => b.type === 'table')).toHaveLength(2);
  }, 30_000);

  it('Cmd+D on a selected paragraph + table pair copies a table', async () => {
    const instance = await boot([{ id: 'p', type: 'paragraph', data: { text: 'P' } }, ...table(), { id: 'z', type: 'paragraph', data: { text: 'z' } }]);

    instance.module.blockSelection.selectBlock(byId(instance, 'p'));
    instance.module.blockSelection.selectBlock(byId(instance, 'tbl'));
    await instance.module.dragManager.duplicateBlocksInPlace(byId(instance, 'p'));
    await flush();
    const out = await prodSave(instance);

    expect(out.blocks.filter(b => b.type === 'table')).toHaveLength(2);
  }, 30_000);

  it('Cmd+D on a table inside a callout copies a table inside the callout', async () => {
    const instance = await boot([
      { id: 'co', type: 'callout', data: { emoji: '' }, content: ['tbl'] },
      ...table('co'),
    ]);

    const copies = await instance.module.dragManager.duplicateBlocksInPlace(byId(instance, 'tbl'));

    await flush();
    const out = await prodSave(instance);

    expect(copies[0]?.name).toBe('table');
    expect(out.blocks.filter(b => b.type === 'table').map(b => b.parent)).toEqual(['co', 'co']);
  }, 30_000);
});
