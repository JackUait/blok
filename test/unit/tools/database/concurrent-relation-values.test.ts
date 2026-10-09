import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DocumentStore } from '../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../src/components/modules/yjs/serializer';
import { ComputedProperties } from '../../../../src/tools/database/computed-properties';
import { readPropertyValue } from '../../../../src/tools/database/property-values';
import type { DatabaseRow, PropertyDefinition, PropertyValue, RelationValue } from '../../../../src/tools/database/types';

/**
 * Concurrent edits to relation values and to the formula, relation and
 * rollup settings. A relation value is a list of `{id}` objects under a
 * nanoid property id, so it merges by the identity rule, as person values do.
 */

const createStore = (): DocumentStore => new DocumentStore(new YBlockSerializer());

const pinClientId = (store: DocumentStore, clientId: number): void => {
  const doc = store.blocksMap.doc;

  if (doc === null) {
    throw new Error('DocumentStore has no Y.Doc');
  }

  doc.clientID = clientId;
};

const sync = (a: DocumentStore, b: DocumentStore): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

const dataOf = (store: DocumentStore, id: string): Record<string, unknown> =>
  (store.toJSON().find((block) => block.id === id)?.data ?? {});

const propertiesOf = (store: DocumentStore, id: string): Record<string, PropertyValue> =>
  (dataOf(store, id).properties ?? {}) as Record<string, PropertyValue>;

const ids = (value: PropertyValue | undefined): string[] =>
  (Array.isArray(value) ? (value as RelationValue[]).map((item) => item.id) : []).sort();

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'next', name: 'Next', type: 'relation', position: 'a1', relation: { targetDatabaseId: 'db', twoWay: true, syncedPropertyId: 'prev' } },
  { id: 'prev', name: 'Prev', type: 'relation', position: 'a2', relation: { targetDatabaseId: 'db', twoWay: true, syncedPropertyId: 'next' } },
];

const row = (id: string, title: string, properties: Record<string, PropertyValue> = {}): { id: string; type: string; parent: string; data: Record<string, unknown> } =>
  ({ id, type: 'database-row', parent: 'db', data: { position: id, title, properties: { title, ...properties } } });

