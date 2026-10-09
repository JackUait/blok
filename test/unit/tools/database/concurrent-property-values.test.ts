import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DocumentStore } from '../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../src/components/modules/yjs/serializer';
import type { FileValue, PersonValue, PropertyValue } from '../../../../src/tools/database/types';

/**
 * Concurrent edits to the Phase 2 property values and settings. Values live
 * in a row's `data.properties` under a nanoid property id, so no key-name
 * rule can name them; their merge comes from the identity rule (an array of
 * objects with unique ids is keyed by id) and from per-key map merging.
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

const propertiesOf = (store: DocumentStore): Record<string, PropertyValue> =>
  dataOf(store, 'row1').properties as Record<string, PropertyValue>;

const ids = (value: PropertyValue | undefined): string[] =>
  (Array.isArray(value) ? (value as Array<PersonValue | FileValue>).map((item) => item.id) : []).sort();

const file = (id: string): FileValue => ({ id, name: `${id}.pdf`, url: `https://cdn.example.com/${id}.pdf` });

/** The row tool saves the whole properties object; flushBlockDataWrites writes it as one key. */
const writeProperties = (store: DocumentStore, properties: Record<string, PropertyValue>): void => {
  store.updateBlockData('row1', 'properties', properties);
};

describe('database-row — two peers editing person and files values', () => {
  let storeA: DocumentStore;
  let storeB: DocumentStore;

  const start = (properties: Record<string, PropertyValue>): void => {
    storeA.fromJSON([{ id: 'row1', type: 'database-row', data: { position: 'a0', title: 'Row', properties: { title: 'Row', ...properties } } }]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());
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

  it('keeps both people when two peers add one to a list that already has someone', () => {
    start({ who: [{ id: 'u0' }] });

    writeProperties(storeA, { title: 'Row', who: [{ id: 'u0' }, { id: 'u1' }] });
    writeProperties(storeB, { title: 'Row', who: [{ id: 'u0' }, { id: 'u2' }] });
    sync(storeA, storeB);

    expect(ids(propertiesOf(storeA).who)).toEqual(['u0', 'u1', 'u2']);
    expect(ids(propertiesOf(storeB).who)).toEqual(['u0', 'u1', 'u2']);
  });

  it('keeps both files when two peers attach one to a list that already has a file', () => {
    start({ att: [file('f0')] });

    writeProperties(storeA, { title: 'Row', att: [file('f0'), file('f1')] });
    writeProperties(storeB, { title: 'Row', att: [file('f0'), file('f2')] });
    sync(storeA, storeB);

    expect(ids(propertiesOf(storeA).att)).toEqual(['f0', 'f1', 'f2']);
  });

  it('keeps a person one peer added while the other removed someone else', () => {
    start({ who: [{ id: 'u0' }, { id: 'u1' }] });

    writeProperties(storeA, { title: 'Row', who: [{ id: 'u0' }, { id: 'u1' }, { id: 'u2' }] });
    writeProperties(storeB, { title: 'Row', who: [{ id: 'u1' }] });
    sync(storeA, storeB);

    expect(ids(propertiesOf(storeA).who)).toEqual(['u1', 'u2']);
    expect(propertiesOf(storeB).who).toEqual(propertiesOf(storeA).who);
  });

  it('keeps a person value written while the other peer edits a different property of the row', () => {
    start({ who: [{ id: 'u0' }], st: 's1' });

    writeProperties(storeA, { title: 'Row', who: [{ id: 'u0' }, { id: 'u1' }], st: 's1' });
    writeProperties(storeB, { title: 'Row', who: [{ id: 'u0' }], st: 's2' });
    sync(storeA, storeB);

    expect(ids(propertiesOf(storeA).who)).toEqual(['u0', 'u1']);
    expect(propertiesOf(storeA).st).toBe('s2');
  });

  /**
   * KNOWN LIMIT, pinned so a fix shows up here. An empty list is a plain
   * leaf: the identity rule needs at least one element, and no key-name rule
   * can reach a nanoid property id (see EAGER_ARRAY_KEYS). Two peers adding
   * the FIRST person at the same instant each write a whole new list over
   * the key, and the later write wins. Every later add merges.
   */
  it('last writer wins when two peers add the first person to an empty list (known limit)', () => {
    start({});

    writeProperties(storeA, { title: 'Row', who: [{ id: 'u1' }] });
    writeProperties(storeB, { title: 'Row', who: [{ id: 'u2' }] });
    sync(storeA, storeB);

    expect(ids(propertiesOf(storeA).who)).toHaveLength(1);
    expect(propertiesOf(storeA).who).toEqual(propertiesOf(storeB).who);
  });

  /** KNOWN LIMIT: removing the last person turns the list back into a leaf, so a concurrent add is lost. */
  it('last writer wins when one peer clears the list while the other adds (known limit)', () => {
    start({ who: [{ id: 'u0' }] });

    writeProperties(storeA, { title: 'Row', who: [] });
    writeProperties(storeB, { title: 'Row', who: [{ id: 'u0' }, { id: 'u1' }] });
    sync(storeA, storeB);

    expect(propertiesOf(storeA).who).toEqual(propertiesOf(storeB).who);
  });

  it('keeps a stash one change kept while the other peer edits another cell', () => {
    storeA.fromJSON([{ id: 'row1', type: 'database-row', data: { position: 'a0', properties: { n: '007', x: 'a' } } }]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());

    storeA.updateBlockData('row1', 'properties', { n: 7, x: 'a' });
    storeA.updateBlockData('row1', 'convertedValues', { n: { type: 'text', value: '007' } });
    storeB.updateBlockData('row1', 'properties', { n: '007', x: 'b' });
    sync(storeA, storeB);

    expect(dataOf(storeA, 'row1').convertedValues).toEqual({ n: { type: 'text', value: '007' } });
    expect(propertiesOf(storeA).x).toBe('b');
    expect(propertiesOf(storeA).n).toBe(7);
  });
});

describe('database — two peers editing the new property settings', () => {
  let storeA: DocumentStore;
  let storeB: DocumentStore;

  beforeEach(() => {
    vi.clearAllMocks();
    storeA = createStore();
    storeB = createStore();
    pinClientId(storeA, 1);
    pinClientId(storeB, 2);
    storeA.fromJSON([{
      id: 'db1',
      type: 'database',
      data: {
        schema: [
          { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
          {
            id: 'p-st',
            name: 'Status',
            type: 'status',
            position: 'a1',
            config: { options: [{ id: 's1', label: 'Not started', position: 'a0', groupId: 'todo' }] },
            status: { groups: [{ id: 'todo', kind: 'todo', name: 'To-do', position: 'a0' }, { id: 'complete', kind: 'complete', name: 'Complete', position: 'a2' }] },
          },
          { id: 'p-n', name: 'Amount', type: 'number', position: 'a2', number: { format: 'number' } },
        ],
        views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
        activeViewId: 'v1',
      },
    }]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const schemaOf = (store: DocumentStore): Array<Record<string, unknown>> => dataOf(store, 'db1').schema as Array<Record<string, unknown>>;
  const prop = (store: DocumentStore, id: string): Record<string, unknown> => schemaOf(store).find((p) => p.id === id) ?? {};

  it('keeps a number format and a description two peers set on one property at once', () => {
    const schema = schemaOf(storeA);

    storeA.updateBlockData('db1', 'schema', schema.map((p) => (p.id === 'p-n' ? { ...p, number: { format: 'dollar' } } : p)));
    storeB.updateBlockData('db1', 'schema', schema.map((p) => (p.id === 'p-n' ? { ...p, description: 'Spend' } : p)));
    sync(storeA, storeB);

    expect(prop(storeA, 'p-n').number).toEqual({ format: 'dollar' });
    expect(prop(storeA, 'p-n').description).toBe('Spend');
  });

  it('keeps both status options when two peers add one to different groups', () => {
    const schema = schemaOf(storeA);
    const withOption = (option: Record<string, unknown>): Array<Record<string, unknown>> => schema.map((p) => {
      if (p.id !== 'p-st') return p;
      const config = p.config as { options: Array<Record<string, unknown>> };

      return { ...p, config: { options: [...config.options, option] } };
    });

    storeA.updateBlockData('db1', 'schema', withOption({ id: 's2', label: 'Doing', position: 'a1', groupId: 'todo' }));
    storeB.updateBlockData('db1', 'schema', withOption({ id: 's3', label: 'Shipped', position: 'a1', groupId: 'complete' }));
    sync(storeA, storeB);

    const options = (prop(storeA, 'p-st').config as { options: Array<{ id: string; groupId: string }> }).options;

    expect(options.map((o) => [o.id, o.groupId]).sort()).toEqual([['s1', 'todo'], ['s2', 'todo'], ['s3', 'complete']]);
  });

  it('keeps a group rename while the other peer moves an option to another group', () => {
    const schema = schemaOf(storeA);

    storeA.updateBlockData('db1', 'schema', schema.map((p) => {
      if (p.id !== 'p-st') return p;
      const status = p.status as { groups: Array<Record<string, unknown>> };

      return { ...p, status: { groups: status.groups.map((g) => (g.id === 'todo' ? { ...g, name: 'Backlog' } : g)) } };
    }));
    storeB.updateBlockData('db1', 'schema', schema.map((p) => {
      if (p.id !== 'p-st') return p;
      const config = p.config as { options: Array<Record<string, unknown>> };

      return { ...p, config: { options: config.options.map((o) => ({ ...o, groupId: 'complete' })) } };
    }));
    sync(storeA, storeB);

    const status = prop(storeA, 'p-st').status as { groups: Array<{ id: string; name: string }> };
    const options = (prop(storeA, 'p-st').config as { options: Array<{ groupId: string }> }).options;

    expect(status.groups.find((g) => g.id === 'todo')?.name).toBe('Backlog');
    expect(options[0].groupId).toBe('complete');
  });
});
