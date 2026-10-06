/**
 * Fill right/down and grip-menu duplicate row/column on a real editor must
 * copy a cell's container blocks WITH their nesting: one parent per copy,
 * its children under it, nothing flattened, dropped or doubled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import { Table } from '../../../../../src/tools/table/index';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { List, Toggle } from '../../../../../src/tools';
import type { API, OutputBlockData, OutputData } from '../../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  module: {
    yjsManager: { stopCapturing: () => void; toJSON: () => OutputBlockData[] };
    blockManager: { blocks: Array<{ id: string }> };
  };
}

interface Range { minRow: number; maxRow: number; minCol: number; maxCol: number }

type Cell = { blocks: string[]; color?: string; textColor?: string };

/** A persisted tune, so the copies can be checked for tune data at every depth. */
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
    tools: { paragraph: Paragraph, table: Table, toggle: Toggle, list: List, marker: MarkerTune },
    tunes: ['marker'],
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await flush();
  instance.module.yjsManager.stopCapturing();

  return instance;
};

const RED = '<mark style="color: var(--blok-color-red-text);">Red</mark>';

/**
 * 2x2 grid. [0][0]: open toggle + child paragraph (with a tune).
 * [1][0]: checked checklist item + nested depth-1 item. [0][1], [1][1]: plain.
 */
const nestedDoc = (): OutputBlockData[] => [
  {
    id: 'tbl',
    type: 'table',
    data: {
      withHeadings: false,
      content: [
        [{ blocks: ['tg'], color: '#ff0000', textColor: '#00ff00' }, { blocks: ['b'] }],
        [{ blocks: ['l1'] }, { blocks: ['d'] }],
      ],
    },
    content: ['tg', 'b', 'l1', 'd'],
  },
  { id: 'tg', type: 'toggle', parent: 'tbl', data: { text: 'Toggle' }, content: ['k'] },
  { id: 'k', type: 'paragraph', parent: 'tg', data: { text: RED }, tunes: { marker: { mark: 'kid' } } },
  { id: 'b', type: 'paragraph', parent: 'tbl', data: { text: 'B' } },
  { id: 'l1', type: 'list', parent: 'tbl', data: { text: 'L1', style: 'checklist', checked: true }, content: ['l2'] },
  { id: 'l2', type: 'list', parent: 'l1', data: { text: 'L2', style: 'checklist', checked: false, depth: 1 } },
  { id: 'd', type: 'paragraph', parent: 'tbl', data: { text: 'D' } },
  { id: 'after', type: 'paragraph', data: { text: 'after' } },
];

interface Node {
  type: string;
  data: Record<string, unknown>;
  tunes?: Record<string, unknown>;
  children: Node[];
}

const savedTable = (out: OutputData): { content: Cell[][] } =>
  out.blocks.find(b => b.id === 'tbl')?.data as { content: Cell[][] };

/** A cell's saved blocks as a tree built from the `content` links. */
const cellTree = (out: OutputData, row: number, col: number): Node[] => {
  const byId = new Map(out.blocks.map(b => [b.id, b] as const));
  const build = (id: string): Node => {
    const block = byId.get(id);

    if (block === undefined) {
      return { type: `<missing ${id}>`, data: {}, children: [] };
    }

    return {
      type: block.type,
      data: block.data,
      ...(block.tunes ? { tunes: block.tunes } : {}),
      children: (block.content ?? []).map(build),
    };
  };

  return savedTable(out).content[row][col].blocks.map(build);
};

/** Ids of every block a cell owns, top-level and nested. */
const cellSubtreeIds = (out: OutputData, row: number, col: number): string[] => {
  const byId = new Map(out.blocks.map(b => [b.id, b] as const));
  const walk = (id: string): string[] => [id, ...(byId.get(id)?.content ?? []).flatMap(walk)];

  return savedTable(out).content[row][col].blocks.flatMap(walk);
};

/** Every parent/content pair agrees, and every table descendant sits in exactly one cell. */
const expectConsistentTree = (out: OutputData): void => {
  const byId = new Map(out.blocks.map(b => [b.id, b] as const));

  out.blocks.forEach(block => {
    (block.content ?? []).forEach(childId => {
      expect(byId.get(childId)?.parent, `${childId} parent`).toBe(block.id);
    });
    if (block.parent !== undefined) {
      expect(byId.get(block.parent)?.content ?? [], `${block.parent} content lists ${block.id}`).toContain(block.id);
    }
  });

  const content = savedTable(out).content;
  const owned = content.flatMap((row, r) => row.flatMap((_, c) => cellSubtreeIds(out, r, c)));
  const descendants = (id: string): string[] => (byId.get(id)?.content ?? []).flatMap(child => [child, ...descendants(child)]);

  expect([...owned].sort()).toEqual([...descendants('tbl')].sort());
  expect(new Set(owned).size).toBe(owned.length);
};

