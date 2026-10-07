import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import type { Block } from '../../../../../src/components/block';
import { Table } from '../../../../../src/tools/table/index';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Header } from '../../../../../src/tools/header';
import { ToggleItem } from '../../../../../src/tools/toggle';
import type { API, OutputBlockData, OutputData } from '../../../../../types';
import { savedAsHtml } from '../../../helpers/saved-as-html';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  history: { undo: () => void; redo: () => void };
  module: {
    blockManager: { blocks: Block[] };
    blockSelection: { selectBlock: (block: Block) => void };
    yjsManager: { stopCapturing: () => void };
  };
}

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});
const frame = (): Promise<void> => new Promise(resolve => {
  requestAnimationFrame(() => resolve());
});
const flush = async (): Promise<void> => {
  await settle();
  await frame();
  await frame();
  await settle();
};

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const boot = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, header: Header, toggle: ToggleItem, table: Table },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await flush();
  instance.module.yjsManager.stopCapturing();

  return instance;
};

const P = (id: string, parent?: string, text = id): OutputBlockData => ({
  id, type: 'paragraph', data: { text }, ...(parent !== undefined ? { parent } : {}),
});

const table2x2 = (id = 'tbl', parent?: string): OutputBlockData[] => [
  {
    id,
    type: 'table',
    data: {
      withHeadings: false,
      content: [
        [{ blocks: [`${id}a`] }, { blocks: [`${id}b`] }],
        [{ blocks: [`${id}c`] }, { blocks: [`${id}d`] }],
      ],
    },
    content: [`${id}a`, `${id}b`, `${id}c`, `${id}d`],
    ...(parent !== undefined ? { parent } : {}),
  },
  P(`${id}a`, id, 'A'),
  P(`${id}b`, id, 'B'),
  P(`${id}c`, id, 'C'),
  P(`${id}d`, id, 'D'),
];

type Saved = OutputData['blocks'][number];

/** Text of every cell of a saved table, resolved through its block refs. */
const cellTexts = (out: OutputData, tableId: string): string[][] => {
  const byId = new Map(out.blocks.map(b => [b.id, b] as const));
  const tbl = byId.get(tableId) as Saved;
  const content = (tbl.data as { content: Array<Array<{ blocks: string[] }>> }).content;

  return content.map(row => row.map(cell => cell.blocks.map(id => String((byId.get(id)?.data as { text?: string } | undefined)?.text ?? `<missing ${id}>`)).join('|')));
};

const visibleTexts = (tableId: string): string[][] => {
  const grid = holder?.querySelector(`[data-blok-id="${tableId}"] table`) as HTMLTableElement;

  return Array.from(grid.tBodies[0].rows).map(r => Array.from(r.cells).map(c => (c.textContent ?? '').trim()));
};

describe('table block moves, delete+undo, in-cell convert and nesting keep data', () => {
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

  it('moving a table block down keeps every cell', async () => {
    const instance = await boot([...table2x2(), P('z')]);

    instance.blocks.move(instance.blocks.getBlockIndex('z') ?? 0, 0);
    await flush();
    const out = savedAsHtml(await instance.save());

    expect(out.blocks[0].id).toBe('z');
    expect(cellTexts(out, 'tbl')).toEqual([['A', 'B'], ['C', 'D']]);
  }, 30_000);

  it('deleting a table then undoing restores every cell', async () => {
    const instance = await boot([P('top'), ...table2x2(), P('z')]);

    await instance.blocks.delete(instance.blocks.getBlockIndex('tbl'), false);
    await flush();
    instance.module.yjsManager.stopCapturing();
    instance.history.undo();
    await flush();
    const out = savedAsHtml(await instance.save());

    expect(cellTexts(out, 'tbl')).toEqual([['A', 'B'], ['C', 'D']]);
    expect(visibleTexts('tbl')).toEqual([['A', 'B'], ['C', 'D']]);
  }, 30_000);

  it('converting a cell paragraph to a header keeps it in its cell', async () => {
    const instance = await boot([...table2x2(), P('z')]);

    const converted = await instance.blocks.convert('tblb', 'header', { level: 2 });

    await flush();
    const out = savedAsHtml(await instance.save());
    const tbl = out.blocks.find(b => b.id === 'tbl') as Saved;
    const content = (tbl.data as { content: Array<Array<{ blocks: string[] }>> }).content;

    expect(content[0][1].blocks).toEqual([converted.id]);
    expect(out.blocks.find(b => b.id === converted.id)?.data).toMatchObject({ text: 'B' });
    expect(visibleTexts('tbl')).toEqual([['A', 'B'], ['C', 'D']]);
  }, 30_000);

  it('a table inside a toggle survives a save round trip', async () => {
    const instance = await boot([
      { id: 'tg', type: 'toggle', data: { text: 'T', isOpen: true }, content: ['tbl'] },
      ...table2x2('tbl', 'tg'),
    ]);
    const out = savedAsHtml(await instance.save());

    expect(cellTexts(out, 'tbl')).toEqual([['A', 'B'], ['C', 'D']]);
  }, 30_000);

});
