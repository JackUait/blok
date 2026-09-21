import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';

const createStore = (): DocumentStore => new DocumentStore(new YBlockSerializer());

/** Exchange diffs against each peer's pre-exchange state vector, as the provider does. */
const sync = (a: DocumentStore, b: DocumentStore): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const dataOf = (store: DocumentStore, id: string): Record<string, unknown> =>
  store.toJSON().find((block) => block.id === id)?.data ?? {};

/** The live CRDT container under one top-level data key — the representation, not the read-back. */
const yValueOf = (store: DocumentStore, id: string, key: string): unknown =>
  (store.getBlockById(id)?.get('data') as Y.Map<unknown>).get(key);

type Cell = { text: string };

/**
 * `pairGridRows` has two callers with opposite needs. `deepAssignYArray` falls
 * back to a splice the moment the pairing is not monotonic, so a crossing pair
 * must be refused there. `deepAssignYGrid` records a move in the `__rowKeys`
 * order array instead — a crossing pair is exactly what the keyed wrapper
 * exists to express — and refusing one mints a fresh key and `rows.delete`s
 * the old container, which is the delete+insert the wrapper was built to
 * avoid.
 */
describe('a grid save that reorders rows and edits one', () => {
  const rowCount = 4;

  const base = (): Cell[][] =>
    Array.from({ length: rowCount }, (_, row) => [{ text: `a${row}` }, { text: `b${row}` }]);

  /** `base`, with the row at `from` moved to `to` and its FIRST cell edited. */
  const localSave = (from: number, to: number, edited: number): Cell[][] => {
    const rows = clone(base());
    const moved = rows.splice(from, 1)[0];

    rows.splice(to, 0, moved);
    (rows.find((row) => row[0].text === `a${edited}`) as Cell[])[0].text = 'LOCAL';

    return rows;
  };

  /** `base`, with the SECOND cell of row `edited` typed into by the peer. */
  const peerSave = (edited: number): Cell[][] => {
    const rows = clone(base());

    rows[edited][1].text = 'PEER';

    return rows;
  };

  const run = (from: number, to: number, edited: number): string[] => {
    const a = createStore();
    const b = createStore();

    a.fromJSON([{ id: 't', type: 'table', data: { rows: base() } }]);
    b.applyRemoteUpdate(a.encodeStateAsUpdate());

    a.updateBlockData('t', 'rows', localSave(from, to, edited));
    b.updateBlockData('t', 'rows', peerSave(edited));
    sync(a, b);

    const rows = dataOf(a, 't').rows as Cell[][];

    return rows.flat().map((cell) => cell.text);
  };

  it('keeps the cell a peer typed into while the row moved to the front', () => {
    expect(run(3, 0, 1)).toContain('PEER');
  });

  it('keeps the cell a peer typed into while THAT row itself moved', () => {
    expect(run(1, 3, 1)).toContain('PEER');
  });

  it('keeps the peer cell across every single-row move and every edited row', () => {
    const index = (length: number): number[] => Array.from({ length }, (_, value) => value);
    const cases = index(rowCount).flatMap((from) =>
      index(rowCount)
        .filter((to) => to !== from)
        .flatMap((to) => index(rowCount).map((edited) => ({ from, to, edited }))));
    const lost = cases
      .filter(({ from, to, edited }) => !run(from, to, edited).includes('PEER'))
      .map(({ from, to, edited }) => `${from}->${to} edit ${edited}`);

    expect(lost).toEqual([]);
    expect(cases.length).toBe(48);
  });
});

/**
 * A legacy document stores an array of objects as a plain `Y.Array` — the
 * keyed wrapper is a BIRTH shape and those elements had no ids when the doc
 * was written. Promoting it to the wrapper on the first id-bearing write is
 * `set(key, …)`, last-writer-wins on the WHOLE array, and it fires on every
 * peer from an ordinary save. The plain array must stay plain and diff
 * element-wise.
 */
describe('a legacy plain array that gains ids', () => {
  const legacy = (): DocumentStore[] => {
    const a = createStore();
    const b = createStore();

    a.fromJSON([{ id: 'db', type: 'database', data: { schema: [{ name: 'Name' }, { name: 'Status' }] } }]);
    b.applyRemoteUpdate(a.encodeStateAsUpdate());

    return [a, b];
  };

  it('keeps both columns when two peers each append one', () => {
    const [a, b] = legacy();

    a.updateBlockData('db', 'schema', [
      { id: 'p1', name: 'Name' }, { id: 'p2', name: 'Status' }, { id: 'p9', name: 'Owner' },
    ]);
    b.updateBlockData('db', 'schema', [
      { id: 'p1', name: 'Name' }, { id: 'p2', name: 'Status' }, { id: 'p8', name: 'Due' },
    ]);
    sync(a, b);

    const names = (dataOf(a, 'db').schema as { name: string }[]).map((column) => column.name);

    expect(names).toEqual(expect.arrayContaining(['Name', 'Status', 'Due', 'Owner']));
    expect(names).toEqual((dataOf(b, 'db').schema as { name: string }[]).map((column) => column.name));
  });

  it('stays a plain Y.Array — no write promotes it to the wrapper', () => {
    const [a] = legacy();

    a.updateBlockData('db', 'schema', [{ id: 'p1', name: 'Name' }, { id: 'p2', name: 'Status' }]);

    expect(yValueOf(a, 'db', 'schema')).toBeInstanceOf(Y.Array);
  });
});