describe('database relations — two peers', () => {
  let storeA: DocumentStore;
  let storeB: DocumentStore;

  const start = (blocks: Array<Record<string, unknown>>): void => {
    storeA.fromJSON([
      { id: 'db', type: 'database', data: { schema, views: [], activeViewId: '' }, content: blocks.map((b) => String(b.id)) },
      ...blocks,
    ] as never);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());
  };

  const write = (store: DocumentStore, id: string, properties: Record<string, PropertyValue>): void => {
    store.updateBlockData(id, 'properties', properties);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    storeA = createStore();
    storeB = createStore();
    pinClientId(storeA, 1);
    pinClientId(storeB, 2);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps both rows when two peers relate different rows at once', () => {
    start([row('a', 'Alpha', { next: [{ id: 'z' }] }), row('b', 'Bravo'), row('c', 'Charlie'), row('z', 'Zulu')]);

    write(storeA, 'a', { title: 'Alpha', next: [{ id: 'z' }, { id: 'b' }] });
    write(storeB, 'a', { title: 'Alpha', next: [{ id: 'z' }, { id: 'c' }] });
    sync(storeA, storeB);

    expect(ids(propertiesOf(storeA, 'a').next)).toEqual(['b', 'c', 'z']);
    expect(ids(propertiesOf(storeB, 'a').next)).toEqual(['b', 'c', 'z']);
  });

  /**
   * KNOWN LIMIT, pinned so a fix shows up here. The brief's rule says a list
   * that starts empty needs EAGER_ARRAY_KEYS, but a nanoid property id can
   * never be in that set. Two peers adding the FIRST related row at the same
   * instant each write a new list over the key; the later write wins.
   */
  it('last writer wins when two peers relate the first row of an empty list (known limit)', () => {
    start([row('a', 'Alpha'), row('b', 'Bravo'), row('c', 'Charlie')]);

    write(storeA, 'a', { title: 'Alpha', next: [{ id: 'b' }] });
    write(storeB, 'a', { title: 'Alpha', next: [{ id: 'c' }] });
    sync(storeA, storeB);

    expect(ids(propertiesOf(storeA, 'a').next)).toHaveLength(1);
    expect(propertiesOf(storeA, 'a').next).toEqual(propertiesOf(storeB, 'a').next);
  });

  it('a two-way edit racing a delete leaves no related row that does not exist', () => {
    start([row('a', 'Alpha', { next: [{ id: 'z' }] }), row('b', 'Bravo', { prev: [{ id: 'z' }] }), row('z', 'Zulu')]);

    // Peer A relates Alpha to Bravo: both sides, as one step.
    write(storeA, 'a', { title: 'Alpha', next: [{ id: 'z' }, { id: 'b' }] });
    write(storeA, 'b', { title: 'Bravo', prev: [{ id: 'z' }, { id: 'a' }] });
    // Peer B deletes Bravo at the same time.
    storeB.removeBlock('b');
    sync(storeA, storeB);

    const rows = (store: DocumentStore): DatabaseRow[] => store.toJSON()
      .filter((block) => block.type === 'database-row')
      .map((block) => ({ id: block.id, position: String((block.data as { position?: string }).position ?? ''), properties: propertiesOf(store, block.id) }));

    for (const store of [storeA, storeB]) {
      const computed = new ComputedProperties('db').apply(schema, rows(store), { databaseId: 'db', now: new Date(0) });
      const alpha = computed.find((r) => r.id === 'a');

      expect(computed.map((r) => r.id)).not.toContain('b');
      expect(alpha === undefined ? [] : ids(readPropertyValue(alpha, schema[1]))).toEqual(['z']);
    }
    expect(propertiesOf(storeA, 'a')).toEqual(propertiesOf(storeB, 'a'));
  });

  it('keeps a formula edit and a rename made at once on the same property', () => {
    const formula: PropertyDefinition = { id: 'fx', name: 'Double', type: 'formula', position: 'a3', formula: { expression: '1' } };

    storeA.fromJSON([{ id: 'db', type: 'database', data: { schema: [...schema, formula], views: [], activeViewId: '' } }] as never);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());

    storeA.updateBlockData('db', 'schema', [...schema, { ...formula, formula: { expression: '2' } }]);
    storeB.updateBlockData('db', 'schema', [...schema, { ...formula, name: 'Twice' }]);
    sync(storeA, storeB);

    const merged = (dataOf(storeA, 'db').schema as PropertyDefinition[]).find((p) => p.id === 'fx');

    expect(merged?.formula?.expression).toBe('2');
    expect(merged?.name).toBe('Twice');
    expect(dataOf(storeB, 'db').schema).toEqual(dataOf(storeA, 'db').schema);
  });

  it('keeps a relation limit and a two-way switch made at once', () => {
    const relation: PropertyDefinition = { id: 'rel', name: 'Rel', type: 'relation', position: 'a3', relation: { targetDatabaseId: 'other' } };

    storeA.fromJSON([{ id: 'db', type: 'database', data: { schema: [relation], views: [], activeViewId: '' } }] as never);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());

    storeA.updateBlockData('db', 'schema', [{ ...relation, relation: { targetDatabaseId: 'other', limit: 1 } }]);
    storeB.updateBlockData('db', 'schema', [{ ...relation, relation: { targetDatabaseId: 'other', twoWay: true, syncedPropertyId: 'back' } }]);
    sync(storeA, storeB);

    const merged = (dataOf(storeA, 'db').schema as PropertyDefinition[])[0];

    expect(merged.relation).toEqual({ targetDatabaseId: 'other', limit: 1, twoWay: true, syncedPropertyId: 'back' });
  });
});
