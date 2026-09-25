import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer, type YjsOutputBlockData } from '../../../../../src/components/modules/yjs/serializer';

/**
 * Two people editing ONE document at the same time, losing STRUCTURE rather
 * than text: a block leaves its container, an order array gains an id that
 * names nothing, a child is listed twice, a drag stops working.
 *
 * Every test here states the no-loss law. A red one is a measured defect, not
 * a wish — the defect assertion is FIRST in each test so an unrelated earlier
 * expectation cannot stand in for it.
 *
 * Text merging inside a block is NOT this file's subject; see
 * concurrent-structural-edits.test.ts and document-store-order-laws.test.ts
 * for the cases those already pin.
 */

const createStore = (): DocumentStore => new DocumentStore(new YBlockSerializer());

const paragraph = (id: string, text: string, parent?: string): YjsOutputBlockData => ({
  id,
  type: 'paragraph',
  data: { text },
  ...(parent === undefined ? {} : { parent }),
});

const toggle = (id: string, content: string[], parent?: string): YjsOutputBlockData => ({
  id,
  type: 'toggle',
  data: {},
  content,
  ...(parent === undefined ? {} : { parent }),
});

/**
 * Exchange diffs against each peer's PRE-exchange state vector, as the
 * provider does. Both directions in one call, so neither edit was delivered
 * before the other was made — which is what makes them concurrent.
 */
const sync = (a: DocumentStore, b: DocumentStore): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

/**
 * Pin a store's Yjs client id. Two concurrent inserts at the same position are
 * ordered by client id, and an unpinned id is random per run — so an exact
 * order assertion about such a pair would be a coin flip.
 */
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

/**
 * Two peers on a document whose container carries a PLAIN array under
 * `contentIds` instead of a Y.Array. Both writers that ship mint a Y.Array
 * eagerly, so this is a foreign/older writer's document meeting
 * `getOrCreateContentOrder`'s healing branch.
 */
const twoPeersOnPlainContentIds = (childIds: string[]): { a: DocumentStore; b: DocumentStore } => {
  const raw = new Y.Doc();

  raw.transact(() => {
    const blocks = raw.getMap<Y.Map<unknown>>('blocks');
    const container = new Y.Map<unknown>();

    container.set('id', 'C');
    container.set('type', 'toggle');
    container.set('data', new Y.Map<unknown>());
    container.set('contentIds', []);
    blocks.set('C', container);

    for (const id of childIds) {
      const block = new Y.Map<unknown>();

      block.set('id', id);
      block.set('type', 'paragraph');
      block.set('data', new Y.Map<unknown>());
      block.set('contentIds', new Y.Array<string>());
      blocks.set(id, block);
    }

    raw.getArray<string>('root').push(['C', ...childIds]);
  });

  const a = createStore();
  const b = createStore();

  pinClientId(a, 1);
  pinClientId(b, 2);
  a.applyRemoteUpdate(Y.encodeStateAsUpdate(raw));
  b.applyRemoteUpdate(a.encodeStateAsUpdate());

  return { a, b };
};

const idsOf = (store: DocumentStore): string[] => store.toJSON().map((block) => String(block.id));

const blockOf = (store: DocumentStore, id: string): YjsOutputBlockData | undefined =>
  store.toJSON().find((candidate) => candidate.id === id);

const textOf = (store: DocumentStore, id: string): string =>
  ((blockOf(store, id)?.data ?? {}) as { text?: string }).text ?? '';

/** The store's own JSON fed back through a fresh store — the save/reload cycle. */
const roundTrip = (store: DocumentStore): YjsOutputBlockData[] => {
  const fresh = createStore();

  fresh.fromJSON(store.toJSON());

  return fresh.toJSON();
};

