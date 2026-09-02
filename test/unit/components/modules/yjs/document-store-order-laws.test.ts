import { describe, it, expect, beforeEach } from 'vitest';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';

const createStore = (): DocumentStore => {
  return new DocumentStore(new YBlockSerializer());
};

const paragraph = (id: string, text: string): { id: string; type: string; data: { text: string } } => ({
  id,
  type: 'paragraph',
  data: { text },
});

/**
 * Exchange diffs computed against each peer's pre-exchange state vector.
 * Applying both leaves both docs with the same operation set — Yjs
 * guarantees convergence from there.
 */
const sync = (a: DocumentStore, b: DocumentStore): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

describe('DocumentStore order laws — two-doc convergence via the binary seam', () => {
  let storeA: DocumentStore;
  let storeB: DocumentStore;

  beforeEach(() => {
    storeA = createStore();
    storeB = createStore();

    // Single-seeder: only A loads; B receives the doc through the seam.
    storeA.fromJSON([
      paragraph('b1', 'First'),
      paragraph('b2', 'Second'),
      paragraph('b3', 'Third'),
    ]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());
  });

  it('concurrent move + edit of the moved block: the edit survives on both peers', () => {
    storeA.moveBlock('b3', 0);
    storeB.updateBlockData('b3', 'text', 'Edited on B');

    sync(storeA, storeB);

    expect(storeA.toJSON()).toEqual(storeB.toJSON());

    const b3Entries = storeA.toJSON().filter((block) => block.id === 'b3');

    expect(b3Entries).toHaveLength(1);
    expect(b3Entries[0].data.text).toBe('Edited on B');
  });

  it('concurrent move + move of the same block: it exists once and both peers agree on order', () => {
    storeA.moveBlock('b3', 0);
    storeB.moveBlock('b3', 1);

    sync(storeA, storeB);

    const idsA = storeA.toJSON().map((block) => block.id);
    const idsB = storeB.toJSON().map((block) => block.id);

    expect(idsA).toEqual(idsB);
    expect(idsA.filter((id) => id === 'b3')).toHaveLength(1);
    expect([...idsA].sort()).toEqual(['b1', 'b2', 'b3']);
  });

  it('concurrent remove + edit of the removed block: the removal wins cleanly on both peers', () => {
    storeA.removeBlock('b2');
    storeB.updateBlockData('b2', 'text', 'Edited on B');

    sync(storeA, storeB);

    expect(storeA.toJSON()).toEqual(storeB.toJSON());
    expect(storeA.toJSON().map((block) => block.id)).toEqual(['b1', 'b3']);
  });
});

describe('DocumentStore order laws — block identity', () => {
  it('moveBlock never touches the block Y.Map: getBlockById is reference-equal across a move', () => {
    const store = createStore();

    store.fromJSON([
      paragraph('b1', 'First'),
      paragraph('b2', 'Second'),
      paragraph('b3', 'Third'),
    ]);

    const before = store.getBlockById('b2');

    store.moveBlock('b2', 0);

    expect(store.getBlockById('b2')).toBe(before);
  });
});

describe('DocumentStore order laws — derived order', () => {
  let store: DocumentStore;

  beforeEach(() => {
    store = createStore();
  });

  it('duplicate id in an order array: dedupe on read, first occurrence wins', () => {
    store.fromJSON([
      paragraph('b1', 'First'),
      paragraph('b2', 'Second'),
    ]);

    store.transact(() => {
      store.rootOrder.push(['b1']);
    }, 'local');

    expect(store.rootOrder.toArray()).toEqual(['b1', 'b2', 'b1']);
    expect(store.toJSON().map((block) => block.id)).toEqual(['b1', 'b2']);
    expect(store.orderedIds().indexOf('b1')).toBe(0);
  });

  it('id present in no order array renders at the end; orphans sort by id', () => {
    // Dangling parents put zz/aa in NO order array (not root — they have a
    // parent; not any contentIds — the parent doesn't exist).
    store.fromJSON([
      paragraph('b1', 'First'),
      { id: 'zz', type: 'paragraph', data: { text: 'Stranded Z' }, parent: 'ghost' },
      paragraph('b2', 'Second'),
      { id: 'aa', type: 'paragraph', data: { text: 'Stranded A' }, parent: 'ghost' },
    ]);

    expect(store.rootOrder.toArray()).toEqual(['b1', 'b2']);
    expect(store.toJSON().map((block) => block.id)).toEqual(['b1', 'b2', 'aa', 'zz']);
  });

  it('an orphan id disappears from the tail once its map entry is removed', () => {
    store.fromJSON([
      paragraph('b1', 'First'),
      { id: 'zz', type: 'paragraph', data: { text: 'Stranded' }, parent: 'ghost' },
    ]);

    store.removeBlock('zz');

    expect(store.toJSON().map((block) => block.id)).toEqual(['b1']);
  });

  it('id listed in root AND in a contentIds array: the first DFS occurrence wins', () => {
    store.fromJSON([
      { id: 'parent', type: 'toggle', data: {}, content: ['child'] },
      { id: 'child', type: 'paragraph', data: { text: 'Nested' }, parent: 'parent' },
      paragraph('after', 'After'),
    ]);

    // Corrupt: also list the child at root, after everything.
    store.transact(() => {
      store.rootOrder.push(['child']);
    }, 'local');

    // DFS reaches the child through the parent first — the root entry is
    // the duplicate and is ignored.
    expect(store.toJSON().map((block) => block.id)).toEqual(['parent', 'child', 'after']);
  });
});

