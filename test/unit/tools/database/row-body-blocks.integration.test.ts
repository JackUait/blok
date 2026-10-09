import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { API, OutputBlockData, OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  history: { undo: () => void; redo: () => void };
}

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

const quiet = async (): Promise<void> => {
  await settle();
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => {
      requestAnimationFrame(() => resolve(undefined));
    });
  }
  await settle();
};

const databaseBlock = (overrides: Record<string, unknown> = {}): OutputBlockData => ({
  id: 'db',
  type: 'database',
  data: {
    schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }],
    views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
    activeViewId: 'v',
    ...overrides,
  },
  content: ['r1', 'r2'],
});

const docWithBodies = (): OutputBlockData[] => [
  { id: 'p0', type: 'paragraph', data: { text: 'before' } },
  databaseBlock(),
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One' }, position: 'a0' }, content: ['c1'] },
  { id: 'c1', type: 'paragraph', parent: 'r1', data: { text: 'first body' } },
  { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Two' }, position: 'a1' } },
  { id: 'p2', type: 'paragraph', data: { text: 'after' } },
];

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (blocks: OutputBlockData[], readOnly = false): Promise<TestEditor> => {
  editor = new Blok({
    holder,
    readOnly,
    dataModel: 'hierarchical',
    tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
    data: { blocks },
  } as never) as unknown as TestEditor;
  await editor.isReady;
  await quiet();

  return editor;
};

const holderOf = (id: string): HTMLElement | null =>
  holder?.querySelector<HTMLElement>(`[data-blok-element][data-blok-id="${id}"]`) ?? null;

const databaseHolder = (): HTMLElement | null => holderOf('db');

const drawerBody = (): HTMLElement | null =>
  holder?.querySelector<HTMLElement>('[data-blok-database-drawer-editor]') ?? null;

const openRow = async (rowId: string): Promise<void> => {
  const button = holder?.querySelector<HTMLElement>(`[data-row-id="${rowId}"] [data-blok-database-table-open]`)
    ?? holder?.querySelector<HTMLElement>(`[data-blok-database-table-open][data-row-id="${rowId}"]`);

  button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await quiet();
};

const pressEscape = async (): Promise<void> => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await quiet();
};

const legacyDoc = (): OutputBlockData[] => [
  {
    ...databaseBlock(),
    data: {
      ...databaseBlock().data,
      schema: [
        { id: 't', name: 'Name', type: 'title', position: 'a0' },
        { id: 'd', name: 'Card details', type: 'richText', position: 'a1' },
      ],
    },
    content: ['r1'],
  },
  {
    id: 'r1',
    type: 'database-row',
    parent: 'db',
    data: {
      properties: {
        t: 'Old',
        d: { blocks: [{ id: 'x', type: 'paragraph', data: { text: 'legacy one' } }, { id: 'y', type: 'paragraph', data: { text: 'legacy two' } }] },
      },
      position: 'a0',
    },
  },
];

