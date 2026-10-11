import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import type { API, OutputBlockData, OutputData } from '../../../../types';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { Paragraph } from '../../../../src/tools/paragraph';
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
  let holder: HTMLElement | undefined;
  let editor: { isReady: Promise<unknown>; blocks: API['blocks']; save: () => Promise<OutputData>; destroy: () => void } | undefined;

  const makeEditor = async (blocks: OutputBlockData[]): Promise<NonNullable<typeof editor>> => {
    holder = document.createElement('div');
    document.body.appendChild(holder);
    editor = new Blok({
      holder,
      dataModel: 'hierarchical',
      tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
      data: { blocks },
    } as never) as unknown as NonNullable<typeof editor>;
    await editor.isReady;

    return editor;
  };

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
    editor?.destroy();
    editor = undefined;
    holder?.remove();
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

  it('keeps both rows when two peers relate the first row of a list born empty', () => {
    start([row('a', 'Alpha', { next: [] }), row('b', 'Bravo'), row('c', 'Charlie')]);

    write(storeA, 'a', { title: 'Alpha', next: [{ id: 'b' }] });
    write(storeB, 'a', { title: 'Alpha', next: [{ id: 'c' }] });
    sync(storeA, storeB);

    expect(ids(propertiesOf(storeA, 'a').next)).toEqual(['b', 'c']);
    expect(propertiesOf(storeB, 'a').next).toEqual(propertiesOf(storeA, 'a').next);
  });

  /** A legacy row with no key for the list: creating the key stays last-writer-wins. */
  it('last writer wins when two peers relate the first row of a legacy row with no key', () => {
    start([row('a', 'Alpha'), row('b', 'Bravo'), row('c', 'Charlie')]);

    write(storeA, 'a', { title: 'Alpha', next: [{ id: 'b' }] });
    write(storeB, 'a', { title: 'Alpha', next: [{ id: 'c' }] });
    sync(storeA, storeB);

    expect(ids(propertiesOf(storeA, 'a').next)).toHaveLength(1);
    expect(propertiesOf(storeA, 'a').next).toEqual(propertiesOf(storeB, 'a').next);
  });

  it('keeps both first relation additions to a row created by Merge with CSV', async () => {
    const blok = await makeEditor([
      { id: 'db', type: 'database', data: { schema, views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }], activeViewId: 'v' }, content: ['b', 'c'] },
      row('b', 'Bravo'),
      row('c', 'Charlie'),
    ]);

    blok.blocks.getById('db')?.call('mergeCsv', 'Name\nAlpha\n' as never);
    storeA.fromJSON((await blok.save()).blocks);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());

    const imported = storeA.toJSON().find((block) => block.type === 'database-row' && propertiesOf(storeA, block.id ?? '').title === 'Alpha');

    if (imported?.id === undefined) throw new Error('CSV row was not created');
    const properties = propertiesOf(storeA, imported.id);

    write(storeA, imported.id, { ...properties, next: [{ id: 'b' }] });
    write(storeB, imported.id, { ...properties, next: [{ id: 'c' }] });
    sync(storeA, storeB);

    expect(ids(propertiesOf(storeA, imported.id).next)).toEqual(['b', 'c']);
    expect(propertiesOf(storeB, imported.id).next).toEqual(propertiesOf(storeA, imported.id).next);
  });

  it.each([
    ['setDependenciesEnabled', 'blockedBy'],
    ['setSubItemsEnabled', 'subItems'],
  ])('keeps both first relation additions after %s creates the pair on existing rows', async (method, role) => {
    const blok = await makeEditor([
      { id: 'db', type: 'database', data: { schema: [schema[0]], views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }], activeViewId: 'v' }, content: ['a', 'b', 'c'] },
      row('a', 'Alpha'),
      row('b', 'Bravo'),
      row('c', 'Charlie'),
    ]);

    blok.blocks.getById('db')?.call(method, true as never);
    const output = await blok.save();
    const definition = output.blocks.find((block) => block.id === 'db')?.data.schema as PropertyDefinition[] | undefined;
    const property = definition?.find((candidate) => candidate.relation?.role === role);

    if (property === undefined) throw new Error('relation pair was not created');
    storeA.fromJSON(output.blocks);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());
    const properties = propertiesOf(storeA, 'a');

    write(storeA, 'a', { ...properties, [property.id]: [{ id: 'b' }] });
    write(storeB, 'a', { ...properties, [property.id]: [{ id: 'c' }] });
    sync(storeA, storeB);

    expect(ids(propertiesOf(storeA, 'a')[property.id])).toEqual(['b', 'c']);
    expect(propertiesOf(storeB, 'a')[property.id]).toEqual(propertiesOf(storeA, 'a')[property.id]);
  });

  it('keeps the related row one peer added while the other unrelated the last one', () => {
    start([row('a', 'Alpha', { next: [{ id: 'z' }] }), row('b', 'Bravo'), row('z', 'Zulu')]);

    write(storeA, 'a', { title: 'Alpha', next: [] });
    write(storeB, 'a', { title: 'Alpha', next: [{ id: 'z' }, { id: 'b' }] });
    sync(storeA, storeB);

    expect(ids(propertiesOf(storeA, 'a').next)).toEqual(['b']);
    expect(propertiesOf(storeB, 'a').next).toEqual(propertiesOf(storeA, 'a').next);
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
      .map((block) => {
        const id = String(block.id);

        return { id, position: String((block.data as { position?: string }).position ?? ''), properties: propertiesOf(store, id) };
      });

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
