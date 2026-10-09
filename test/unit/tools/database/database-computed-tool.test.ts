import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockAPI } from '../../../../types';
import type { DatabaseData, DatabaseRowData, PropertyDefinition, PropertyValue } from '../../../../src/tools/database/types';
import { DatabaseTool } from '../../../../src/tools/database';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

vi.mock('../../../../src/components/utils/popover', () => {
  class MockPopoverDesktop {
    show(): void {}

    hide(): void {}

    destroy(): void {}

    on(): void {}

    off(): void {}

    getElement(): HTMLElement {
      return document.createElement('div');
    }
  }

  return { PopoverDesktop: MockPopoverDesktop, PopoverMobile: MockPopoverDesktop, PopoverItemType: { Default: 'default', Separator: 'separator', Html: 'html' } };
});

/** A row block that keeps its data, so a write shows up on the next read. */
interface FakeRow {
  block: BlockAPI;
  data: DatabaseRowData;
}

const fakeRow = (id: string, parentId: string, properties: Record<string, PropertyValue>, position: string): FakeRow => {
  const row: FakeRow = { data: { properties: { ...properties }, position }, block: undefined as unknown as BlockAPI };

  row.block = {
    id,
    name: 'database-row',
    parentId,
    holder: document.createElement('div'),
    get preservedData() {
      return row.data;
    },
    call: vi.fn((method: string, param: unknown) => {
      if (method === 'readData') (param as { receive: (d: DatabaseRowData) => void }).receive(row.data);
      if (method === 'updateProperties') row.data = { ...row.data, properties: { ...row.data.properties, ...(param as Record<string, PropertyValue>) } };
    }),
    dispatchChange: vi.fn(),
  } as unknown as BlockAPI;

  return row;
};

interface Doc {
  api: API;
  rows: Map<string, FakeRow>;
  transact: ReturnType<typeof vi.fn>;
  deleted: string[];
}

const makeDoc = (rows: FakeRow[]): Doc => {
  const map = new Map(rows.map((r) => [r.block.id, r]));
  const order = rows.map((r) => r.block.id);
  const transact = vi.fn((fn: () => void) => fn());
  const deleted: string[] = [];
  const api = {
    styles: { block: 'blok-block' },
    i18n: { t: (key: string) => key },
    events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
    blocks: {
      getChildren: vi.fn((parentId: string) => order.filter((id) => !deleted.includes(id)).map((id) => map.get(id)?.block).filter((b): b is BlockAPI => b !== undefined && (b as unknown as { parentId: string }).parentId === parentId)),
      getBlocksCount: vi.fn(() => 1),
      getBlockByIndex: vi.fn(),
      getBlockIndex: vi.fn((id: string) => order.indexOf(id)),
      delete: vi.fn((index: number) => {
        deleted.push(order[index]);
      }),
      getById: vi.fn(() => null),
      insertAt: vi.fn(),
      transact,
    },
    notifier: { show: vi.fn() },
    viewState: { get: vi.fn(), set: vi.fn() },
    tools: { getBlockTools: vi.fn(() => []), getToolsConfig: vi.fn(() => ({ tools: undefined })) },
  } as unknown as API;

  return { api, rows: map, transact, deleted };
};

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'amount', name: 'Amount', type: 'number', position: 'a1' },
  { id: 'double', name: 'Double', type: 'formula', position: 'a2', formula: { expression: '{{property:amount}} * 2' } },
  { id: 'next', name: 'Next', type: 'relation', position: 'a3', relation: { targetDatabaseId: 'db', twoWay: true, syncedPropertyId: 'prev' } },
  { id: 'prev', name: 'Prev', type: 'relation', position: 'a4', relation: { targetDatabaseId: 'db', twoWay: true, syncedPropertyId: 'next' } },
  { id: 'related', name: 'Related', type: 'relation', position: 'a5', relation: { targetDatabaseId: 'db' } },
  { id: 'total', name: 'Total', type: 'rollup', position: 'a6', rollup: { relationPropertyId: 'next', targetPropertyId: 'amount', function: 'sum' } },
];

const data: DatabaseData = {
  schema,
  views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['amount', 'double', 'next', 'prev', 'related', 'total'] }],
  activeViewId: 'v',
};

const build = (doc: Doc): { tool: DatabaseTool; el: HTMLElement } => {
  const tool = new DatabaseTool({ data, config: {}, api: doc.api, readOnly: false, block: { id: 'db', dispatchChange: vi.fn() } as never });
  const el = tool.render();

  document.body.appendChild(el);
  tool.rendered();

  return { tool, el };
};

