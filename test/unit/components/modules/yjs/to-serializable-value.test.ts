import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer, toSerializableValue } from '../../../../../src/components/modules/yjs/serializer';

const createStore = (): DocumentStore => new DocumentStore(new YBlockSerializer());

const dataOf = (store: DocumentStore, id: string): Record<string, unknown> =>
  store.toJSON().find((block) => block.id === id)?.data ?? {};

/** Birth: the whole block arrives through `fromJSON` → `blockDataToYMap`. */
const atBirth = (value: unknown): unknown => {
  const store = createStore();

  store.fromJSON([{ id: 'b', type: 'myTool', data: { v: value } }]);

  return dataOf(store, 'b').v;
};

/** Nested write: the value sits one level down inside a deep-merged object. */
const nestedWrite = (value: unknown): unknown => {
  const store = createStore();

  store.fromJSON([{ id: 'b', type: 'myTool', data: { n: { keep: 1 } } }]);
  store.updateBlockData('b', 'n', { inner: value });

  return (dataOf(store, 'b').n as Record<string, unknown>).inner;
};

/** Top-level write: `updateBlockData` replaces one whole data key. */
const topLevelWrite = (value: unknown): unknown => {
  const store = createStore();

  store.fromJSON([{ id: 'b', type: 'myTool', data: { v: 'placeholder' } }]);
  store.updateBlockData('b', 'v', value);

  return dataOf(store, 'b').v;
};

/**
 * A `toJSON` may hand back another value Yjs cannot carry. Substituting once
 * and returning let that result reach the `Object.entries` walk the
 * substitution exists to prevent, so the value was stored as an empty map on
 * the birth and nested-write paths — silent total loss where the pre-fix code
 * had at least thrown. The top-level write happened to survive only because
 * `updateBlockData` and `plainToYValue` each substituted once.
 */
describe('a toJSON that returns a value Yjs still cannot carry', () => {
  const mapMaker = (): unknown => ({ toJSON: () => new Map([['k', 'v']]) });
  const setMaker = (): unknown => ({ toJSON: () => new Set(['s']) });
  const dateMaker = (): unknown => ({ toJSON: () => new Date('2026-09-21T10:00:00.000Z') });

  it('keeps a Map handed back by toJSON on every write path', () => {
    expect(atBirth(mapMaker())).toEqual({ k: 'v' });
    expect(nestedWrite(mapMaker())).toEqual({ k: 'v' });
    expect(topLevelWrite(mapMaker())).toEqual({ k: 'v' });
  });

  it('keeps a Set handed back by toJSON on every write path', () => {
    expect(atBirth(setMaker())).toEqual(['s']);
    expect(nestedWrite(setMaker())).toEqual(['s']);
    expect(topLevelWrite(setMaker())).toEqual(['s']);
  });

  it('keeps a Date handed back by toJSON on every write path', () => {
    expect(atBirth(dateMaker())).toBe('2026-09-21T10:00:00.000Z');
    expect(nestedWrite(dateMaker())).toBe('2026-09-21T10:00:00.000Z');
    expect(topLevelWrite(dateMaker())).toBe('2026-09-21T10:00:00.000Z');
  });

  it('keeps a value reached through a chain of toJSON hand-offs', () => {
    const inner = { toJSON: (): unknown => new Set(['deep']) };

    expect(atBirth({ toJSON: () => inner })).toEqual(['deep']);
  });
});

/**
 * Re-entering on the `toJSON` result must terminate. A cycle has no JSON form
 * at all — `JSON.stringify` throws on one too — so the write is refused
 * loudly rather than spun on or silently emptied.
 */
describe('a toJSON chain that never ends', () => {
  it('refuses a toJSON that returns its own receiver instead of spinning', () => {
    const selfish: { toJSON: () => unknown } = { toJSON: () => selfish };

    expect(() => toSerializableValue(selfish)).toThrow(TypeError);
  });

  it('refuses two objects whose toJSONs return each other', () => {
    const first: { toJSON: () => unknown } = { toJSON: () => second };
    const second: { toJSON: () => unknown } = { toJSON: () => first };

    expect(() => toSerializableValue(first)).toThrow(TypeError);
  });

  it('refuses an endless chain of freshly built toJSON objects', () => {
    const endless = (): unknown => ({ toJSON: () => endless() });

    expect(() => toSerializableValue(endless())).toThrow(TypeError);
  });

  it('refuses the write rather than storing an empty map for it', () => {
    const selfish: { toJSON: () => unknown } = { toJSON: () => selfish };
    const store = createStore();

    expect(() => store.fromJSON([{ id: 'b', type: 'myTool', data: { v: selfish } }])).toThrow(TypeError);
  });
});

/**
 * Block data is JSON by contract and binary has no JSON form, so both shapes
 * below are what the host's own `JSON.stringify` of the saved data produces.
 * Pinned because the docstring used to claim lib0 encoded binary natively,
 * which it never got the chance to do — `plainToYValue`'s object branch takes
 * a typed array first.
 */
describe('binary in block data', () => {
  it('stores a typed array the way JSON.stringify renders it', () => {
    const stored = atBirth(new Uint8Array([1, 2, 3]));

    expect(stored).toEqual(JSON.parse(JSON.stringify(new Uint8Array([1, 2, 3]))));
    expect(stored).toEqual({ 0: 1, 1: 2, 2: 3 });
  });

  it('stores a raw ArrayBuffer the way JSON.stringify renders it', () => {
    expect(atBirth(new ArrayBuffer(8))).toEqual({});
  });
});

/**
 * A `toJSON` returning a plain object keeps per-field merging: the result is
 * an ordinary object, so `objectToYMap` gives it a per-field Y.Map and two
 * peers editing different fields both land. Only a `toJSON` returning a
 * PRIMITIVE makes the key a whole-value leaf.
 */
describe('merge granularity under toJSON', () => {
  class Money {
    public constructor(public cents: number, public currency: string) {}

    public toJSON(): Record<string, unknown> {
      return { cents: this.cents, currency: this.currency };
    }
  }

  it('merges two peers editing different fields of a toJSON object', () => {
    const a = createStore();
    const b = createStore();

    a.fromJSON([{ id: 'p', type: 'price', data: { money: new Money(5, 'usd') } }]);
    b.applyRemoteUpdate(a.encodeStateAsUpdate());

    a.updateBlockData('p', 'money', new Money(9, 'usd'));
    b.updateBlockData('p', 'money', new Money(5, 'eur'));

    const forB = a.encodeStateAsUpdate(b.getStateVector());
    const forA = b.encodeStateAsUpdate(a.getStateVector());

    b.applyRemoteUpdate(forB);
    a.applyRemoteUpdate(forA);

    expect(dataOf(a, 'p').money).toEqual({ cents: 9, currency: 'eur' });
    expect(dataOf(b, 'p').money).toEqual({ cents: 9, currency: 'eur' });
  });

  it('gives a toJSON object a per-field Y.Map rather than a leaf', () => {
    const store = createStore();

    store.fromJSON([{ id: 'p', type: 'price', data: { money: new Money(5, 'usd') } }]);

    expect((store.getBlockById('p')?.get('data') as Y.Map<unknown>).get('money')).toBeInstanceOf(Y.Map);
  });
});

/** The RegExp stand-in is the literal text, delimiters and flags included. */
describe('a RegExp in block data', () => {
  it('stores the full literal, not the bare source', () => {
    expect(atBirth(/ab+c/gi)).toBe('/ab+c/gi');
  });
});