const TOGGLE_TREE: Node[] = [{
  type: 'toggle',
  data: { text: 'Toggle' },
  children: [{ type: 'paragraph', data: { text: RED }, tunes: { marker: { mark: 'kid' } }, children: [] }],
}];

const CHECKLIST_TREE: Node[] = [{
  type: 'list',
  data: { text: 'L1', style: 'checklist', checked: true },
  children: [{ type: 'list', data: { text: 'L2', style: 'checklist', checked: false, depth: 1 }, children: [] }],
}];

/** Saved trees keep only the fields the fixtures pin. */
const pick = (nodes: Node[]): Node[] => nodes.map(node => ({
  type: node.type,
  data: Object.fromEntries(Object.entries(node.data).filter(([key]) => ['text', 'style', 'checked', 'depth'].includes(key))),
  // The tune saves `{}` on blocks that never had a mark.
  ...(Object.keys(node.tunes?.marker ?? {}).length > 0 ? { tunes: { marker: node.tunes?.marker } } : {}),
  children: pick(node.children),
}));

const tableTool = (instance: TestEditor): { subsystems: { cellSelectionSubsystem: { selectRange: (r: Range) => void } | null } } => {
  const block = instance.module.blockManager.blocks.find(b => b.id === 'tbl');

  return (block as unknown as { toolInstance: { subsystems: { cellSelectionSubsystem: { selectRange: (r: Range) => void } | null } } }).toolInstance;
};

const fill = async (instance: TestEditor, range: Range, key: 'r' | 'd'): Promise<void> => {
  const selection = tableTool(instance).subsystems.cellSelectionSubsystem;

  if (selection === null) {
    throw new Error('no cell selection');
  }
  selection.selectRange(range);
  document.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey: true, bubbles: true, cancelable: true }));
  await flush();
};

const menuAction = async (kind: 'row' | 'col', index: number, title: string): Promise<void> => {
  const grip = holder?.querySelector<HTMLElement>(`[data-blok-table-grip-${kind}="${index}"]`);

  if (!grip) {
    throw new Error(`no ${kind} grip ${index}`);
  }
  grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const item = Array.from(document.querySelectorAll<HTMLElement>('[data-blok-popover-item]'))
    .find(el => el.querySelector('[data-blok-popover-item-title]')?.textContent === title);

  if (!item) {
    throw new Error(`no "${title}" item`);
  }
  item.click();
  await flush();
};

const SOURCE_IDS = ['tg', 'k', 'l1', 'l2'];

