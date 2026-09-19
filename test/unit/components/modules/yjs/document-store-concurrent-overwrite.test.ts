import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';

const createStore = (): DocumentStore => new DocumentStore(new YBlockSerializer());

const paragraph = (id: string, text: string): { id: string; type: string; data: { text: string } } => ({
  id,
  type: 'paragraph',
  data: { text },
});

/** Exchange diffs against each peer's pre-exchange state vector, as the provider does. */
const sync = (a: DocumentStore, b: DocumentStore): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

const blockOf = (store: DocumentStore, id: string): Record<string, unknown> | undefined =>
  store.toJSON().find((candidate) => candidate.id === id) as Record<string, unknown> | undefined;

const dataOf = (store: DocumentStore, id: string): Record<string, unknown> =>
  (blockOf(store, id)?.data ?? {}) as Record<string, unknown>;

const textOf = (store: DocumentStore, id: string): string =>
  (dataOf(store, id).text as string | undefined) ?? '';

/**
 * Turn-into rewrites a block in place. It used to `set` a whole fresh data map
 * over the old one, and a whole-key set is last-writer-wins: the Y.Text the
 * other person was typing into went away with everything in it, because their
 * edits live INSIDE the value that was replaced.
 */
describe('DocumentStore.replaceBlockContent — a peer typing while the block is converted', () => {
  let storeA: DocumentStore;
  let storeB: DocumentStore;

  beforeEach(() => {
    storeA = createStore();
    storeB = createStore();

    storeA.fromJSON([paragraph('b1', 'Hello world')]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());
  });

  it('keeps the other peer\'s typing when the conversion carries the same field', () => {
    storeB.updateBlockData('b1', 'text', 'Hello BBB world');
    storeA.replaceBlockContent('b1', 'header', { text: 'Hello world',
      level: 2 });

    sync(storeA, storeB);

    expect(textOf(storeA, 'b1')).toBe('Hello BBB world');
    expect(textOf(storeB, 'b1')).toBe('Hello BBB world');
    expect(blockOf(storeA, 'b1')?.type).toBe('header');
    expect(dataOf(storeA, 'b1').level).toBe(2);
  });

  it('keeps typing that lands after the conversion mergeable, not frozen as a plain string', () => {
    storeA.replaceBlockContent('b1', 'header', { text: 'Hello world',
      level: 2 });
    sync(storeA, storeB);

    storeA.updateBlockData('b1', 'text', 'Hello world AAA');
    storeB.updateBlockData('b1', 'text', 'Hello BBB world');

    sync(storeA, storeB);

    expect(textOf(storeA, 'b1')).toBe('Hello BBB world AAA');
    expect(textOf(storeB, 'b1')).toBe('Hello BBB world AAA');
  });

  /**
   * Replace still means replace: a conversion to a tool with a different data
   * shape drops the keys the new shape does not carry, on both peers.
   */
  it('drops the fields the new tool does not carry', () => {
    storeB.updateBlockData('b1', 'text', 'Hello BBB world');
    storeA.replaceBlockContent('b1', 'image', { url: 'https://example.com/a.png' });

    sync(storeA, storeB);

    expect(dataOf(storeA, 'b1')).toEqual({ url: 'https://example.com/a.png' });
    expect(dataOf(storeB, 'b1')).toEqual({ url: 'https://example.com/a.png' });
  });

  it('rebuilds the data map when the block has none yet', () => {
    const store = createStore();
    const raw = new Y.Doc();

    raw.transact(() => {
      const block = new Y.Map<unknown>();

      raw.getMap<Y.Map<unknown>>('blocks').set('b1', block);
      block.set('id', 'b1');
      block.set('type', 'paragraph');
      block.set('contentIds', new Y.Array<string>());
      raw.getArray<string>('root').push(['b1']);
    });
    store.applyRemoteUpdate(Y.encodeStateAsUpdate(raw));

    expect(store.replaceBlockContent('b1', 'header', { text: 'Hi',
      level: 1 })).toBe(true);
    expect(dataOf(store, 'b1')).toEqual({ text: 'Hi',
      level: 1 });
  });

  it('normalizes an empty paragraph the same way the add path does', () => {
    storeA.replaceBlockContent('b1', 'paragraph', {});

    expect(dataOf(storeA, 'b1')).toEqual({ text: '' });
  });

  it('returns false for a block that is not in the document', () => {
    expect(storeA.replaceBlockContent('nope', 'header', { text: 'x' })).toBe(false);
  });
});