describe('row bodies are child blocks of the row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    vi.restoreAllMocks();
  });

  it('keeps row holders and their body blocks inside the database, hidden until opened', async () => {
    await make(docWithBodies());

    const db = databaseHolder();

    expect(db?.contains(holderOf('r1'))).toBe(true);
    expect(db?.contains(holderOf('r2'))).toBe(true);
    expect(db?.contains(holderOf('c1'))).toBe(true);
    expect(holderOf('r1')?.classList.contains('hidden')).toBe(true);
    expect(holderOf('r2')?.classList.contains('hidden')).toBe(true);
    expect(holderOf('r1')?.contains(holderOf('c1'))).toBe(true);
    expect(db?.contains(holderOf('p2'))).toBe(false);
  });

  it('saves the body blocks under their row', async () => {
    await make(docWithBodies());

    const saved = await editor?.save();
    const body = saved?.blocks.find((block) => block.id === 'c1');
    const row = saved?.blocks.find((block) => block.id === 'r1');

    expect(body?.parent).toBe('r1');
    expect(row?.content).toEqual(['c1']);
  });

  it('places a body block inserted later into its row', async () => {
    await make(docWithBodies());

    const added = editor?.blocks.insertInsideParent('r2', 0, { text: 'new' }, 'paragraph');

    await quiet();

    expect(added?.holder.parentElement?.closest('[data-blok-element]')).toBe(holderOf('r2'));
    expect((await editor?.save())?.blocks.find((block) => block.id === added?.id)?.parent).toBe('r2');
  });

  it('places a row added later inside the database, hidden', async () => {
    await make(docWithBodies());

    const row = editor?.blocks.insertInsideParent('db', 2, { properties: { t: 'Three' }, position: 'a2' }, 'database-row');

    await quiet();

    expect(databaseHolder()?.contains(row?.holder ?? null)).toBe(true);
    expect(row?.holder.classList.contains('hidden')).toBe(true);
  });

  it('brings a deleted row back with its body, inside the database, on undo', async () => {
    await make(docWithBodies());

    const index = editor?.blocks.getBlockIndex('r1');

    await editor?.blocks.delete(index);
    await quiet();

    expect(holderOf('c1')).toBeNull();

    editor?.history.undo();
    await quiet();

    expect(databaseHolder()?.contains(holderOf('c1'))).toBe(true);
    expect(holderOf('r1')?.contains(holderOf('c1'))).toBe(true);
    expect(holderOf('r1')?.classList.contains('hidden')).toBe(true);
    expect((await editor?.save())?.blocks.find((block) => block.id === 'c1')?.parent).toBe('r1');
  });

  it('shows the opened row holder as the page body and puts it back on close', async () => {
    await make(docWithBodies());
    await openRow('r1');

    expect(drawerBody()?.contains(holderOf('r1'))).toBe(true);
    expect(holderOf('r1')?.classList.contains('hidden')).toBe(false);
    expect(drawerBody()?.textContent).toContain('first body');

    await pressEscape();

    expect(holder?.querySelector('[data-blok-database-row-pool]')?.contains(holderOf('r1'))).toBe(true);
    expect(holderOf('r1')?.classList.contains('hidden')).toBe(true);
  });

  it('turns a legacy body into child blocks on open, keeps the blob, and adds no undo step', async () => {
    await make(legacyDoc());
    await openRow('r1');

    const saved = await editor?.save();
    const row = saved?.blocks.find((block) => block.id === 'r1');
    const body = saved?.blocks.filter((block) => block.parent === 'r1');

    expect(body?.map((block) => block.id)).toEqual(['r1-body-0', 'r1-body-1']);
    expect(row?.content).toEqual(['r1-body-0', 'r1-body-1']);
    expect((row?.data as { bodyBlocks?: boolean }).bodyBlocks).toBe(true);
    expect((row?.data as { properties: Record<string, unknown> }).properties.d).toEqual(expect.objectContaining({ blocks: expect.any(Array) }));
    expect(drawerBody()?.textContent).toContain('legacy two');

    editor?.history.undo();
    await quiet();

    expect((await editor?.save())?.blocks.filter((block) => block.parent === 'r1')).toHaveLength(2);
  });

  it('never converts a legacy body again once its blocks were removed', async () => {
    await make(legacyDoc());
    await openRow('r1');
    await editor?.blocks.delete(editor.blocks.getBlockIndex('r1-body-1'));
    await editor?.blocks.delete(editor.blocks.getBlockIndex('r1-body-0'));
    await pressEscape();
    await openRow('r1');

    expect((await editor?.save())?.blocks.filter((block) => block.parent === 'r1')).toHaveLength(0);
  });

  it('offers an empty page body as a placeholder that starts the first paragraph', async () => {
    await make(docWithBodies());
    await openRow('r2');

    const placeholder = drawerBody()?.querySelector<HTMLElement>('[data-blok-database-row-empty]');
    const shown = (): boolean | undefined =>
      placeholder?.matches('[data-blok-database-row-body]:empty ~ [data-blok-database-row-empty]:not(.hidden)');

    expect(shown()).toBe(true);
    expect((await editor?.save())?.blocks.filter((block) => block.parent === 'r2')).toHaveLength(0);

    placeholder?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await quiet();

    const body = (await editor?.save())?.blocks.filter((block) => block.parent === 'r2');

    expect(body?.map((block) => block.type)).toEqual(['paragraph']);
    expect(shown()).toBe(false);
  });

  it('declares the row a layout container that never nests another row', () => {
    expect(DatabaseRowTool.isLayout).toBe(true);
    expect(DatabaseRowTool.deletesChildren).toBe(true);
    expect(DatabaseRowTool.childTools).toEqual({ deny: ['database-row'] });
  });
});
