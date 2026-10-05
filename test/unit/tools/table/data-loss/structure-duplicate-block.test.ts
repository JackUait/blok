/**
 * Duplicating (Cmd/Ctrl+D or block menu "Duplicate") a table, or a container
 * holding a table, must give a working table copy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import type { Block } from '../../../../../src/components/block';
import { Table } from '../../../../../src/tools/table/index';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { PageTool } from '../../../../../src/tools/page';
import { PageLink } from '../../../../../src/tools/page-link';
import type { PageConfig } from '../../../../../src/tools/page/types';
import { ToggleItem } from '../../../../../src/tools/toggle';
import type { API, OutputBlockData, OutputData } from '../../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  history: { undo: () => void };
  module: {
    blockManager: { blocks: Block[] };
    dragManager: { duplicateBlocksInPlace: (block: Block) => Promise<Block[]>; collectDuplicateDescendants?: (block: Block) => Block[]; lazyInit?: () => void };
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

/** A persisted tune, so a copied cell block can be checked for its tune data. */
class MarkerTune {
  public static isTune = true;
  private readonly data: { mark?: string };

  constructor({ data }: { data?: { mark?: string } }) {
    this.data = data ?? {};
  }

  public render(): HTMLElement {
    return document.createElement('div');
  }

  public save(): { mark?: string } {
    return this.data;
  }
}

const boot = async (blocks: OutputBlockData[], pageConfig?: PageConfig & Record<string, unknown>): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: {
      paragraph: Paragraph,
      toggle: ToggleItem,
      table: Table,
      page: pageConfig === undefined ? PageTool : { class: PageTool, config: pageConfig },
      ...(pageConfig === undefined ? {} : { 'page-link': { class: PageLink, config: pageConfig } }),
      marker: MarkerTune,
    },
    tunes: ['marker'],
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await flush();
  instance.module.yjsManager.stopCapturing();

  return instance;
};

const P = (id: string, parent: string | undefined, text: string): OutputBlockData => ({
  id, type: 'paragraph', data: { text }, ...(parent !== undefined ? { parent } : {}),
});

const table2x2 = (parent?: string): OutputBlockData[] => [
  {
    id: 'tbl',
    type: 'table',
    data: {
      withHeadings: false,
      content: [
        [{ blocks: ['a'] }, { blocks: ['b'] }],
        [{ blocks: ['c'] }, { blocks: ['d'] }],
      ],
    },
    content: ['a', 'b', 'c', 'd'],
    ...(parent !== undefined ? { parent } : {}),
  },
  P('a', 'tbl', 'A'),
  P('b', 'tbl', 'B'),
  P('c', 'tbl', 'C'),
  P('d', 'tbl', 'D'),
];

/** Save as production does: the dev-only invariant throws are off. */
const saveAsProduction = async (instance: TestEditor): Promise<OutputData> => {
  vi.stubEnv('NODE_ENV', 'production');

  try {
    return await instance.save();
  } finally {
    vi.unstubAllEnvs();
  }
};

const tablesIn = (out: OutputData): OutputData['blocks'] => out.blocks.filter(b => b.type === 'table');