/**
 * `editor.render()` / `blocks.render()` reach the document through `fromJSON`,
 * which used to delete every block and build fresh Y.Maps under the same ids.
 * A peer's in-flight edit lives INSIDE the map that is thrown away, so it is
 * gone — deterministically, not as a race.
 */
describe('DocumentStore.fromJSON — re-rendering a document someone else is editing', () => {
  let storeA: DocumentStore;
  let storeB: DocumentStore;

  beforeEach(() => {
    storeA = createStore();
    storeB = createStore();

    storeA.fromJSON([paragraph('b1', 'Hello world'), paragraph('b2', 'Second')]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());
  });

  it('keeps a peer\'s in-flight typing when the same blocks are rendered again', () => {
    storeB.updateBlockData('b1', 'text', 'Hello BBB world');

    storeA.fromJSON([paragraph('b1', 'Hello world'), paragraph('b2', 'Second')]);

    sync(storeA, storeB);

    expect(textOf(storeA, 'b1')).toBe('Hello BBB world');
    expect(textOf(storeB, 'b1')).toBe('Hello BBB world');
  });

  it('leaves the block\'s mergeable text able to merge after the re-render', () => {
    storeA.fromJSON([paragraph('b1', 'Hello world'), paragraph('b2', 'Second')]);
    sync(storeA, storeB);

    storeA.updateBlockData('b1', 'text', 'Hello world AAA');
    storeB.updateBlockData('b1', 'text', 'Hello BBB world');

    sync(storeA, storeB);

    expect(textOf(storeA, 'b1')).toBe('Hello BBB world AAA');
    expect(textOf(storeB, 'b1')).toBe('Hello BBB world AAA');
  });

  it('still replaces the document: blocks not rendered are gone, new ones arrive, order follows', () => {
    storeA.fromJSON([paragraph('b3', 'Third'), paragraph('b1', 'Changed')]);

    expect(storeA.toJSON().map((block) => block.id)).toEqual(['b3', 'b1']);
    expect(textOf(storeA, 'b1')).toBe('Changed');
    expect(storeA.getBlockById('b2')).toBeUndefined();
  });

  it('rewrites a kept block\'s type, hierarchy and tunes', () => {
    storeA.fromJSON([
      { id: 'b1', type: 'header', data: { text: 'Hello world',
        level: 2 }, tunes: { align: { value: 'center' } }, content: ['b2'] },
      { id: 'b2', type: 'paragraph', data: { text: 'Second' }, parent: 'b1' },
    ]);

    const [first, second] = storeA.toJSON();

    expect(first.type).toBe('header');
    expect(first.data).toEqual({ text: 'Hello world',
      level: 2 });
    expect(first.tunes).toEqual({ align: { value: 'center' } });
    expect(first.content).toEqual(['b2']);
    expect(second.parent).toBe('b1');
  });

  it('drops a tune and a parent link the new data no longer carries', () => {
    storeA.fromJSON([
      { id: 'b1', type: 'paragraph', data: { text: 'one' }, tunes: { align: { value: 'center' } }, content: ['b2'] },
      { id: 'b2', type: 'paragraph', data: { text: 'two' }, parent: 'b1' },
    ]);

    storeA.fromJSON([paragraph('b1', 'one'), paragraph('b2', 'two')]);

    const [first, second] = storeA.toJSON();

    expect(first.tunes).toBeUndefined();
    expect(first.content).toBeUndefined();
    expect(second.parent).toBeUndefined();
  });
});
