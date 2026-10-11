import { vi } from 'vitest';
import type { API, BlockAPI } from '../../../../types';
import type { DatabaseConfig, DatabaseData, DatabaseRowData, PropertyDefinition, PropertyValue } from '../../../../src/tools/database/types';
import { DatabaseTool } from '../../../../src/tools/database';

/** A row block that keeps its data, so a write shows up on the next read. */
export interface FakeRow {
  block: BlockAPI;
  data: DatabaseRowData;
  dispatchChange: ReturnType<typeof vi.fn>;
}

export const fakeRow = (id: string, parentId: string, properties: Record<string, PropertyValue>, position: string): FakeRow => {
  const dispatchChange = vi.fn();
  const row: FakeRow = { data: { properties: { ...properties }, position }, block: undefined as unknown as BlockAPI, dispatchChange };

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
    dispatchChange,
  } as unknown as BlockAPI;

  return row;
};

export interface Doc {
  api: API;
  rows: Map<string, FakeRow>;
  order: string[];
}

/** An editor double whose insertAt adds a real fake row, as core does. */
export const makeDoc = (rows: FakeRow[]): Doc => {
  const map = new Map(rows.map((r) => [r.block.id, r]));
  const order = rows.map((r) => r.block.id);
  const deleted: string[] = [];
  const listeners = new Map<string, Array<(data?: unknown) => void>>();
  const api = {
    styles: { block: 'blok-block' },
    i18n: { t: (key: string) => key },
    events: {
      on: vi.fn((name: string, cb: (data?: unknown) => void) => listeners.set(name, [...(listeners.get(name) ?? []), cb])),
      off: vi.fn(),
      emit: vi.fn((name: string, data?: unknown) => (listeners.get(name) ?? []).forEach((cb) => cb(data))),
    },
    blocks: {
      getChildren: vi.fn((parentId: string) => order.filter((id) => !deleted.includes(id)).map((id) => map.get(id)?.block).filter((b): b is BlockAPI => b !== undefined && (b as unknown as { parentId: string }).parentId === parentId)),
      getBlocksCount: vi.fn(() => 1),
      getBlockByIndex: vi.fn(),
      getBlockIndex: vi.fn((id: string) => order.indexOf(id)),
      delete: vi.fn((index: number) => {
        deleted.push(order[index]);
      }),
      getById: vi.fn(() => null),
      insertAt: vi.fn((_type: string, data: DatabaseRowData, options: { parentId: string; id: string }) => {
        const row = fakeRow(options.id, options.parentId, data.properties, data.position);

        map.set(options.id, row);
        order.push(options.id);
      }),
      transact: vi.fn((fn: () => void) => fn()),
    },
    notifier: { show: vi.fn() },
    viewState: { get: vi.fn(), set: vi.fn() },
    tools: { getBlockTools: vi.fn(() => []), getToolsConfig: vi.fn(() => ({ tools: undefined })) },
  } as unknown as API;

  return { api, rows: map, order };
};

export const SCHEMA: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'notes', name: 'Notes', type: 'text', position: 'a1' },
  { id: 'where', name: 'Where', type: 'place', position: 'a2' },
];

export const tableData = (schema: PropertyDefinition[] = SCHEMA, extra: Partial<DatabaseData['views'][number]> = {}): DatabaseData => ({
  schema,
  views: [{
    id: 'v',
    name: 'View',
    type: 'table',
    position: 'a0',
    sorts: [],
    filters: [],
    visibleProperties: schema.filter((p) => p.type !== 'title').map((p) => p.id),
    ...extra,
  }],
  activeViewId: 'v',
});

export const buildTool = (
  doc: Doc,
  config: DatabaseConfig = {},
  data: DatabaseData = tableData(),
  readOnly = false
): { tool: DatabaseTool; el: HTMLElement } => {
  const tool = new DatabaseTool({ data, config, api: doc.api, readOnly, block: { id: 'db', dispatchChange: vi.fn() } as never });
  const el = tool.render();

  document.body.appendChild(el);
  tool.rendered();

  return { tool, el };
};

/** The private commit path the table and the drawer share. */
export const commitCell = (tool: DatabaseTool, rowId: string, propertyId: string, value: PropertyValue): void => {
  (tool as unknown as { commitTableCell: (r: string, p: string, v: PropertyValue) => void }).commitTableCell(rowId, propertyId, value);
};
