/**
 * A list item nested under another list item in a table cell must mount in
 * that cell, beside its parent, the way it does inside a toggle. Cell clears
 * find blocks through the cell's DOM, so a child left outside is never cleared.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import { ListItem } from '../../../../../src/tools/list';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Table } from '../../../../../src/tools/table/index';
import type { TableConfig, TableData } from '../../../../../src/tools/table/types';
import type { BlockToolConstructorOptions, OutputBlockData, OutputData } from '../../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  blocks: { update: (id: string, data: Record<string, unknown>) => Promise<unknown> };
  history: { undo: () => void };
  module: { yjsManager: { stopCapturing: () => void } };
  save: () => Promise<OutputData>;
  destroy: () => void;
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

const tables = new Map<string, Table>();

class TrackedTable extends Table {
  constructor(options: BlockToolConstructorOptions<TableData, TableConfig>) {
    super(options);
    tables.set(options.block?.id ?? '', this);
  }
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const boot = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, table: TrackedTable, list: ListItem },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await flush();
  instance.module.yjsManager.stopCapturing();

  return instance;
};

const item = (id: string, text: string, extra: Partial<OutputBlockData> = {}): OutputBlockData =>
  ({ id, type: 'list', data: { text, style: 'unordered' }, ...extra });

const P = (id: string, text: string, parent?: string): OutputBlockData =>
  ({ id, type: 'paragraph', data: { text }, ...(parent !== undefined ? { parent } : {}) });

/** l2 is a child of l1, and l3 of l2, through parent/content. */
const hierarchical = (): OutputBlockData[] => [
  {
    id: 'tbl',
    type: 'table',
    data: { withHeadings: false, content: [[{ blocks: ['l1'] }, { blocks: ['b'] }], [{ blocks: ['c'] }, { blocks: ['d'] }]] },
    content: ['l1', 'b', 'c', 'd'],
  },
  item('l1', 'one', { parent: 'tbl', content: ['l2'] }),
  item('l2', 'two', { parent: 'l1', content: ['l3'] }),
  item('l3', 'three', { parent: 'l2' }),
  P('b', 'B', 'tbl'),
  P('c', 'C', 'tbl'),
  P('d', 'D', 'tbl'),
  P('after', 'after'),
];

const cellContainer = (row: number, col: number): HTMLElement => {
  const grid = holder?.querySelector<HTMLTableElement>('[data-blok-id="tbl"] table');
  const container = grid?.tBodies[0].rows[row].cells[col].querySelector<HTMLElement>('[data-blok-nested-blocks]');

  if (container === null || container === undefined) {
    throw new Error(`no container for cell ${row},${col}`);
  }

  return container;
};

interface SelectionRange { minRow: number; maxRow: number; minCol: number; maxCol: number }

/** Select a cell range and run the real document copy handler. */
const copyRange = (range: SelectionRange): Record<string, string> => {
  const selection = (tables.get('tbl') as unknown as { subsystems?: { cellSelectionSubsystem: { selectRange: (r: SelectionRange) => void } | null } } | undefined)
    ?.subsystems?.cellSelectionSubsystem;

  if (selection === null || selection === undefined) {
    throw new Error('no cell selection');
  }
  selection.selectRange(range);

  const store: Record<string, string> = {};
  const event = new Event('copy', { bubbles: true, cancelable: true });

  Object.defineProperty(event, 'clipboardData', {
    value: {
      setData: (type: string, value: string): void => {
        store[type] = value;
      },
      getData: (type: string): string => store[type] ?? '',
    },
  });
  document.dispatchEvent(event);

  return store;
};

const paste = async (target: HTMLElement, data: Record<string, string>): Promise<void> => {
  const event = new Event('paste', { bubbles: true, cancelable: true });

  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string): string => data[type] ?? '', types: Object.keys(data) },
  });
  target.setAttribute('contenteditable', 'true');
  target.focus();
  target.dispatchEvent(event);
  await flush();
};

const menuAction = async (kind: 'row' | 'col', index: number, title: string): Promise<void> => {
  const grip = holder?.querySelector<HTMLElement>(`[data-blok-table-grip-${kind}="${index}"]`);

  if (!grip) {
    throw new Error(`no ${kind} grip ${index}`);
  }
  grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const menuItem = Array.from(document.querySelectorAll<HTMLElement>('[data-blok-popover-item]'))
    .find(candidate => candidate.querySelector('[data-blok-popover-item-title]')?.textContent === title);

  if (!menuItem) {
    throw new Error(`no "${title}" item`);
  }
  menuItem.click();
  await flush();
};

/** Ids of block holders that render outside the table but are not top-level blocks of the saved doc. */
const strayOutsideTable = (out: OutputData): string[] => {
  const roots = new Set(out.blocks.filter(b => b.parent === undefined || b.parent === null).map(b => b.id));
  const table = holder?.querySelector('[data-blok-id="tbl"]');

  return Array.from(holder?.querySelectorAll('[data-blok-id]') ?? [])
    .filter(el => table?.contains(el) !== true)
    .map(el => el.getAttribute('data-blok-id') ?? '')
    .filter(id => !roots.has(id));
};