describe('DocumentStore — a block dragged while a peer drags the same block', () => {
  /**
   * A move deletes the id from every order array and re-inserts it. Each
   * peer's delete names the ITEM it saw, so neither deletes the other's
   * insert: the id ends up in the root order twice. The read side dedupes, so
   * `toJSON` looks right and the corruption is invisible until the next
   * insert measures against that array.
   */
  it('leaves the id exactly once in the root order array', () => {
    const { a, b } = twoPeers([
      paragraph('b1', 'one'),
      paragraph('b2', 'two'),
      paragraph('b3', 'three'),
    ]);

    a.moveBlockTo('b3', { parentId: null, afterId: null });
    b.moveBlockTo('b3', { parentId: null, afterId: 'b1' });

    sync(a, b);

    expect(a.rootOrder.toArray().filter((id) => id === 'b3')).toHaveLength(1);
    expect(a.rootOrder.toArray()).toEqual(b.rootOrder.toArray());
  });

  /**
   * The consequence a user sees. `orderSlotForFlatIndex` answers "after the
   * LAST entry whose flat position is below the target", and the duplicate is
   * such an entry sitting AFTER the block the slot should have landed before —
   * measured root order ["b3","b1","b3","b2"], so a desired flat index of 1
   * resolves to array slot 3. Pressing Enter on the first block puts the new
   * block after the SECOND one.
   */
  it('inserts the next block where the user asked for it, not one place later', () => {
    const { a, b } = twoPeers([
      paragraph('b1', 'one'),
      paragraph('b2', 'two'),
      paragraph('b3', 'three'),
    ]);

    a.moveBlockTo('b3', { parentId: null, afterId: null });
    b.moveBlockTo('b3', { parentId: null, afterId: 'b1' });

    sync(a, b);

    const before = a.orderedIds();

    a.addBlock(paragraph('fresh', 'fresh'), 1);

    expect(a.orderedIds()).toEqual([before[0], 'fresh', ...before.slice(1)]);
  });

  /**
   * MEASURED CLEAN, kept as a boundary: the same duplicated array does not
   * misplace this drag, because here the duplicate sits adjacent to its twin
   * at the front rather than after the block the slot must clear.
   */
  it('drags a sibling to the position the user dropped it at', () => {
    const { a, b } = twoPeers([
      paragraph('b1', 'one'),
      paragraph('b2', 'two'),
      paragraph('b3', 'three'),
    ]);

    a.moveBlockTo('b3', { parentId: null, afterId: null });
    b.moveBlockTo('b3', { parentId: null, afterId: 'b1' });

    sync(a, b);

    a.moveBlockTo('b1', { parentId: null, afterId: 'b2' });

    expect(a.orderedIds()).toEqual(['b3', 'b2', 'b1']);
  });
});

describe('DocumentStore — a block moved into a container the peer deletes', () => {
  it('keeps the moved block and its text', () => {
    const { a, b } = twoPeers([toggle('C', []), paragraph('X', 'ex'), paragraph('sib', 'sib')]);

    a.applyPlacement('X', { parentId: 'C', afterId: null }, 'local');
    b.removeBlock('C');

    sync(a, b);

    expect(idsOf(a)).toContain('X');
    expect(textOf(a, 'X')).toBe('ex');
    expect(idsOf(b)).toEqual(idsOf(a));
  });

  it('survives the save/reload cycle without dropping the moved block', () => {
    const { a, b } = twoPeers([toggle('C', []), paragraph('X', 'ex'), paragraph('sib', 'sib')]);

    a.applyPlacement('X', { parentId: 'C', afterId: null }, 'local');
    b.removeBlock('C');

    sync(a, b);

    expect(roundTrip(a).map((block) => block.id)).toContain('X');
    expect(roundTrip(a)).toEqual(a.toJSON());
  });

  /**
   * The block survives, but with a parentId naming a block that is gone for
   * good. A drag of it must still land: the editor no longer holds the
   * parent, so the drag names the root.
   */
  it('can still be repositioned by a drag', () => {
    const { a, b } = twoPeers([toggle('C', []), paragraph('X', 'ex'), paragraph('tail', 'tail')]);

    a.applyPlacement('X', { parentId: 'C', afterId: null }, 'local');
    b.removeBlock('C');

    sync(a, b);

    // The sync repair cuts the link to the deleted parent; the drag below
    // names the root anyway, so this is the only check of that repair.
    expect(a.getBlockById('X')?.get('parentId')).toBeUndefined();

    a.moveBlockTo('X', { parentId: null, afterId: null });

    expect(idsOf(a)[0]).toBe('X');
    expect(a.rootOrder.toArray()).toContain('X');
  });
});

