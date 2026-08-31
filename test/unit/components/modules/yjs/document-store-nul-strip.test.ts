import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer, type YjsOutputBlockData } from '../../../../../src/components/modules/yjs/serializer';

const NUL = String.fromCharCode(0);

const createStore = (): DocumentStore => new DocumentStore(new YBlockSerializer());

/** True if a string carries a NUL. */
const hasNul = (value: unknown): boolean => typeof value === 'string' && value.includes(NUL);

/** Deep scan of a plain JSON value for a NUL in any key or string value. */
const anyNul = (value: unknown): boolean => {
  if (typeof value === 'string') {
    return value.includes(NUL);
  }

  if (Array.isArray(value)) {
    return value.some(anyNul);
  }

  if (value !== null && typeof value === 'object') {
    return Object.entries(value).some(([key, nested]) => key.includes(NUL) || anyNul(nested));
  }

  return false;
};

/**
 * Walk the RAW Y types instead of `toJSON()`: the JSON projection renames and
 * re-derives fields (`parentId` → `parent`), so a NUL written straight onto a
 * Y.Map can survive the scan that only looks at the projection.
 */
const rawNulHits = (value: unknown, path: string, hits: string[]): string[] => {
  if (typeof value === 'string') {
    if (value.includes(NUL)) {
      hits.push(`value ${path}`);
    }

    return hits;
  }

  if (value instanceof Y.Map) {
    value.forEach((nested, key) => {
      if (key.includes(NUL)) {
        hits.push(`key ${path}.${key}`);
      }
      rawNulHits(nested, `${path}.${key}`, hits);
    });

    return hits;
  }

  if (value instanceof Y.Array) {
    value.toArray().forEach((nested, index) => rawNulHits(nested, `${path}[${index}]`, hits));
  }

  return hits;
};

/** Every NUL anywhere in the doc's raw Y types, as readable paths. */
const scanRawDoc = (store: DocumentStore): string[] => {
  const hits: string[] = [];

  store.blocksMap.forEach((block, key) => {
    if (key.includes(NUL)) {
      hits.push(`key blocks.${key}`);
    }
    rawNulHits(block, `blocks.${key}`, hits);
  });
  rawNulHits(store.rootOrder, 'root', hits);

  return hits;
};

