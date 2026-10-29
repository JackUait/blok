import { vi } from 'vitest';
import type { API, BlockAPI, BlockOrigin } from '../../../../types';
import type { DatabaseConfig, DatabaseData, DatabaseRowData, PropertyValue } from '../../../../src/tools/database/types';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';

/** A block that keeps its data, so a write shows up on the next read. */
export interface FakeBlock {
  block: BlockAPI;
  data: Record<string, unknown>;
  name: string;
  parentId: string | null;
}

export interface Doc {
  api: API;
  blocks: Map<string, FakeBlock>;
  order: string[];
  transact: ReturnType<typeof vi.fn>;
  deleted: string[];
  /** The tools built for database blocks, by block id. */
  tools: Map<string, DatabaseTool>;
  row: (id: string) => DatabaseRowData;
  childrenOf: (id: string) => string[];
}

let minted = 0;

const makeBlock = (doc: () => Doc, id: string, name: string, parentId: string | null, data: Record<string, unknown>): FakeBlock => {
  const entry: FakeBlock = { data: structuredClone(data), name, parentId, block: undefined as unknown as BlockAPI };

  entry.block = {
    id,
    name,
    get parentId() {
      return entry.parentId;
    },
    holder: document.createElement('div'),
    get preservedData() {
      return entry.data;
    },
    call: vi.fn((method: string, param: unknown) => {
      const tool = doc().tools.get(id);

      if (tool !== undefined) {
        const fn = (tool as unknown as Record<string, unknown>)[method];

        return typeof fn === 'function' ? (fn as (p: unknown) => unknown).call(tool, param) : undefined;
      }
      const row = entry.data as unknown as DatabaseRowData;

      if (method === 'readData') (param as { receive: (d: DatabaseRowData) => void }).receive(row);
      if (method === 'updateProperties') entry.data = { ...entry.data, properties: { ...row.properties, ...(param as Record<string, PropertyValue>) } };
      if (method === 'updateTitle') {
        const { title, titlePropertyId } = param as { title: string; titlePropertyId: string };

        entry.data = { ...entry.data, title, properties: { ...row.properties, [titlePropertyId]: title } };
      }
      if (method === 'updatePosition') entry.data = { ...entry.data, position: param };
      if (method === 'updateRepeat') {
        const { repeat } = param as { repeat: unknown };

        entry.data = { ...entry.data, repeat: repeat ?? undefined };
      }
      if (method === 'updateReminders') {
        const changes = param as Record<string, unknown>;
        const next = Object.fromEntries(Object.entries({ ...row.reminders, ...changes }).filter(([, reminder]) => reminder !== null));

        entry.data = { ...entry.data, reminders: Object.keys(next).length > 0 ? next : undefined };
      }
      if (method === 'updateReaction') {
        const rowTool = new DatabaseRowTool({ data: row, config: {}, api: {} as API, readOnly: false, block: { id } as BlockAPI });

        rowTool.updateReaction(param as { userId: string; emoji: string; at: number | null });
        entry.data = { ...rowTool.save(document.createElement('div')) };
      }
      if (method === 'setRowData') entry.data = { ...entry.data, ...(param as Record<string, unknown>) };

      return undefined;
    }),
    dispatchChange: vi.fn(),
  } as unknown as BlockAPI;

  return entry;
};

/**
 * A small document: database blocks, row blocks and body blocks, with the
 * `api.blocks` calls the database tool makes.
 */
