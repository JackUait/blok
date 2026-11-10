import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentStore } from '../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../src/components/modules/yjs/serializer';
import type { DatabaseData, PropertyDefinition } from '../../../../src/tools/database/types';
import type { DatabaseTool } from '../../../../src/tools/database';
import { buildTool, makeDoc, tableData } from './tier3-harness';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();
    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }
    destroy(): void {}
  },
}));

/** H50 under collaboration: two peers' deletes and restores must both survive a sync. */
const SCHEMA: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p0', name: 'Zero', type: 'text', position: 'a1' },
  { id: 'p1', name: 'One', type: 'text', position: 'a2' },
  { id: 'p2', name: 'Two', type: 'text', position: 'a3' },
];

const createStore = (clientId: number): DocumentStore => {
  const store = new DocumentStore(new YBlockSerializer());
  const doc = store.blocksMap.doc;

  if (doc === null) throw new Error('DocumentStore has no Y.Doc');
  doc.clientID = clientId;

  return store;
};

const sync = (a: DocumentStore, b: DocumentStore): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

const dataOf = (store: DocumentStore): DatabaseData =>
  (store.toJSON().find((block) => block.id === 'db')?.data ?? {}) as DatabaseData;

/** Core's sync writes each saved key with updateBlockData; equal keys are no-ops there. */
const persist = (tool: DatabaseTool, el: HTMLElement, store: DocumentStore): void => {
  for (const [key, value] of Object.entries(tool.save(el))) {
    store.updateBlockData('db', key, value);
  }
};

const deletedIds = (store: DocumentStore): string[] => {
  const deleted: unknown = dataOf(store).deletedProperties ?? {};

  return (Array.isArray(deleted) ? deleted.map((property: PropertyDefinition) => property.id) : Object.keys(deleted as Record<string, unknown>)).sort();
};

const schemaIds = (store: DocumentStore): string[] => dataOf(store).schema.map((property) => property.id).sort();

describe('deleted properties: two peers at once', () => {
  const tools: DatabaseTool[] = [];

  const peer = (data: DatabaseData): { tool: DatabaseTool; el: HTMLElement } => {
    const built = buildTool(makeDoc([]), {}, structuredClone(data));

    tools.push(built.tool);
    return built;
  };

  /**
   * Two stores holding one database that already has the slot, as one made
   * from the toolbox does. Without it, two first deletes at once can still
   * lose one (the same limit automations has).
   */
  const twoPeers = (): { storeA: DocumentStore; storeB: DocumentStore; a: ReturnType<typeof peer>; b: ReturnType<typeof peer> } => {
    const storeA = createStore(1);
    const storeB = createStore(2);

    storeA.fromJSON([{ id: 'db', type: 'database', data: { ...tableData(SCHEMA), deletedProperties: {} } }]);
    sync(storeA, storeB);
    const a = peer(dataOf(storeA));
    const b = peer(dataOf(storeB));

    persist(a.tool, a.el, storeA);
    persist(b.tool, b.el, storeB);
    sync(storeA, storeB);

    return { storeA, storeB, a, b };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    tools.forEach((tool) => tool.destroy());
    tools.length = 0;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('keeps both entries when two peers make the first deletes at once', () => {
    const { storeA, storeB, a, b } = twoPeers();

    a.tool.deleteProperty('p1');
    b.tool.deleteProperty('p2');
    persist(a.tool, a.el, storeA);
    persist(b.tool, b.el, storeB);
    sync(storeA, storeB);

    expect(deletedIds(storeA)).toEqual(['p1', 'p2']);
    expect(deletedIds(storeB)).toEqual(['p1', 'p2']);
    expect(schemaIds(storeA)).toEqual(['p0', 'title']);
  });

  it.each([[1, 2], [2, 1]])('an untouched save never clobbers a first delete on a database saved without the slot (clients %i/%i)', (idA, idB) => {
    const storeA = createStore(idA);
    const storeB = createStore(idB);

    storeA.fromJSON([{ id: 'db', type: 'database', data: tableData(SCHEMA) }]);
    sync(storeA, storeB);
    const a = peer(dataOf(storeA));
    const b = peer(dataOf(storeB));

    // A saves for an unrelated reason while B makes the first delete.
    a.tool.renameProperty('p0', 'Zero renamed');
    persist(a.tool, a.el, storeA);
    b.tool.deleteProperty('p2');
    persist(b.tool, b.el, storeB);
    sync(storeA, storeB);

    expect(deletedIds(storeA)).toEqual(['p2']);
    expect(deletedIds(storeB)).toEqual(['p2']);
  });

  it('a database made from the toolbox is born with an empty slot, so its peers\' first deletes merge', () => {
    const { tool, el } = peer({ initialView: 'table' } as unknown as DatabaseData);

    expect(tool.save(el).deletedProperties).toEqual({});
  });

  it('an untouched database saved without the slot saves without it', () => {
    const { tool, el } = peer(tableData(SCHEMA));

    expect(tool.save(el)).not.toHaveProperty('deletedProperties');
  });

  it('keeps a peer\'s delete when the other restores the last entry at once', () => {
    const { storeA, storeB, a } = twoPeers();

    a.tool.deleteProperty('p0');
    persist(a.tool, a.el, storeA);
    sync(storeA, storeB);
    const a2 = peer(dataOf(storeA));
    const b2 = peer(dataOf(storeB));

    a2.tool.restoreProperty('p0');
    b2.tool.deleteProperty('p2');
    persist(a2.tool, a2.el, storeA);
    persist(b2.tool, b2.el, storeB);
    sync(storeA, storeB);

    expect(deletedIds(storeA)).toEqual(['p2']);
    expect(deletedIds(storeB)).toEqual(['p2']);
    expect(schemaIds(storeA)).toEqual(['p0', 'p1', 'title']);
  });
});
