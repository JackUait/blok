import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import type { YjsOutputBlockData } from '../../../../../src/components/modules/yjs/serializer';

const createStore = (): DocumentStore => new DocumentStore(new YBlockSerializer());

/** Exchange diffs against each peer's pre-exchange state vector, as the provider does. */
const sync = (a: DocumentStore, b: DocumentStore): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

/** Pin the client id so a last-writer-wins tie resolves the same way every run. */
const pinClientId = (store: DocumentStore, clientId: number): void => {
  const doc = store.blocksMap.doc;

  if (doc === null) {
    throw new Error('DocumentStore has no Y.Doc');
  }

  doc.clientID = clientId;
};

const twoPeers = (blocks: YjsOutputBlockData[]): { a: DocumentStore; b: DocumentStore } => {
  const a = createStore();
  const b = createStore();

  pinClientId(a, 1);
  pinClientId(b, 2);

  a.fromJSON(blocks);
  b.applyRemoteUpdate(a.encodeStateAsUpdate());

  return { a, b };
};

const tunesOf = (store: DocumentStore, id: string): Record<string, unknown> =>
  store.toJSON().find((block) => block.id === id)?.tunes ?? {};

const containerOf = (store: DocumentStore, id: string, key: string): unknown =>
  store.getBlockById(id)?.get(key);

const paragraph = (): YjsOutputBlockData[] => [{ id: 'b1',
  type: 'paragraph',
  data: { text: 'hi' } }];

/**
 * `outputDataToYBlock` mints `tunes` EAGERLY so that the ONE peer creating the
 * block is the only creator of the container — two peers each `set`ting a fresh
 * map is last-writer-wins and the loser's tune goes with the discarded map.
 * A re-render must not undo that: rewriting a tuneless block has to CLEAR the
 * map's keys, never delete the key.
 */
describe('render keeps the eagerly-minted containers', () => {
  it('keeps the tunes map after rendering a block that carries no tunes', () => {
    const store = createStore();

    store.fromJSON(paragraph());

    expect(containerOf(store, 'b1', 'tunes')).toBeInstanceOf(Y.Map);

    store.fromJSON(paragraph());

    expect(containerOf(store, 'b1', 'tunes')).toBeInstanceOf(Y.Map);
  });

  it('keeps both tunes when two peers add a DIFFERENT tune after a re-render', () => {
    const { a, b } = twoPeers(paragraph());

    // Any editor.render() over the same ids goes through rewriteBlockInPlace.
    a.fromJSON(paragraph());
    sync(a, b);

    a.updateBlockTune('b1', 'align', { value: 'center' });
    b.updateBlockTune('b1', 'textColor', { color: 'red' });

    sync(a, b);

    expect(tunesOf(a, 'b1')).toEqual({ align: { value: 'center' },
      textColor: { color: 'red' } });
    expect(tunesOf(b, 'b1')).toEqual(tunesOf(a, 'b1'));
  });

  it('still drops tunes the render no longer carries', () => {
    const store = createStore();

    store.fromJSON([{ ...paragraph()[0],
      tunes: { align: { value: 'center' } } }]);

    expect(tunesOf(store, 'b1')).toEqual({ align: { value: 'center' } });

    store.fromJSON(paragraph());

    expect(tunesOf(store, 'b1')).toEqual({});
  });

  it('keeps the contentIds array after rendering a block that carries no children', () => {
    const store = createStore();

    store.fromJSON(paragraph());
    store.fromJSON(paragraph());

    expect(containerOf(store, 'b1', 'contentIds')).toBeInstanceOf(Y.Array);
  });

  it('keeps the mergeable Y.Text after re-rendering the same text', () => {
    const store = createStore();

    store.fromJSON(paragraph());

    const before = (store.getBlockById('b1')?.get('data') as Y.Map<unknown>).get('text');

    store.fromJSON(paragraph());

    const after = (store.getBlockById('b1')?.get('data') as Y.Map<unknown>).get('text');

    expect(before).toBeInstanceOf(Y.Text);
    expect(after).toBe(before);
  });
});
