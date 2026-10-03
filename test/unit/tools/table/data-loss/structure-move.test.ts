/**
 * Moving blocks into, out of and around a table (public move APIs, keyboard
 * move shortcuts, whole-table moves) must keep every cell in the save.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import type { Block } from '../../../../../src/components/block';
import { Table } from '../../../../../src/tools/table/index';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { ToggleItem } from '../../../../../src/tools/toggle';
import type { API, OutputBlockData, OutputData } from '../../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  history: { undo: () => void; redo: () => void };
  module: {
    blockManager: { blocks: Block[]; currentBlockIndex: number; moveCurrentBlockUp: () => void; moveCurrentBlockDown: () => void };
    blockSelection: { selectBlock: (b: Block) => void; selectAllBlocks?: () => void };
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
  const instance = new Blok({ holder, tools: { paragraph: Paragraph, table: Table, toggle: ToggleItem }, data: { blocks } }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await flush();
  instance.module.yjsManager.stopCapturing();

  return instance;
};

type Cell = { blocks: string[] };

const tableBlocks = (parent?: string): OutputBlockData[] => [
  {
    id: 'tbl',
    type: 'table',
    data: { withHeadings: false, content: [[{ blocks: ['a'] }, { blocks: ['b'] }], [{ blocks: ['c'] }, { blocks: ['d'] }]] },
    content: ['a', 'b', 'c', 'd'],
    ...(parent ? { parent } : {}),
  },
  { id: 'a', type: 'paragraph', data: { text: 'A' }, parent: 'tbl' },
  { id: 'b', type: 'paragraph', data: { text: 'B' }, parent: 'tbl' },
  { id: 'c', type: 'paragraph', data: { text: 'C' }, parent: 'tbl' },
  { id: 'd', type: 'paragraph', data: { text: 'D' }, parent: 'tbl' },
];

const doc = (): OutputBlockData[] => [
  { id: 'top', type: 'paragraph', data: { text: 'Top' } },
  ...tableBlocks(),
  { id: 'after', type: 'paragraph', data: { text: 'After' } },
  { id: 'last', type: 'paragraph', data: { text: 'Last' } },
];

const savedTexts = (out: OutputData): string[][] => {
  const byId = new Map(out.blocks.map(b => [b.id, b] as const));
  const content = (out.blocks.find(b => b.id === 'tbl')?.data as { content: Cell[][] }).content;

  return content.map(row => row.map(cell => cell.blocks
    .map(id => String((byId.get(id)?.data as { text?: string } | undefined)?.text ?? `<missing ${id}>`))
    .filter(t => t !== '').join('|')));
};

const visibleTexts = (): string[][] => {
  const grid = holder?.querySelector<HTMLTableElement>('[data-blok-id="tbl"] table');

  return Array.from(grid?.tBodies[0].rows ?? []).map(r => Array.from(r.cells).map(c =>
    Array.from(c.querySelectorAll('[data-blok-id]')).map(b => (b.textContent ?? '').trim()).filter(t => t !== '').join('|')));
};

const prodSave = async (instance: TestEditor): Promise<OutputData> => {
  vi.stubEnv('NODE_ENV', 'production');

  try {
    return await instance.save();
  } finally {
    vi.unstubAllEnvs();
  }
};

describe('moving around a table keeps cell data', () => {
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

  it('blocks.move of the table to the end carries its cells', async () => {
    const instance = await boot(doc());
    const from = instance.blocks.getBlockIndex('tbl') ?? -1;

    instance.blocks.move(instance.blocks.getBlocksCount() - 1, from);
    await flush();
    const out = await instance.save();

    expect(savedTexts(out)).toEqual([['A', 'B'], ['C', 'D']]);
    expect(visibleTexts()).toEqual([['A', 'B'], ['C', 'D']]);
  }, 30_000);

  it('keyboard move-up of the block below the table jumps over the whole table', async () => {
    const instance = await boot(doc());

    instance.module.blockManager.currentBlockIndex = instance.blocks.getBlockIndex('after') ?? -1;
    instance.module.blockManager.moveCurrentBlockUp();
    await flush();
    const out = await instance.save();

    expect(savedTexts(out)).toEqual([['A', 'B'], ['C', 'D']]);
    expect(visibleTexts()).toEqual([['A', 'B'], ['C', 'D']]);
    expect(out.blocks.filter(b => b.parent === undefined).map(b => b.id)).toEqual(['top', 'after', 'tbl', 'last']);
  }, 30_000);

  it('keyboard move-down of the table keeps its cells', async () => {
    const instance = await boot(doc());

    instance.module.blockManager.currentBlockIndex = instance.blocks.getBlockIndex('tbl') ?? -1;
    instance.module.blockManager.moveCurrentBlockDown();
    await flush();
    const out = await instance.save();

    expect(savedTexts(out)).toEqual([['A', 'B'], ['C', 'D']]);
    expect(visibleTexts()).toEqual([['A', 'B'], ['C', 'D']]);
  }, 30_000);

  it('keyboard move-down of a cell\'s only block does not empty the cell or leak the block', async () => {
    const instance = await boot(doc());

    instance.module.blockManager.currentBlockIndex = instance.blocks.getBlockIndex('b') ?? -1;
    instance.module.blockManager.moveCurrentBlockDown();
    await flush();
    const out = await prodSave(instance);
    const texts = savedTexts(out).flat().join(',');

    expect(texts).toContain('B');
    expect(visibleTexts().flat().join(',')).toContain('B');
  }, 30_000);

  it('keyboard move-up of the first cell block keeps it in the table', async () => {
    const instance = await boot(doc());

    instance.module.blockManager.currentBlockIndex = instance.blocks.getBlockIndex('a') ?? -1;
    instance.module.blockManager.moveCurrentBlockUp();
    await flush();
    const out = await prodSave(instance);

    expect(savedTexts(out).flat().join(',')).toContain('A');
    expect(visibleTexts().flat().join(',')).toContain('A');
  }, 30_000);

  it('blocks.move of a root paragraph to an index inside the table run keeps everything visible', async () => {
    const instance = await boot(doc());

    instance.blocks.move((instance.blocks.getBlockIndex('c') ?? 0), instance.blocks.getBlockIndex('last'));
    await flush();
    const out = await prodSave(instance);

    expect(savedTexts(out).flat().join(',')).toMatch(/A.*B.*C.*D/);
    const saved = out.blocks.find(b => b.id === 'last');

    expect(saved).toBeDefined();
    expect(holder?.querySelector('[data-blok-id="last"]')?.isConnected).toBe(true);
  }, 30_000);

  it('moving a toggle holding a table keeps the cells', async () => {
    const instance = await boot([
      { id: 'top', type: 'paragraph', data: { text: 'Top' } },
      { id: 'tg', type: 'toggle', data: { text: 'T', isOpen: true }, content: ['tbl'] },
      ...tableBlocks('tg'),
    ]);

    instance.module.blockManager.currentBlockIndex = instance.blocks.getBlockIndex('tg') ?? -1;
    instance.module.blockManager.moveCurrentBlockUp();
    await flush();
    const out = await instance.save();

    expect(savedTexts(out)).toEqual([['A', 'B'], ['C', 'D']]);
    expect(visibleTexts()).toEqual([['A', 'B'], ['C', 'D']]);
  }, 30_000);
});