describe('NUL strip — serializer chokepoints', () => {
  const serializer = new YBlockSerializer();

  // Detached Y.Maps don't retain values until integrated into a doc, so
  // convert-then-read-back through an attached Y.Doc (matches serializer.test.ts).
  const roundTrip = (block: YjsOutputBlockData): YjsOutputBlockData => {
    const ydoc = new Y.Doc();
    const array = ydoc.getArray('t');

    array.push([serializer.outputDataToYBlock(block)]);

    return serializer.yBlockToOutputData(array.get(0) as Y.Map<unknown>);
  };

  it('strips NUL from a string data value (plainToYValue leaf)', () => {
    expect(roundTrip({ id: 'b1', type: 'paragraph', data: { text: `he${NUL}llo` } }).data.text).toBe('hello');
  });

  it('strips NUL from the block id and type fields', () => {
    const out = roundTrip({ id: `b${NUL}1`, type: `para${NUL}graph`, data: {} });

    expect(out.id).toBe('b1');
    expect(out.type).toBe('paragraph');
  });

  it('strips NUL from a nested map key (objectToYMap)', () => {
    const out = roundTrip({ id: 'b1', type: 'paragraph', data: { [`k${NUL}ey`]: 'v' } });

    expect(Object.keys(out.data)).toEqual(['key']);
  });

  it('strips NUL from grid cell string values (primitive-array leaf)', () => {
    const out = roundTrip({ id: 'b1', type: 'table', data: { content: [[`a${NUL}`, 'b'], ['c', 'd']] } });

    expect(anyNul(out.data)).toBe(false);
    expect(out.data.content).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('fast path: a clean primitive array is returned by reference (no copy)', () => {
    const clean = ['a', 'b'];

    expect(serializer.plainToYValue(clean)).toBe(clean);
  });
});

describe('NUL strip — DocumentStore chokepoints', () => {
  it('strips NUL from a block id at the map-key and order-array sites, not just toJSON', () => {
    const store = createStore();

    store.addBlock({ id: `a${NUL}1`, type: 'paragraph', data: { text: 'x' } });

    expect(Array.from(store.blocksMap.keys()).every((key) => !hasNul(key))).toBe(true);
    expect(store.rootOrder.toArray().every((id) => !hasNul(id))).toBe(true);
    expect(store.toJSON().map((block) => block.id)).toEqual(['a1']);
  });

  it('keeps a stripped child reachable — parentId, contentIds and root order agree', () => {
    const store = createStore();

    store.fromJSON([
      { id: `p${NUL}1`, type: 'paragraph', data: {}, content: ['c1'] },
      { id: 'c1', type: 'paragraph', data: {}, parent: `p${NUL}1` },
    ]);

    const json = store.toJSON();

    expect(anyNul(json)).toBe(false);
    expect(json.map((block) => block.id)).toEqual(['p1', 'c1']);
    expect(json.find((block) => block.id === 'c1')?.parent).toBe('p1');
  });

  it('strips NUL from the updateBlockData key param', () => {
    const store = createStore();

    store.addBlock({ id: 'a1', type: 'paragraph', data: { text: 'x' } });
    store.updateBlockData('a1', `ke${NUL}y`, 'v');

    const { data } = store.toJSON()[0];

    expect(Object.keys(data)).toContain('key');
    expect(anyNul(data)).toBe(false);
  });

  it('strips NUL from a nested key arriving via deep-merge onto an existing Y.Map', () => {
    const store = createStore();

    store.addBlock({ id: 'a1', type: 'paragraph', data: { meta: { a: 1 } } });
    store.updateBlockData('a1', 'meta', { a: 1, [`b${NUL}`]: 2 });

    expect(store.toJSON()[0].data).toEqual({ meta: { a: 1, b: 2 } });
    expect(anyNul(store.toJSON()[0].data)).toBe(false);
  });

  it('strips NUL from a grid cell value written via updateBlockData', () => {
    const store = createStore();

    store.addBlock({ id: 'a1', type: 'table', data: { content: [['a', 'b'], ['c', 'd']] } });
    store.updateBlockData('a1', 'content', [[`a${NUL}`, 'b'], ['c', 'd']]);

    expect(anyNul(store.toJSON()[0].data)).toBe(false);
  });

  it('strips NUL from the updateBlockTune tuneName and string tuneData', () => {
    const store = createStore();

    store.addBlock({ id: 'a1', type: 'paragraph', data: { text: 'x' } });
    store.updateBlockTune('a1', `tu${NUL}ne`, `val${NUL}ue`);

    const { tunes } = store.toJSON()[0];

    expect(tunes).toBeDefined();
    expect(anyNul(tunes)).toBe(false);
  });

  it('strips NUL from the parentId applyPlacement writes', () => {
    const store = createStore();

    store.addBlock({ id: 'child', type: 'paragraph', data: {} });
    store.applyPlacement('child', { parentId: `pa${NUL}rent`, afterId: null }, 'local');

    expect(scanRawDoc(store)).toEqual([]);
  });

  it('places the child under the parent whose id was stripped on the way in', () => {
    const store = createStore();

    // A host id carrying a NUL reaches the doc as its stripped form, so a
    // placement naming the raw id must resolve to the same block.
    store.fromJSON([{ id: `pa${NUL}rent`, type: 'paragraph', data: {} }]);
    store.addBlock({ id: 'child', type: 'paragraph', data: {} });
    store.applyPlacement('child', { parentId: `pa${NUL}rent`, afterId: null }, 'local');

    expect(scanRawDoc(store)).toEqual([]);
    expect(store.toJSON().find((block) => block.id === 'child')?.parent).toBe('parent');
  });

  it('refuses a placement whose parentId strips down to the block\'s own id', () => {
    const store = createStore();

    store.addBlock({ id: 'parent', type: 'paragraph', data: {} });
    store.applyPlacement('parent', { parentId: `pa${NUL}rent`, afterId: null }, 'local');

    expect(store.getBlockById('parent')?.get('parentId')).toBeUndefined();
  });

  it('a clean document round-trips byte-identical', () => {
    const store = createStore();
    const blocks = [{ id: 'a1', type: 'paragraph', data: { text: 'hello world' } }];

    store.fromJSON(blocks);

    expect(store.toJSON()).toEqual(blocks);
  });
});