describe('duplicating a table block', () => {
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

  it('Cmd+D on a top-level table saves two tables, not a table plus an empty paragraph', async () => {
    const instance = await boot([...table2x2(), P('z', undefined, 'after')]);
    const tbl = instance.module.blockManager.blocks.find(b => b.id === 'tbl') as Block;

    const copies = await instance.module.dragManager.duplicateBlocksInPlace(tbl);

    await flush();
    const out = await saveAsProduction(instance);

    expect(copies[0]?.name).toBe('table');
    expect(tablesIn(out)).toHaveLength(2);
    expect(holder?.querySelectorAll('[data-blok-tool="table"]')).toHaveLength(2);
  }, 30_000);

  it('Cmd+D on a toggle holding a table mounts the copy beside the toggle, not inside it', async () => {
    const instance = await boot([
      { id: 'tg', type: 'toggle', data: { text: 'T', isOpen: true }, content: ['tbl'] },
      ...table2x2('tg'),
    ]);
    const tg = instance.module.blockManager.blocks.find(b => b.id === 'tg') as Block;

    const copies = await instance.module.dragManager.duplicateBlocksInPlace(tg);

    await flush();
    const copyToggle = copies[0];

    expect(copyToggle?.parentId).toBeNull();
    // The copy is a root block, so its holder must not sit inside the original toggle.
    expect(tg.holder.contains(copyToggle?.holder ?? null)).toBe(false);
    await expect(instance.save()).resolves.toBeDefined();
  }, 30_000);

  it('deleting the original toggle after Cmd+D keeps the copied table on screen', async () => {
    const instance = await boot([
      { id: 'tg', type: 'toggle', data: { text: 'T', isOpen: true }, content: ['tbl'] },
      ...table2x2('tg'),
    ]);
    const tg = instance.module.blockManager.blocks.find(b => b.id === 'tg') as Block;
    const copies = await instance.module.dragManager.duplicateBlocksInPlace(tg);

    await flush();
    const copyTableId = String(copies[1]?.id);

    await instance.blocks.delete(instance.blocks.getBlockIndex('tg'), false);
    await flush();
    const out = await saveAsProduction(instance);
    const copyGrid = holder?.querySelector(`[data-blok-id="${copyTableId}"] table`);

    expect(tablesIn(out).map(b => b.id)).toContain(copyTableId);
    expect(copyGrid?.isConnected).toBe(true);
  }, 30_000);

  it('Cmd+D on a top-level table shows the copied cell texts inside a second table', async () => {
    const instance = await boot([...table2x2(), P('z', undefined, 'after')]);
    const tbl = instance.module.blockManager.blocks.find(b => b.id === 'tbl') as Block;

    await instance.module.dragManager.duplicateBlocksInPlace(tbl);
    await flush();
    const grids = Array.from(holder?.querySelectorAll<HTMLTableElement>('[data-blok-tool="table"] table') ?? []);
    const cellTexts = grids.map(g => Array.from(g.querySelectorAll('td')).map(td => (td.textContent ?? '').trim()));

    expect(cellTexts).toEqual([['A', 'B', 'C', 'D'], ['A', 'B', 'C', 'D']]);
  }, 30_000);

  it('does not clone a page child when duplicating a table without a link URL', async () => {
    const instance = await boot([
      {
        id: 'tbl',
        type: 'table',
        data: { withHeadings: false, content: [[{ blocks: ['pg'] }]] },
        content: ['pg'],
      },
      { id: 'pg', type: 'page', parent: 'tbl', data: { pageId: 'p1' } },
      P('z', undefined, 'after'),
    ]);
    const tbl = instance.module.blockManager.blocks.find(b => b.id === 'tbl') as Block;

    await instance.module.dragManager.duplicateBlocksInPlace(tbl);
    await flush();
    const out = await saveAsProduction(instance);

    expect(out.blocks.filter(b => b.type === 'page' && b.data.pageId === 'p1')).toHaveLength(1);
    expect(tablesIn(out)).toHaveLength(2);
  }, 30_000);

  it('duplicates an open-only page cell as a non-owning page reference', async () => {
    const instance = await boot([
      {
        id: 'tbl',
        type: 'table',
        data: { withHeadings: false, content: [[{ blocks: ['pg'] }]] },
        content: ['pg'],
      },
      { id: 'pg', type: 'page', parent: 'tbl', data: { pageId: 'p1' } },
      P('z', undefined, 'after'),
    ], { open: () => undefined });
    const tbl = instance.module.blockManager.blocks.find(block => block.id === 'tbl') as Block;

    const copies = await instance.module.dragManager.duplicateBlocksInPlace(tbl);
    await flush();
    const saved = await saveAsProduction(instance);
    const copiedTable = saved.blocks.find(block => block.id === copies[0]?.id);
    const copiedId = (copiedTable?.data as { content?: Array<Array<{ blocks: string[] }>> } | undefined)
      ?.content?.[0]?.[0]?.blocks[0];

    expect(saved.blocks.find(block => block.id === copiedId)).toMatchObject({
      type: 'page-link', data: { pageId: 'p1' },
    });
    expect(saved.blocks.filter(block => block.type === 'page' && block.data.pageId === 'p1')).toHaveLength(1);
  }, 30_000);

  it('does not clone a nested page child when duplicating a table', async () => {
    const instance = await boot([
      {
        id: 'tbl',
        type: 'table',
        data: { withHeadings: false, content: [[{ blocks: ['tg'] }]] },
        content: ['tg'],
      },
      { id: 'tg', type: 'toggle', parent: 'tbl', data: { text: 'T', isOpen: true }, content: ['pg'] },
      { id: 'pg', type: 'page', parent: 'tg', data: { pageId: 'p1' } },
      P('z', undefined, 'after'),
    ]);
    const tbl = instance.module.blockManager.blocks.find(b => b.id === 'tbl') as Block;

    await instance.module.dragManager.duplicateBlocksInPlace(tbl);
    await flush();
    const out = await saveAsProduction(instance);

    expect(out.blocks.filter(b => b.type === 'page' && b.data.pageId === 'p1')).toHaveLength(1);
    expect(tablesIn(out)).toHaveLength(2);
  }, 30_000);

  it('duplicates a nested open-only page as a non-owning child reference', async () => {
    const instance = await boot([
      {
        id: 'tbl',
        type: 'table',
        data: { withHeadings: false, content: [[{ blocks: ['tg'] }]] },
        content: ['tg'],
      },
      { id: 'tg', type: 'toggle', parent: 'tbl', data: { text: 'T', isOpen: true }, content: ['pg'] },
      { id: 'pg', type: 'page', parent: 'tg', data: { pageId: 'p1' } },
      P('z', undefined, 'after'),
    ], { open: () => undefined });
    const tbl = instance.module.blockManager.blocks.find(block => block.id === 'tbl') as Block;

    const copies = await instance.module.dragManager.duplicateBlocksInPlace(tbl);
    await flush();
    const saved = await saveAsProduction(instance);
    const copiedTable = saved.blocks.find(block => block.id === copies[0]?.id);
    const copiedToggleId = (copiedTable?.data as { content?: Array<Array<{ blocks: string[] }>> } | undefined)
      ?.content?.[0]?.[0]?.blocks[0];
    const copiedToggle = saved.blocks.find(block => block.id === copiedToggleId);
    const copiedPageId = copiedToggle?.content?.[0];

    expect(saved.blocks.find(block => block.id === copiedPageId)).toMatchObject({
      type: 'page-link', data: { pageId: 'p1' },
    });
    expect(saved.blocks.filter(block => block.type === 'page' && block.data.pageId === 'p1')).toHaveLength(1);
  }, 30_000);

  it('undo of Cmd+D on a table leaves exactly the original document', async () => {
    const instance = await boot([...table2x2(), P('z', undefined, 'after')]);
    const tbl = instance.module.blockManager.blocks.find(b => b.id === 'tbl') as Block;

    await instance.module.dragManager.duplicateBlocksInPlace(tbl);
    await flush();
    instance.module.yjsManager.stopCapturing();
    instance.history.undo();
    await flush();
    const out = await saveAsProduction(instance);

    expect(out.blocks.map(b => b.id)).toEqual(['tbl', 'a', 'b', 'c', 'd', 'z']);
  }, 30_000);

  it('control: deleting a toggle that holds a table (no duplicate) promotes the table and keeps it on screen', async () => {
    const instance = await boot([
      { id: 'tg', type: 'toggle', data: { text: 'T', isOpen: true }, content: ['tbl'] },
      ...table2x2('tg'),
      P('z', undefined, 'after'),
    ]);

    await instance.blocks.delete(instance.blocks.getBlockIndex('tg'), false);
    await flush();
    const out = await saveAsProduction(instance);

    expect({ ids: out.blocks.map(b => `${b.id}:${b.parent ?? '-'}`), tableOnScreen: holder?.querySelector('[data-blok-id="tbl"]')?.isConnected ?? false })
      .toEqual({ ids: ['tbl:-', 'a:tbl', 'b:tbl', 'c:tbl', 'd:tbl', 'z:-'], tableOnScreen: true });
  }, 30_000);

  it('collects the cells of a table nested in a toggle as duplicate descendants', async () => {
    const instance = await boot([
      { id: 'tg', type: 'toggle', data: { text: 'T', isOpen: true }, content: ['tbl'] },
      ...table2x2('tg'),
    ]);
    const tg = instance.module.blockManager.blocks.find(b => b.id === 'tg') as Block;
    // duplicateBlocksInPlace runs lazyInit first, which wires the depth-based list walk.
    instance.module.dragManager.lazyInit?.();
    const collect = instance.module.dragManager.collectDuplicateDescendants?.bind(instance.module.dragManager);

    expect(collect?.(tg).map(b => b.id)).toEqual(['tbl', 'a', 'b', 'c', 'd']);
  }, 30_000);

  it('Cmd+D on a table copies a cell toggle WITH its child, and one undo removes the whole copy', async () => {
    const instance = await boot([
      {
        id: 'tbl',
        type: 'table',
        data: { withHeadings: false, content: [[{ blocks: ['tg'] }, { blocks: ['b'] }]] },
        content: ['tg', 'b'],
      },
      { id: 'tg', type: 'toggle', parent: 'tbl', data: { text: 'T', isOpen: true }, content: ['k'] },
      P('k', 'tg', 'Kid'),
      P('b', 'tbl', 'B'),
      P('z', undefined, 'after'),
    ]);
    const tbl = instance.module.blockManager.blocks.find(b => b.id === 'tbl') as Block;

    const copies = await instance.module.dragManager.duplicateBlocksInPlace(tbl);

    await flush();
    const out = await instance.save();
    const byId = new Map(out.blocks.map(b => [b.id, b] as const));
    const copyId = String(copies[0]?.id);
    const cellBlocks = (tableId: string): string[] =>
      (byId.get(tableId)?.data as { content: Array<Array<{ blocks: string[] }>> }).content.flat().flatMap(cell => cell.blocks);
    const copyToggleId = cellBlocks(copyId)[0];
    const copyToggle = byId.get(copyToggleId);
    const copyKidId = copyToggle?.content?.[0] ?? '';

    expect({
      type: copyToggle?.type,
      kid: { id: copyKidId !== '' && copyKidId !== 'k' ? 'new' : copyKidId, parent: byId.get(copyKidId)?.parent, text: (byId.get(copyKidId)?.data as { text?: string } | undefined)?.text },
    }).toEqual({ type: 'toggle', kid: { id: 'new', parent: copyToggleId, text: 'Kid' } });
    expect(byId.get('tg')?.content).toEqual(['k']);
    expect(byId.get('k')?.parent).toBe('tg');

    // Every block under a table sits in exactly one of that table's cells.
    const subtree = (id: string): string[] => [id, ...(byId.get(id)?.content ?? []).flatMap(subtree)];

    for (const tableId of ['tbl', copyId]) {
      const owned = cellBlocks(tableId).flatMap(subtree);

      expect([...owned].sort()).toEqual(subtree(tableId).slice(1).sort());
      expect(new Set(owned).size).toBe(owned.length);
    }

    instance.module.yjsManager.stopCapturing();
    instance.history.undo();
    await flush();
    const afterUndo = await saveAsProduction(instance);

    expect(afterUndo.blocks.map(b => b.id)).toEqual(['tbl', 'tg', 'k', 'b', 'z']);
  }, 30_000);
  it('Cmd+D on a table copies a top-level cell block WITH its tunes, under a new id', async () => {
    const blocks = table2x2();
    const a = blocks.find(b => b.id === 'a');

    if (a !== undefined) {
      a.tunes = { marker: { mark: 'cell' } };
    }
    const instance = await boot([...blocks, P('z', undefined, 'after')]);
    const tbl = instance.module.blockManager.blocks.find(b => b.id === 'tbl') as Block;

    const copies = await instance.module.dragManager.duplicateBlocksInPlace(tbl);

    await flush();
    const out = await saveAsProduction(instance);
    const byId = new Map(out.blocks.map(b => [b.id, b] as const));
    const copyTable = byId.get(String(copies[0]?.id))?.data as { content: Array<Array<{ blocks: string[] }>> } | undefined;
    const copyCellId = copyTable?.content[0]?.[0]?.blocks[0] ?? '';

    expect({ newId: copyCellId !== '' && copyCellId !== 'a', tunes: byId.get(copyCellId)?.tunes })
      .toEqual({ newId: true, tunes: { marker: { mark: 'cell' } } });
    expect(byId.get('a')?.tunes).toEqual({ marker: { mark: 'cell' } });
  }, 30_000);
});