describe('DocumentStore — two peers drop the same block into one container', () => {
  /**
   * Both peers insert the id into the same contentIds array at different
   * slots, and neither delete names the other's item. `projectHierarchy`
   * filters `content` by parent agreement but never dedupes, so the emitted
   * block lists the same child twice while the flat order carries it once —
   * the two halves of one `toJSON` contradict each other.
   */
  it('lists the child exactly once in the parent content', () => {
    const { a, b } = twoPeers([
      toggle('C', ['c1']),
      paragraph('c1', 'one', 'C'),
      paragraph('X', 'ex'),
    ]);

    a.applyPlacement('X', { parentId: 'C', afterId: null }, 'local');
    b.applyPlacement('X', { parentId: 'C', afterId: 'c1' }, 'local');

    sync(a, b);

    expect(blockOf(a, 'C')?.content?.filter((id) => id === 'X')).toHaveLength(1);
    expect(idsOf(a)).toEqual(idsOf(b));
    expect(roundTrip(a)).toEqual(a.toJSON());
  });
});

describe('DocumentStore — a block deleted while the peer moves it into a container', () => {
  /**
   * `projectHierarchy` keeps a child id with no map entry on purpose, so a
   * not-yet-arrived peer's slot is not lost. When the block was DELETED
   * rather than not-yet-seen, that id never resolves: the emitted container
   * lists a child that no reader can look up, for the life of the document.
   */
  it('does not leave a ghost child id in the parent content', () => {
    const { a, b } = twoPeers([toggle('C', []), paragraph('X', 'ex')]);

    a.removeBlock('X');
    b.applyPlacement('X', { parentId: 'C', afterId: null }, 'local');

    sync(a, b);

    const emitted = new Set(idsOf(a));
    const ghosts = (blockOf(a, 'C')?.content ?? []).filter((id) => !emitted.has(id));

    expect(ghosts).toEqual([]);
    expect(idsOf(a)).toEqual(idsOf(b));
  });

  /** The root order keeps the same kind of dead entry when the race is a move. */
  it('does not leave a phantom id in the root order array', () => {
    const { a, b } = twoPeers([paragraph('b1', 'one'), paragraph('b2', 'two'), paragraph('b3', 'three')]);

    a.removeBlock('b2');
    b.moveBlockTo('b2', { parentId: null, afterId: null });

    sync(a, b);

    expect(a.rootOrder.toArray()).toEqual(['b1', 'b3']);
    expect(idsOf(a)).toEqual(['b1', 'b3']);
    expect(idsOf(b)).toEqual(idsOf(a));
  });
});

describe('DocumentStore — a container whose contentIds is not a Y.Array', () => {
  /**
   * `getOrCreateContentOrder`'s healing branch `set`s a fresh Y.Array on the
   * container. A map set is last-writer-wins, so when both peers heal the
   * same container at once the loser's array is discarded WITH the child id
   * inside it, and that child loses its membership permanently. This is
   * exactly the bug the eager mint in `outputDataToYBlock` was added to
   * prevent — the healing path still has it.
   */
  it('keeps both peers\' children when each moves one in', () => {
    const { a, b } = twoPeersOnPlainContentIds(['x', 'y']);

    a.applyPlacement('x', { parentId: 'C', afterId: null }, 'local');
    b.applyPlacement('y', { parentId: 'C', afterId: null }, 'local');

    sync(a, b);

    expect([...(blockOf(a, 'C')?.content ?? [])].sort()).toEqual(['x', 'y']);
    expect(idsOf(a)).toEqual(idsOf(b));
  });

  it('keeps both peers\' newly added children', () => {
    const { a, b } = twoPeersOnPlainContentIds([]);

    a.addBlock(paragraph('na', 'A-child', 'C'));
    b.addBlock(paragraph('nb', 'B-child', 'C'));

    sync(a, b);

    expect([...(blockOf(a, 'C')?.content ?? [])].sort()).toEqual(['na', 'nb']);
    expect(idsOf(a)).toEqual(idsOf(b));
  });
});

/**
 * Hypotheses that MEASURED clean. Kept green so a future change that breaks
 * one is caught, and so the report's refutations have evidence behind them.
 */