const cell = (el: HTMLElement, rowId: string, propertyId: string): HTMLElement | null =>
  el.querySelector<HTMLElement>(`[data-row-id="${rowId}"] [data-property-id="${propertyId}"]`);

/** Reaches the private commit path the table and the drawer share. */
const commit = (tool: DatabaseTool, rowId: string, propertyId: string, value: PropertyValue): void => {
  (tool as unknown as { commitTableCell: (r: string, p: string, v: PropertyValue) => void }).commitTableCell(rowId, propertyId, value);
};

describe('DatabaseTool — computed properties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('shows a formula value in its table cell and never stores it', () => {
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha', amount: 3 }, 'a0')]);
    const { el } = build(doc);

    expect(cell(el, 'a', 'double')?.textContent).toBe('6');
    expect(doc.rows.get('a')?.data.properties.double).toBeUndefined();
  });

  it('refuses a write to a formula', () => {
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha', amount: 3 }, 'a0')]);
    const { tool } = build(doc);

    commit(tool, 'a', 'double', 99);

    expect(doc.rows.get('a')?.data.properties.double).toBeUndefined();
  });

  it('writes both sides of a two-way relation in one undo step', () => {
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha' }, 'a0'), fakeRow('b', 'db', { title: 'Bravo' }, 'a1')]);
    const { tool } = build(doc);

    doc.transact.mockClear();
    commit(tool, 'a', 'next', [{ id: 'b' }]);

    expect(doc.transact).toHaveBeenCalledTimes(1);
    expect(doc.rows.get('a')?.data.properties.next).toEqual([{ id: 'b' }]);
    expect(doc.rows.get('b')?.data.properties.prev).toEqual([{ id: 'a' }]);
  });

  it('removes the other side when a two-way relation is cleared', () => {
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha', next: [{ id: 'b' }] }, 'a0'), fakeRow('b', 'db', { title: 'Bravo', prev: [{ id: 'a' }] }, 'a1')]);
    const { tool } = build(doc);

    commit(tool, 'b', 'prev', []);

    expect(doc.rows.get('b')?.data.properties.prev).toEqual([]);
    expect(doc.rows.get('a')?.data.properties.next).toEqual([]);
  });

  it('draws related rows as chips with their titles, and a one-way self-relation both ways', () => {
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha', related: [{ id: 'b' }] }, 'a0'), fakeRow('b', 'db', { title: 'Bravo' }, 'a1')]);
    const { el } = build(doc);
    const chips = (rowId: string): string[] => [...(cell(el, rowId, 'related')?.querySelectorAll('[data-blok-database-relation-chip]') ?? [])].map((c) => c.textContent ?? '');

    expect(chips('a')).toEqual(['Bravo']);
    expect(chips('b')).toEqual(['Alpha']);
  });

  it('rolls up the related rows', () => {
    const doc = makeDoc([
      fakeRow('a', 'db', { title: 'Alpha', amount: 1, next: [{ id: 'b' }, { id: 'c' }] }, 'a0'),
      fakeRow('b', 'db', { title: 'Bravo', amount: 2 }, 'a1'),
      fakeRow('c', 'db', { title: 'Charlie', amount: 5 }, 'a2'),
    ]);
    const { el } = build(doc);

    expect(cell(el, 'a', 'total')?.textContent).toBe('7');
  });

  it('takes a deleted row out of the relations that point at it, in the same step', () => {
    const doc = makeDoc([
      fakeRow('a', 'db', { title: 'Alpha', related: [{ id: 'b' }], next: [{ id: 'b' }] }, 'a0'),
      fakeRow('b', 'db', { title: 'Bravo', prev: [{ id: 'a' }] }, 'a1'),
    ]);
    const { tool } = build(doc);

    doc.transact.mockClear();
    (tool as unknown as { deleteRowBlock: (id: string) => void }).deleteRowBlock('b');

    expect(doc.deleted).toEqual(['b']);
    expect(doc.transact).toHaveBeenCalledTimes(1);
    expect(doc.rows.get('a')?.data.properties.related).toEqual([]);
    expect(doc.rows.get('a')?.data.properties.next).toEqual([]);
  });

  it('answers another database with its schema and computed rows', () => {
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha', amount: 4 }, 'a0')]);
    const { tool } = build(doc);
    const received: Array<{ schema: PropertyDefinition[]; rows: Array<{ id: string; computed?: Record<string, PropertyValue> }> }> = [];

    tool.readRelationSource({ receive: (source) => received.push(source) });

    expect(received[0]?.schema.map((p) => p.id)).toContain('double');
    expect(received[0]?.rows[0]?.computed?.double).toBe(8);
  });
});