describe('DocumentStore order laws — applyPlacement', () => {
  let store: DocumentStore;

  beforeEach(() => {
    store = createStore();

    store.fromJSON([
      { id: 'parent-a', type: 'toggle', data: {}, content: ['child-1', 'child-2'] },
      { id: 'child-1', type: 'paragraph', data: { text: 'One' }, parent: 'parent-a' },
      { id: 'child-2', type: 'paragraph', data: { text: 'Two' }, parent: 'parent-a' },
      { id: 'parent-b', type: 'toggle', data: {}, content: [] },
      paragraph('root-1', 'Root'),
    ]);
  });

  it('reparents in one transaction: parentId key + both order arrays', () => {
    store.applyPlacement('child-1', { parentId: 'parent-b', afterId: null }, 'local');

    const child = store.getBlockById('child-1');
    const oldParent = store.getBlockById('parent-a');
    const newParent = store.getBlockById('parent-b');

    expect(child?.get('parentId')).toBe('parent-b');
    expect((oldParent?.get('contentIds') as { toArray(): string[] }).toArray()).toEqual(['child-2']);
    expect((newParent?.get('contentIds') as { toArray(): string[] }).toArray()).toEqual(['child-1']);
    expect(store.toJSON().map((block) => block.id))
      .toEqual(['parent-a', 'child-2', 'parent-b', 'child-1', 'root-1']);
  });

  it('root promotion DELETES the parentId key (never writes a null value)', () => {
    store.applyPlacement('child-1', { parentId: null, afterId: 'parent-a' }, 'local');

    const child = store.getBlockById('child-1');

    expect(child?.has('parentId')).toBe(false);
    expect(store.rootOrder.toArray()).toEqual(['parent-a', 'child-1', 'parent-b', 'root-1']);
    expect(store.toJSON().map((block) => block.id))
      .toEqual(['parent-a', 'child-2', 'child-1', 'parent-b', 'root-1']);
  });

  it('afterId null inserts as the FIRST sibling', () => {
    store.applyPlacement('child-2', { parentId: 'parent-a', afterId: null }, 'local');

    const parent = store.getBlockById('parent-a');

    expect((parent?.get('contentIds') as { toArray(): string[] }).toArray())
      .toEqual(['child-2', 'child-1']);
  });

  it('missing afterId appends at the end of the target order', () => {
    store.applyPlacement('root-1', { parentId: 'parent-a', afterId: 'no-such-sibling' }, 'local');

    const parent = store.getBlockById('parent-a');

    expect((parent?.get('contentIds') as { toArray(): string[] }).toArray())
      .toEqual(['child-1', 'child-2', 'root-1']);
    expect(store.getBlockById('root-1')?.get('parentId')).toBe('parent-a');
  });

  it('missing parent map entry leaves the block in no order array (orphan tolerance)', () => {
    store.applyPlacement('child-1', { parentId: 'ghost-parent', afterId: null }, 'local');

    const child = store.getBlockById('child-1');

    expect(child?.get('parentId')).toBe('ghost-parent');
    expect(store.rootOrder.toArray()).not.toContain('child-1');

    const inAnyContentIds = store.toJSON()
      .some((block) => (block.content ?? []).includes('child-1'));

    expect(inAnyContentIds).toBe(false);

    // Orphan tolerance: it still renders, at the end.
    const ids = store.toJSON().map((block) => block.id);

    expect(ids[ids.length - 1]).toBe('child-1');
  });

  it('placing an id that already appears twice in order arrays heals the duplicate', () => {
    store.transact(() => {
      store.rootOrder.push(['child-1']);
    }, 'local');

    store.applyPlacement('child-1', { parentId: null, afterId: null }, 'local');

    expect(store.rootOrder.toArray().filter((id) => id === 'child-1')).toHaveLength(1);

    const parentContent = store.getBlockById('parent-a')?.get('contentIds') as { toArray(): string[] };

    expect(parentContent.toArray()).not.toContain('child-1');
  });
});

