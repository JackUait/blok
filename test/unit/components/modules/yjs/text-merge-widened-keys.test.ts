import { describe, it, expect } from 'vitest';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';

const createStore = (): DocumentStore => new DocumentStore(new YBlockSerializer());

const sync = (a: DocumentStore, b: DocumentStore): void => {
  const forB = a.encodeStateAsUpdate(b.getStateVector());
  const forA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(forB);
  a.applyRemoteUpdate(forA);
};

const fieldOf = (store: DocumentStore, id: string, key: string): unknown =>
  (store.toJSON().find((c) => c.id === id)?.data)?.[key];

describe('widening: top-level user-typed strings merge per character', () => {
  let a: DocumentStore;
  let b: DocumentStore;

  const seed = (block: { id: string; type: string; data: Record<string, unknown> }): void => {
    a = createStore();
    b = createStore();
    a.fromJSON([block]);
    b.applyRemoteUpdate(a.encodeStateAsUpdate());
  };

  it('code block: two peers editing different lines keep both', () => {
    seed({ id: 'c1', type: 'code', data: { code: 'const a = 1;\nconst b = 2;', language: 'js' } });

    a.updateBlockData('c1', 'code', 'const a = 111;\nconst b = 2;');
    b.updateBlockData('c1', 'code', 'const a = 1;\nconst b = 222;');

    sync(a, b);

    expect(fieldOf(a, 'c1', 'code')).toBe('const a = 111;\nconst b = 222;');
    expect(fieldOf(b, 'c1', 'code')).toBe('const a = 111;\nconst b = 222;');
  });

  it('image caption: two peers typing at either end keep both', () => {
    seed({ id: 'i1', type: 'image', data: { url: 'https://x/y.png', caption: 'Hello world' } });

    a.updateBlockData('i1', 'caption', 'Hello world AAA');
    b.updateBlockData('i1', 'caption', 'BBB Hello world');

    sync(a, b);

    expect(fieldOf(a, 'i1', 'caption')).toBe('BBB Hello world AAA');
    expect(fieldOf(b, 'i1', 'caption')).toBe('BBB Hello world AAA');
  });

  it('non-string value under a widened key does not corrupt the block', () => {
    seed({ id: 'x1', type: 'image', data: { url: 'u', caption: 'abc' } });

    a.updateBlockData('x1', 'caption', null);
    sync(a, b);

    expect(fieldOf(a, 'x1', 'caption')).toBe(null);
    expect(fieldOf(b, 'x1', 'caption')).toBe(null);
    expect(fieldOf(b, 'x1', 'url')).toBe('u');
  });
});

describe('widening: a table cell\'s block-id list', () => {
  // `blocks` used to be a primitive array, so it was an atomic leaf and one
  // peer's inserted id was orphaned. The ordered-id-array rule mints it as a
  // Y.Array at birth on both the client and the C# seed side.
  it('keeps both peers\' inserted block when each adds one to the same cell', () => {
    const a = createStore();
    const b = createStore();

    a.fromJSON([{
      id: 't1',
      type: 'table',
      data: { content: [[{ blocks: ['x'] }, { blocks: [] }]] },
    }]);
    b.applyRemoteUpdate(a.encodeStateAsUpdate());

    a.updateBlockData('t1', 'content', [[{ blocks: ['x', 'aaa'] }, { blocks: [] }]]);
    b.updateBlockData('t1', 'content', [[{ blocks: ['x', 'bbb'] }, { blocks: [] }]]);

    sync(a, b);

    const cell = (store: DocumentStore): string[] =>
      ((fieldOf(store, 't1', 'content') as Array<Array<{ blocks: string[] }>>)[0][0]).blocks;

    // Neither id is orphaned, and both peers agree on the order the CRDT picked.
    expect([...cell(a)].sort()).toEqual(['aaa', 'bbb', 'x']);
    expect(cell(b)).toEqual(cell(a));
  });
});

describe('widening: a key created AFTER the block', () => {
  it('merges a caption that did not exist when the image was inserted', () => {
    const a = createStore();
    const b = createStore();

    // save() omits an undefined caption, so the key is absent at creation.
    a.fromJSON([{ id: 'i2', type: 'image', data: { url: 'u' } }]);
    b.applyRemoteUpdate(a.encodeStateAsUpdate());

    a.updateBlockData('i2', 'caption', 'Hello world');
    sync(a, b);

    a.updateBlockData('i2', 'caption', 'Hello world AAA');
    b.updateBlockData('i2', 'caption', 'BBB Hello world');
    sync(a, b);

    expect(fieldOf(a, 'i2', 'caption')).toBe('BBB Hello world AAA');
    expect(fieldOf(b, 'i2', 'caption')).toBe('BBB Hello world AAA');
  });
});
