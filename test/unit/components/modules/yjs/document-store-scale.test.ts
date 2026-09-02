import { describe, it, expect } from 'vitest';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import type { OutputBlockData } from '../../../../../types/data-formats/output-data';

/**
 * Document SHAPE must never overflow the stack: a peer can write a parent or
 * content chain tens of thousands deep in one update, and the store's walks
 * run inside the observer during `Y.applyUpdate` on every member.
 * Generous timeouts on purpose — these pin termination, not speed.
 */
const createStore = (): DocumentStore => new DocumentStore(new YBlockSerializer());

const CHAIN_LENGTH = 50_000;
const SLOW = 120_000;

/** b0 → b1 → … each block's parent is the previous one; content lists only when asked. */
const chain = (length: number, withContent: boolean): OutputBlockData[] =>
  Array.from({ length }, (_, index) => {
    const block: OutputBlockData = { id: `b${index}`, type: 'paragraph', data: { text: String(index) } };

    if (index > 0) {
      block.parent = `b${index - 1}`;
    }

    if (withContent && index < length - 1) {
      block.content = [`b${index + 1}`];
    }

    return block;
  });

describe('DocumentStore — deep document shapes terminate', () => {
  it('serializes a 50k parent-only chain written deepest-first (parent links, no content lists)', () => {
    const store = createStore();

    // Deepest first: every parent chain is then walked in full before any
    // ancestor is known, which is what drives the colouring to full depth.
    store.fromJSON(chain(CHAIN_LENGTH, false).reverse());

    const json = store.toJSON();

    expect(json).toHaveLength(CHAIN_LENGTH);
    expect(json[0].id).toBe('b0');
    expect(json.every((block) => (
      block.id === 'b0' || block.parent === `b${Number(String(block.id).slice(1)) - 1}`
    ))).toBe(true);
  }, SLOW);

  it('serializes a 50k content chain on the author and on a receiving peer', () => {
    const author = createStore();

    author.fromJSON(chain(CHAIN_LENGTH, true));

    const json = author.toJSON();

    expect(json).toHaveLength(CHAIN_LENGTH);
    expect(json.map((block) => block.id).slice(0, 3)).toEqual(['b0', 'b1', 'b2']);
    expect(json.at(-1)?.id).toBe(`b${CHAIN_LENGTH - 1}`);

    const peer = createStore();

    peer.applyRemoteUpdate(author.encodeStateAsUpdate(), { source: 'author' });

    expect(peer.toJSON()).toHaveLength(CHAIN_LENGTH);
  }, SLOW);

  it('adds a block to a 50k content chain', () => {
    const store = createStore();

    store.fromJSON(chain(CHAIN_LENGTH, true));
    store.addBlock({ id: 'tail', type: 'paragraph', data: { text: 'appended' } });

    expect(store.rootOrder.toArray()).toEqual(['b0', 'tail']);
    expect(store.orderedIds().at(-1)).toBe('tail');
  }, SLOW);

  it('places a root block under the deepest node of a 50k chain (cycle check walks the whole chain)', () => {
    const store = createStore();
    const deepest = `b${CHAIN_LENGTH - 1}`;

    store.fromJSON([...chain(CHAIN_LENGTH, true), { id: 'mover', type: 'paragraph', data: { text: 'x' } }]);
    store.applyPlacement('mover', { parentId: deepest, afterId: null }, 'local');

    expect(store.getPlacement('mover')).toEqual({ parentId: deepest, afterId: null });

    // The reverse placement WOULD close a cycle and must be refused, not overflow.
    store.applyPlacement('b0', { parentId: 'mover', afterId: null }, 'local');

    expect(store.getBlockById('b0')?.get('parentId')).toBeUndefined();
  }, SLOW);
});

/**
 * One Enter in a large flat document must stay cheap. The slot translation
 * used to look every order entry up in the flat list (O(n²): ~3 s at 10k);
 * the bound below is deliberately loose — it catches a quadratic regression,
 * not a slow machine.
 */
describe('DocumentStore — flat-document insert and move cost', () => {
  const FLAT_LENGTH = 10_000;
  const LOOSE_BOUND_MS = 1_000;

  const flat = (): OutputBlockData[] =>
    Array.from({ length: FLAT_LENGTH }, (_, index) => ({ id: `f${index}`, type: 'paragraph', data: { text: '' } }));

  it('adds a block at the end of 10k flat blocks well under a second', () => {
    const store = createStore();

    store.fromJSON(flat());

    const startedAt = performance.now();

    store.addBlock({ id: 'new', type: 'paragraph', data: { text: '' } });

    expect(performance.now() - startedAt).toBeLessThan(LOOSE_BOUND_MS);
    expect(store.rootOrder.toArray().at(-1)).toBe('new');
  }, SLOW);

  it('moves the first of 10k flat blocks to the end well under a second', () => {
    const store = createStore();

    store.fromJSON(flat());

    const startedAt = performance.now();

    store.moveBlock('f0', FLAT_LENGTH - 1, 'local');

    expect(performance.now() - startedAt).toBeLessThan(LOOSE_BOUND_MS);
    expect(store.rootOrder.toArray().at(-1)).toBe('f0');
  }, SLOW);
});

/**
 * Duplicate order entries accumulate when concurrent moves merge; removing
 * the block must clear every one of them. Deleting back-to-front by
 * recursion re-copied the array per occurrence: 20k duplicates stalled for
 * tens of seconds and then overflowed the stack with the transaction
 * half-committed (map entry gone, thousands of entries dangling).
 */
describe('DocumentStore — removing a block with many duplicate order entries', () => {
  it('removes 20k duplicate root entries, leaving none dangling', () => {
    const store = createStore();

    store.fromJSON([
      { id: 'dup', type: 'paragraph', data: { text: '' } },
      { id: 'keep', type: 'paragraph', data: { text: '' } },
    ]);
    store.transact(() => {
      store.rootOrder.insert(1, Array.from({ length: 20_000 }, () => 'dup'));
    }, 'local');

    store.removeBlock('dup');

    expect(store.blocksMap.has('dup')).toBe(false);
    expect(store.rootOrder.toArray()).toEqual(['keep']);
  }, SLOW);
});