describe('DocumentStore order laws — concurrent hierarchy conflicts', () => {
  let storeA: DocumentStore;
  let storeB: DocumentStore;

  const seedTwoContainers = (): void => {
    storeA.fromJSON([
      { id: 'P', type: 'toggle', data: {}, content: ['p1'] },
      { id: 'p1', type: 'paragraph', data: { text: 'p1' }, parent: 'P' },
      { id: 'Q', type: 'toggle', data: {}, content: ['q1'] },
      { id: 'q1', type: 'paragraph', data: { text: 'q1' }, parent: 'Q' },
      paragraph('X', 'x'),
    ]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());
  };

  beforeEach(() => {
    storeA = createStore();
    storeB = createStore();
  });

  it('concurrent FIRST children of the same childless container: both memberships survive', () => {
    storeA.fromJSON([
      { id: 'P', type: 'toggle', data: {} },
      paragraph('x', 'x'),
      paragraph('y', 'y'),
    ]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());

    storeA.applyPlacement('x', { parentId: 'P', afterId: null }, 'local');
    storeB.applyPlacement('y', { parentId: 'P', afterId: null }, 'local');

    sync(storeA, storeB);

    expect(storeA.toJSON()).toEqual(storeB.toJSON());

    const content = storeA.toJSON().find((block) => block.id === 'P')?.content ?? [];

    // LWW picks the sibling order; membership is not up for grabs.
    expect([...content].sort()).toEqual(['x', 'y']);
    expect(storeA.toJSON().map((block) => block.id).sort()).toEqual(['P', 'x', 'y']);
  });

  it('concurrent reparent to two different parents: single membership, position follows parentId', () => {
    seedTwoContainers();

    storeA.applyPlacement('X', { parentId: 'P', afterId: 'p1' }, 'local');
    storeB.applyPlacement('X', { parentId: 'Q', afterId: 'q1' }, 'local');

    sync(storeA, storeB);

    const json = storeA.toJSON();

    expect(json).toEqual(storeB.toJSON());

    // The parentId LWW winner is decided by yjs client ids — assert the law,
    // not which peer won.
    const winner = json.find((block) => block.id === 'X')?.parent;

    expect(winner === 'P' || winner === 'Q').toBe(true);

    const loser = winner === 'P' ? 'Q' : 'P';

    expect(json.find((block) => block.id === winner)?.content).toContain('X');
    expect(json.find((block) => block.id === loser)?.content ?? []).not.toContain('X');

    const ids = json.map((block) => block.id);
    const anchor = winner === 'P' ? 'p1' : 'q1';

    expect(ids.indexOf('X')).toBe(ids.indexOf(anchor) + 1);

    const roundTrip = createStore();

    roundTrip.fromJSON(json);

    expect(roundTrip.toJSON()).toEqual(json);
  });

  it('concurrent reparent forming a parent cycle: broken deterministically and cycle-free', () => {
    storeA.fromJSON([
      { id: 'P', type: 'toggle', data: {}, content: ['p1'] },
      { id: 'p1', type: 'paragraph', data: { text: 'p1' }, parent: 'P' },
      { id: 'Q', type: 'toggle', data: {}, content: ['q1'] },
      { id: 'q1', type: 'paragraph', data: { text: 'q1' }, parent: 'Q' },
    ]);
    storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());

    storeA.applyPlacement('P', { parentId: 'Q', afterId: 'q1' }, 'local');
    storeB.applyPlacement('Q', { parentId: 'P', afterId: 'p1' }, 'local');

    sync(storeA, storeB);

    const json = storeA.toJSON();

    expect(json).toEqual(storeB.toJSON());

    // Both writes touch DIFFERENT keys (P.parentId, Q.parentId) so there is no
    // LWW coin flip: 'P' < 'Q' keeps its parent, Q's link is the broken one.
    expect(json.map((block) => block.id)).toEqual(['Q', 'q1', 'P', 'p1']);
    expect(json.find((block) => block.id === 'P')?.parent).toBe('Q');
    expect(json.find((block) => block.id === 'Q')?.parent).toBeUndefined();
    expect(json.find((block) => block.id === 'Q')?.content).toEqual(['q1', 'P']);
    expect(json.find((block) => block.id === 'P')?.content).toEqual(['p1']);

    const roundTrip = createStore();

    roundTrip.fromJSON(json);

    expect(roundTrip.toJSON()).toEqual(json);
  });

  it('applyPlacement refuses to parent a block under its own descendant', () => {
    const store = createStore();

    store.fromJSON([
      { id: 'outer', type: 'toggle', data: {}, content: ['inner'] },
      { id: 'inner', type: 'toggle', data: {}, content: ['leaf'], parent: 'outer' },
      { id: 'leaf', type: 'paragraph', data: { text: 'leaf' }, parent: 'inner' },
    ]);

    store.applyPlacement('outer', { parentId: 'leaf', afterId: null }, 'local');

    // The cyclic parentId is never written, and the refused block is left in
    // no order array (orphan tolerance) rather than silently staying put.
    expect(store.getBlockById('outer')?.has('parentId')).toBe(false);
    expect(store.rootOrder.toArray()).not.toContain('outer');
    expect((store.getBlockById('leaf')?.get('contentIds') as { toArray(): string[] }).toArray())
      .toEqual([]);
    expect(store.toJSON().map((block) => block.id)).toEqual(['outer', 'inner', 'leaf']);
  });

  it('applyPlacement refuses a self-parent placement', () => {
    const store = createStore();

    store.fromJSON([paragraph('solo', 'Solo')]);

    store.applyPlacement('solo', { parentId: 'solo', afterId: null }, 'local');

    expect(store.getBlockById('solo')?.has('parentId')).toBe(false);
    expect(store.toJSON().map((block) => block.id)).toEqual(['solo']);
  });
});