describe('DocumentStore — hierarchy races that do NOT lose anything', () => {
  it('keeps a child inserted into a container the peer deletes', () => {
    const { a, b } = twoPeers([toggle('C', []), paragraph('sib', 'sib')]);

    a.addBlock(paragraph('new', 'fresh', 'C'));
    b.removeBlock('C');

    sync(a, b);

    expect(idsOf(a)).toContain('new');
    expect(textOf(a, 'new')).toBe('fresh');
    expect(idsOf(b)).toEqual(idsOf(a));
  });

  it('keeps a grandchild whose intermediate container the peer removes', () => {
    const { a, b } = twoPeers([
      toggle('R', ['M']),
      toggle('M', ['L'], 'R'),
      paragraph('L', 'leaf', 'M'),
    ]);

    a.removeBlock('M');
    b.updateBlockData('L', 'text', 'leaf edited');

    sync(a, b);

    expect(idsOf(a)).toContain('L');
    expect(textOf(a, 'L')).toBe('leaf edited');
    expect(idsOf(b)).toEqual(idsOf(a));
  });

  it('keeps both first children two peers add to one container', () => {
    const { a, b } = twoPeers([toggle('C', []), paragraph('sib', 'sib')]);

    a.addBlock(paragraph('na', 'A-child', 'C'));
    b.addBlock(paragraph('nb', 'B-child', 'C'));

    sync(a, b);

    expect([...(blockOf(a, 'C')?.content ?? [])].sort()).toEqual(['na', 'nb']);
    expect(idsOf(a)).toContain('na');
    expect(idsOf(a)).toContain('nb');
    expect(idsOf(b)).toEqual(idsOf(a));
  });

  it('keeps every child of a container one peer deletes while the other reorders inside it', () => {
    const { a, b } = twoPeers([
      toggle('C', ['c1', 'c2', 'c3']),
      paragraph('c1', 'one', 'C'),
      paragraph('c2', 'two', 'C'),
      paragraph('c3', 'three', 'C'),
    ]);

    a.removeBlock('C');
    b.applyPlacement('c3', { parentId: 'C', afterId: null }, 'local');

    sync(a, b);

    expect([...idsOf(a)].sort()).toEqual(['c1', 'c2', 'c3']);
    expect(idsOf(b)).toEqual(idsOf(a));
  });

  it('keeps a child its peer moved to another container while the old one is deleted', () => {
    const { a, b } = twoPeers([
      toggle('C', ['X']),
      paragraph('X', 'ex', 'C'),
      toggle('D', []),
    ]);

    a.removeBlock('C');
    b.applyPlacement('X', { parentId: 'D', afterId: null }, 'local');

    sync(a, b);

    expect(blockOf(a, 'X')?.parent).toBe('D');
    expect(blockOf(a, 'D')?.content).toEqual(['X']);
    expect(idsOf(a)).toEqual(idsOf(b));
  });

  it('keeps the nesting when one peer nests a container and the other fills it', () => {
    const { a, b } = twoPeers([toggle('D', []), toggle('C', []), paragraph('X', 'ex')]);

    a.applyPlacement('C', { parentId: 'D', afterId: null }, 'local');
    b.applyPlacement('X', { parentId: 'C', afterId: null }, 'local');

    sync(a, b);

    expect(idsOf(a)).toEqual(['D', 'C', 'X']);
    expect(blockOf(a, 'X')?.parent).toBe('C');
    expect(blockOf(a, 'C')?.parent).toBe('D');
    expect(idsOf(b)).toEqual(idsOf(a));
    expect(roundTrip(a)).toEqual(a.toJSON());
  });

  /** A cycle three links long, closed by two peers — no member is dropped. */
  it('keeps every block when a three-step cycle is closed across peers', () => {
    const { a, b } = twoPeers([toggle('X', []), toggle('Y', []), toggle('Z', [])]);

    a.applyPlacement('X', { parentId: 'Y', afterId: null }, 'local');
    a.applyPlacement('Y', { parentId: 'Z', afterId: null }, 'local');
    b.applyPlacement('Z', { parentId: 'X', afterId: null }, 'local');

    sync(a, b);

    expect([...idsOf(a)].sort()).toEqual(['X', 'Y', 'Z']);
    expect(idsOf(b)).toEqual(idsOf(a));
    expect(roundTrip(a)).toEqual(a.toJSON());
  });

  it('keeps both children when one peer promotes a child out of a container the other deletes', () => {
    const { a, b } = twoPeers([
      toggle('C', ['c1', 'c2']),
      paragraph('c1', 'one', 'C'),
      paragraph('c2', 'two', 'C'),
    ]);

    a.applyPlacement('c1', { parentId: null, afterId: 'C' }, 'local');
    b.removeBlock('C');

    sync(a, b);

    expect(idsOf(a)).toContain('c1');
    expect(idsOf(a)).toContain('c2');
    expect(idsOf(b)).toEqual(idsOf(a));
    expect(roundTrip(a)).toEqual(a.toJSON());
  });
});