describe('a nested list item in a table cell', () => {
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
    tables.clear();
    vi.restoreAllMocks();
  });

  it('mounts in its parent\'s cell, right after its parent', async () => {
    const instance = await boot(hierarchical());

    const ids = Array.from(cellContainer(0, 0).children).map(el => el.getAttribute('data-blok-id'));

    expect(ids).toEqual(['l1', 'l2', 'l3']);

    const out = await instance.save();
    const content = (out.blocks.find(b => b.id === 'tbl')?.data as { content: Array<Array<{ blocks: string[] }>> }).content;

    expect({ cell: content[0][0].blocks, l2: out.blocks.find(b => b.id === 'l2')?.parent })
      .toEqual({ cell: ['l1'], l2: 'l1' });
  }, 30_000);

  it('given by depth, mounts in its cell', async () => {
    await boot([
      {
        id: 'tbl',
        type: 'table',
        data: { withHeadings: false, content: [[{ blocks: ['l1', 'l2'] }, { blocks: ['b'] }]] },
      },
      item('l1', 'one', { parent: 'tbl' }),
      { id: 'l2', type: 'list', data: { text: 'two', style: 'unordered', depth: 1 }, parent: 'tbl' },
      P('b', 'B', 'tbl'),
    ]);

    const ids = Array.from(cellContainer(0, 0).children).map(el => el.getAttribute('data-blok-id'));

    expect(ids).toEqual(['l1', 'l2']);
  }, 30_000);

  it('is gone after Clear contents on its row', async () => {
    const instance = await boot(hierarchical());

    await menuAction('row', 0, 'Clear contents');
    const out = await instance.save();

    expect(out.blocks.map(b => b.id).filter(id => id === 'l2' || id === 'l3')).toEqual([]);
    expect(strayOutsideTable(out)).toEqual([]);
  }, 30_000);

  it.each([['row'], ['col']] as const)('is gone after its %s is deleted', async (kind) => {
    const instance = await boot(hierarchical());

    await menuAction(kind, 0, 'Delete');
    const out = await instance.save();

    expect(out.blocks.map(b => b.id).filter(id => id === 'l2' || id === 'l3')).toEqual([]);
    expect(strayOutsideTable(out)).toEqual([]);
  }, 30_000);

  it('stays in its cell when the table gets the same content again', async () => {
    const instance = await boot(hierarchical());

    await instance.blocks.update('tbl', {
      content: [[{ blocks: ['l1'] }, { blocks: ['b'] }], [{ blocks: ['c'] }, { blocks: ['d'] }]],
    });
    await flush();
    const out = await instance.save();
    const ids = Array.from(cellContainer(0, 0).children).map(el => el.getAttribute('data-blok-id'));

    expect({ ids, saved: out.blocks.map(b => b.id).filter(id => id === 'l2' || id === 'l3') })
      .toEqual({ ids: ['l1', 'l2', 'l3'], saved: ['l2', 'l3'] });
  }, 30_000);

  it('is copied once, inside its parent, when its cell is copied into another cell', async () => {
    const instance = await boot(hierarchical());
    const data = copyRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });
    const target = cellContainer(1, 1).querySelector('[data-blok-element-content]')?.firstElementChild;

    if (!(target instanceof HTMLElement)) {
      throw new Error('no editable in cell 1,1');
    }
    await paste(target, data);
    const out = await instance.save();
    const texts = out.blocks.map(b => String((b.data as { text?: string }).text ?? ''));

    expect({ two: texts.filter(t => t === 'two').length, three: texts.filter(t => t === 'three').length })
      .toEqual({ two: 2, three: 2 });

    const content = (out.blocks.find(b => b.id === 'tbl')?.data as { content: Array<Array<{ blocks: string[] }>> }).content;
    const [copiedL1] = content[1][1].blocks;
    const copiedL2 = out.blocks.find(b => b.id !== 'l2' && (b.data as { text?: string }).text === 'two');

    expect({ refs: content[1][1].blocks.length, l2Parent: copiedL2?.parent })
      .toEqual({ refs: 1, l2Parent: copiedL1 });
  }, 30_000);

  it('comes back in its cell, under its parent, when its row delete is undone', async () => {
    const instance = await boot(hierarchical());

    await menuAction('row', 0, 'Delete');
    instance.module.yjsManager.stopCapturing();
    instance.history.undo();
    await flush();
    const out = await instance.save();
    const parentOf = (id: string): unknown => out.blocks.find(b => b.id === id)?.parent;
    const ids = Array.from(cellContainer(0, 0).children).map(el => el.getAttribute('data-blok-id'));

    expect({ l1: parentOf('l1'), l2: parentOf('l2'), l3: parentOf('l3'), ids })
      .toEqual({ l1: 'tbl', l2: 'l1', l3: 'l2', ids: ['l1', 'l2', 'l3'] });
  }, 30_000);
});