describe('fill and duplicate keep nested blocks in cells', () => {
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

  it('baseline: the fixture saves with nesting and top-level cell refs', async () => {
    const instance = await boot(nestedDoc());
    const out = await instance.save();

    expect(savedTable(out).content.map(row => row.map(cell => cell.blocks))).toEqual([[['tg'], ['b']], [['l1'], ['d']]]);
    expect(pick(cellTree(out, 0, 0))).toEqual(TOGGLE_TREE);
    expect(pick(cellTree(out, 1, 0))).toEqual(CHECKLIST_TREE);
    expectConsistentTree(out);
  }, 30_000);

  it('fill right copies the toggle and the checklist with their children nested', async () => {
    const instance = await boot(nestedDoc());

    await fill(instance, { minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 }, 'r');
    const out = await instance.save();

    expect(pick(cellTree(out, 0, 1))).toEqual(TOGGLE_TREE);
    expect(pick(cellTree(out, 1, 1))).toEqual(CHECKLIST_TREE);
    expect(pick(cellTree(out, 0, 0))).toEqual(TOGGLE_TREE);
    expect(pick(cellTree(out, 1, 0))).toEqual(CHECKLIST_TREE);
    expect(cellSubtreeIds(out, 0, 1).concat(cellSubtreeIds(out, 1, 1)).filter(id => SOURCE_IDS.includes(id))).toEqual([]);
    expectConsistentTree(out);
  }, 30_000);

  it('fill down copies the toggle with its child nested, over a nested target', async () => {
    const instance = await boot(nestedDoc());

    await fill(instance, { minRow: 0, maxRow: 1, minCol: 0, maxCol: 0 }, 'd');
    const out = await instance.save();

    expect(pick(cellTree(out, 1, 0))).toEqual(TOGGLE_TREE);
    expect(pick(cellTree(out, 0, 0))).toEqual(TOGGLE_TREE);
    expect(out.blocks.filter(b => b.id === 'l1' || b.id === 'l2')).toEqual([]);
    expectConsistentTree(out);
  }, 30_000);

  it('fill down from a plain cell over a nested checklist removes the whole old subtree', async () => {
    const instance = await boot([
      {
        id: 'tbl',
        type: 'table',
        data: { withHeadings: false, content: [[{ blocks: ['p'] }], [{ blocks: ['l1'] }]] },
        content: ['p', 'l1'],
      },
      { id: 'p', type: 'paragraph', parent: 'tbl', data: { text: 'P' } },
      { id: 'l1', type: 'list', parent: 'tbl', data: { text: 'L1', style: 'checklist', checked: true }, content: ['l2'] },
      { id: 'l2', type: 'list', parent: 'l1', data: { text: 'L2', style: 'checklist', checked: false, depth: 1 } },
    ]);

    await fill(instance, { minRow: 0, maxRow: 1, minCol: 0, maxCol: 0 }, 'd');
    const out = await instance.save();

    expect(pick(cellTree(out, 1, 0))).toEqual([{ type: 'paragraph', data: { text: 'P' }, children: [] }]);
    expect(pick(cellTree(out, 0, 0))).toEqual([{ type: 'paragraph', data: { text: 'P' }, children: [] }]);
    expect(out.blocks.filter(b => b.id === 'l1' || b.id === 'l2')).toEqual([]);
    expectConsistentTree(out);
  }, 30_000);

  it('duplicate row copies the toggle with its child nested', async () => {
    const instance = await boot(nestedDoc());

    await menuAction('row', 0, 'Duplicate');
    const out = await instance.save();

    expect(pick(cellTree(out, 1, 0))).toEqual(TOGGLE_TREE);
    expect(savedTable(out).content[1][0]).toMatchObject({ color: '#ff0000', textColor: '#00ff00' });
    expect(pick(cellTree(out, 0, 0))).toEqual(TOGGLE_TREE);
    expect(pick(cellTree(out, 2, 0))).toEqual(CHECKLIST_TREE);
    expect(cellSubtreeIds(out, 1, 0).filter(id => SOURCE_IDS.includes(id))).toEqual([]);
    expectConsistentTree(out);
  }, 30_000);

  it('duplicate column copies the toggle and the checklist with their children nested', async () => {
    const instance = await boot(nestedDoc());

    await menuAction('col', 0, 'Duplicate');
    const out = await instance.save();

    expect(pick(cellTree(out, 0, 1))).toEqual(TOGGLE_TREE);
    expect(pick(cellTree(out, 1, 1))).toEqual(CHECKLIST_TREE);
    expect(pick(cellTree(out, 0, 0))).toEqual(TOGGLE_TREE);
    expect(pick(cellTree(out, 1, 0))).toEqual(CHECKLIST_TREE);
    expect(cellSubtreeIds(out, 0, 1).concat(cellSubtreeIds(out, 1, 1)).filter(id => SOURCE_IDS.includes(id))).toEqual([]);
    expectConsistentTree(out);
  }, 30_000);

  it('duplicates a root page reference without copying its stale title or URL to Yjs', async () => {
    const instance = await boot([
      {
        id: 'tbl',
        type: 'table',
        data: { withHeadings: false, content: [[{ blocks: ['b'] }]] },
        content: ['b'],
      },
      { id: 'b', type: 'paragraph', parent: 'tbl', data: { text: 'Before' } },
    ]);
    const stale = '<a data-blok-page-id="p1" href="https://example.test/old-title" title="Old title">Old title</a>';

    await instance.blocks.update('b', { text: stale });
    await menuAction('row', 0, 'Duplicate');

    const copiedId = holder?.querySelector<HTMLElement>(
      '[data-blok-table-cell-row="1"][data-blok-table-cell-col="0"] > [data-blok-table-cell-blocks] > [data-blok-id]'
    )?.getAttribute('data-blok-id');

    if (copiedId === undefined || copiedId === null) {
      throw new Error('no copied root block');
    }

    const copied = instance.module.yjsManager.toJSON().find(block => block.id === copiedId);

    expect(copied?.data.text).toBe('<a data-blok-page-id="p1">Page</a>');
  }, 30_000);

  it('a duplicated child does not share its data object with the source child', async () => {
    const instance = await boot(nestedDoc());

    await menuAction('col', 0, 'Duplicate');
    const before = await instance.save();
    const copyChildId = before.blocks.find(b => b.id === savedTable(before).content[0][1].blocks[0])?.content?.[0];

    if (copyChildId === undefined) {
      throw new Error('copy has no child');
    }
    await instance.blocks.update(copyChildId, { text: 'Changed' });
    await flush();
    const out = await instance.save();

    expect(out.blocks.find(b => b.id === 'k')?.data).toMatchObject({ text: RED });
    expect(out.blocks.find(b => b.id === copyChildId)?.data).toMatchObject({ text: 'Changed' });
  }, 30_000);
});