/**
 * `toSerializableValue` must run at every write chokepoint. An array ELEMENT
 * reaches `deepAssignYMap`, whose `Object.entries` walk is empty for a
 * `Date`/`Map`/`Set` — so it deleted every key of the live element `Y.Map`
 * and stored nothing in their place.
 */
describe('an exotic value written into an existing array element', () => {
  it('keeps a Date', () => {
    const store = createStore();

    store.fromJSON([{ id: 'c', type: 'myCard', data: { list: [{ v: 1 }, { v: 2 }] } }]);
    store.updateBlockData('c', 'list', [new Date('2026-09-21T10:00:00.000Z'), { v: 2 }]);

    expect((dataOf(store, 'c').list as unknown[])[0]).not.toEqual({});
  });

  it('keeps a Map', () => {
    const store = createStore();

    store.fromJSON([{ id: 'c', type: 'myCard', data: { list: [{ v: 1 }, { v: 2 }] } }]);
    store.updateBlockData('c', 'list', [new Map([['k', 'v']]), { v: 2 }]);

    expect((dataOf(store, 'c').list as unknown[])[0]).toEqual({ k: 'v' });
  });

  it('keeps every entry of a Map whose keys all stringify alike', () => {
    const store = createStore();
    const byObject = new Map<Record<string, number>, string>([[{ k: 1 }, 'first'], [{ k: 2 }, 'second']]);

    store.fromJSON([{ id: 'c', type: 'myCard', data: { byObject } }]);

    expect((dataOf(store, 'c').byObject as unknown[]).length).toBe(2);
  });
});

/**
 * `filters` and `sorts` are in the eager-array set so a list born EMPTY is a
 * `Y.Array` rather than a leaf. They are generic key names, and forcing a
 * plain positionally-diffed array on an ID-BEARING value under one of them
 * would reintroduce "a reorder racing a field edit lands on whichever element
 * took the index, and both peers converge on the same wrong value".
 */
describe('an id-bearing list under a key the eager-array rule claims', () => {
  const view = (): { a: DocumentStore; b: DocumentStore } => {
    const a = createStore();
    const b = createStore();

    a.fromJSON([{
      id: 'db',
      type: 'database',
      data: { view: { filters: [{ id: 'f1', on: 'Name' }, { id: 'f2', on: 'Status' }] } },
    }]);
    b.applyRemoteUpdate(a.encodeStateAsUpdate());

    return { a, b };
  };

  const filtersOf = (store: DocumentStore): { id: string; on: string }[] =>
    (dataOf(store, 'db').view as { filters: { id: string; on: string }[] }).filters;

  it('takes the identity wrapper at birth, not a plain Y.Array', () => {
    const { a } = view();
    const nested = (yValueOf(a, 'db', 'view') as Y.Map<unknown>).get('filters');

    expect(nested).toBeInstanceOf(Y.Map);
  });

  it('applies a peer edit to the filter it was made on while the local save reorders', () => {
    const { a, b } = view();

    a.updateBlockData('db', 'view', {
      filters: [{ id: 'f2', on: 'Status' }, { id: 'f1', on: 'Name' }],
    });
    b.updateBlockData('db', 'view', {
      filters: [{ id: 'f1', on: 'RENAMED' }, { id: 'f2', on: 'Status' }],
    });
    sync(a, b);

    expect(filtersOf(a).find((filter) => filter.id === 'f1')?.on).toBe('RENAMED');
    expect(filtersOf(a).find((filter) => filter.id === 'f2')?.on).toBe('Status');
  });

  it('still stores an empty list as a Y.Array so two first inserts both survive', () => {
    const { a, b } = view();

    a.fromJSON([{ id: 'db2', type: 'database', data: { view: { filters: [] } } }]);
    b.applyRemoteUpdate(a.encodeStateAsUpdate());

    expect((yValueOf(a, 'db2', 'view') as Y.Map<unknown>).get('filters')).toBeInstanceOf(Y.Array);
  });
});