export const makeDoc = (seed: Array<{ id: string; name: string; parentId: string | null; data: Record<string, unknown> }>): Doc => {
  const blocks = new Map<string, FakeBlock>();
  const order: string[] = [];
  const deleted: string[] = [];
  const listeners = new Map<string, Array<(data?: unknown) => void>>();
  const transact = vi.fn((fn: () => void) => fn());
  const tools = new Map<string, DatabaseTool>();
  const self = (): Doc => doc;
  const live = (id: string): FakeBlock | undefined => (deleted.includes(id) ? undefined : blocks.get(id));
  const add = (id: string, name: string, parentId: string | null, data: Record<string, unknown>): FakeBlock => {
    const entry = makeBlock(self, id, name, parentId, data);

    blocks.set(id, entry);
    order.push(id);

    return entry;
  };

  seed.forEach((b) => add(b.id, b.name, b.parentId, b.data));

  const api = {
    styles: { block: 'blok-block' },
    i18n: { t: (key: string, vars?: Record<string, unknown>) => (vars === undefined ? key : `${key} ${JSON.stringify(vars)}`) },
    events: {
      on: vi.fn((name: string, cb: (data?: unknown) => void) => listeners.set(name, [...(listeners.get(name) ?? []), cb])),
      off: vi.fn(),
      emit: vi.fn((name: string, data?: unknown) => (listeners.get(name) ?? []).forEach((cb) => cb(data))),
    },
    blocks: {
      getChildren: vi.fn((parentId: string) => order
        .map((id) => live(id))
        .filter((b): b is FakeBlock => b !== undefined && b.parentId === parentId)
        .map((b) => b.block)),
      getBlocksCount: vi.fn(() => order.length),
      getBlockByIndex: vi.fn((index: number) => live(order[index] ?? '')?.block),
      getBlockIndex: vi.fn((id: string) => (live(id) === undefined ? undefined : order.indexOf(id))),
      delete: vi.fn((index: number) => {
        const id = order[index];

        deleted.push(id);
        // A deleted parent takes its children with it, as the block tree does.
        const drop = (parent: string): void => order
          .filter((child) => blocks.get(child)?.parentId === parent && !deleted.includes(child))
          .forEach((child) => {
            deleted.push(child);
            drop(child);
          });

        drop(id);
      }),
      getById: vi.fn((id: string) => live(id)?.block ?? null),
      insertAt: vi.fn((name: string, data: Record<string, unknown>, options: { parentId?: string; id?: string } = {}) => {
        minted += 1;

        return add(options.id ?? `minted-${minted}`, name, options.parentId ?? null, data ?? {}).block;
      }),
      transact,
    },
    notifier: { show: vi.fn() },
    history: { latestStep: vi.fn(() => undefined), undoStep: vi.fn(() => false) },
    viewState: { get: vi.fn(), set: vi.fn() },
    tools: { getBlockTools: vi.fn(() => []), getToolsConfig: vi.fn(() => ({ tools: undefined })) },
  } as unknown as API;

  const doc: Doc = {
    api,
    blocks,
    order,
    transact,
    deleted,
    tools,
    row: (id) => (blocks.get(id)?.data ?? {}) as unknown as DatabaseRowData,
    childrenOf: (id) => order.filter((child) => blocks.get(child)?.parentId === id && !deleted.includes(child)),
  };

  return doc;
};

export const rowSeed = (id: string, parentId: string, data: Partial<DatabaseRowData> & { properties: Record<string, PropertyValue> }): { id: string; name: string; parentId: string; data: Record<string, unknown> } =>
  ({ id, name: 'database-row', parentId, data: { position: 'a0', ...data } });

/** Builds and mounts a database tool for `blockId`. */
export const buildDatabase = (doc: Doc, blockId: string, data: DatabaseData, config: DatabaseConfig = {}, origin?: BlockOrigin): { tool: DatabaseTool; el: HTMLElement } => {
  const entry = doc.blocks.get(blockId);
  const tool = new DatabaseTool({
    data,
    config,
    api: doc.api,
    readOnly: false,
    ...(origin !== undefined ? { origin } : {}),
    block: (entry?.block ?? { id: blockId, name: 'database', dispatchChange: vi.fn() }) as never,
  });

  doc.tools.set(blockId, tool);
  const el = tool.render();

  document.body.appendChild(el);
  tool.rendered();

  return { tool, el };
};
