import { describe, it, expect } from 'vitest';

/**
 * Paste and drag-and-drop performed while a remote peer is editing.
 *
 * Each case replays the write sequence the real code emits, read from source:
 *   - paste inserts ONE block at a time — `BlockInsertion.insert` calls
 *     `YjsManager.addBlock({ id, type, data, parent }, targetIndex)`
 *     (src/components/modules/blockManager/block-insertion.ts:343). A paste that
 *     REPLACES the current block wraps `removeBlock(old)` + `addBlock(new)` in
 *     one transaction (same file, :338).
 *   - a drag writes TWICE inside the move group: `moveBlock(id, resolvedIndex)`
 *     (block-mutation.ts:553) and then `applyBlockPlacement` with capture off
 *     (blockManager.ts:1256), which is `DocumentStore.applyPlacement`.
 *
 * Nothing here is a pinned defect: every law below was measured GREEN. The file
 * exists so the space stays ruled out — a red here is a regression in paste or
 * drag convergence, not a wish.
 */

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer, type YjsOutputBlockData } from '../../../../../src/components/modules/yjs/serializer';

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

const sync = (a: DocumentStore, b: DocumentStore): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

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

const idsOf = (store: DocumentStore): string[] => store.toJSON().map((block) => String(block.id));
const textOf = (store: DocumentStore, id: string): string =>
  ((store.toJSON().find((c) => c.id === id)?.data ?? {}) as { text?: string }).text ?? '';
const contentOf = (store: DocumentStore, id: string): string[] =>
  store.toJSON().find((c) => c.id === id)?.content ?? [];

/** What `BlockManager.insert()` writes per pasted block. */
const pasteBlock = (store: DocumentStore, block: YjsOutputBlockData, index: number): void => {
  store.addBlock(block, index);
};

describe('paste while a peer edits', () => {
  it('keeps every pasted block and the character the peer typed after it', () => {
    const { a, b } = twoPeers([paragraph('b1', 'one'), paragraph('b2', 'two')]);

    pasteBlock(a, paragraph('p1', 'P1'), 1);
    pasteBlock(a, paragraph('p2', 'P2'), 2);
    pasteBlock(a, paragraph('p3', 'P3'), 3);

    b.updateBlockData('b2', 'text', 'two!');

    sync(a, b);
    expect(idsOf(a)).toEqual(['b1', 'p1', 'p2', 'p3', 'b2']);
    expect(idsOf(b)).toEqual(idsOf(a));
  });

  it('keeps the pasted run contiguous when the peer inserts at the same spot', () => {
    const { a, b } = twoPeers([paragraph('b1', 'one'), paragraph('b2', 'two')]);

    pasteBlock(a, paragraph('p1', 'P1'), 1);
    pasteBlock(a, paragraph('p2', 'P2'), 2);
    pasteBlock(a, paragraph('p3', 'P3'), 3);

    pasteBlock(b, paragraph('x1', 'X'), 1);

    sync(a, b);
    expect(idsOf(a)).toEqual(idsOf(b));
    expect(idsOf(a)).toHaveLength(6);
    expect(idsOf(a).slice(idsOf(a).indexOf('p1'), idsOf(a).indexOf('p1') + 3)).toEqual(['p1', 'p2', 'p3']);
  });

  it('keeps both peers\' children when one pastes into a container the other fills', () => {
    const { a, b } = twoPeers([toggle('C', ['c1']), paragraph('c1', 'child', 'C'), paragraph('b2', 'after')]);

    pasteBlock(a, paragraph('p1', 'P1', 'C'), 2);
    pasteBlock(a, paragraph('p2', 'P2', 'C'), 3);

    pasteBlock(b, paragraph('x1', 'X', 'C'), 2);

    sync(a, b);
    expect(contentOf(a, 'C').slice().sort()).toEqual(['c1', 'p1', 'p2', 'x1']);
    expect(contentOf(b, 'C')).toEqual(contentOf(a, 'C'));
  });

  it('keeps the dragged block and the pasted block in one container', () => {
    const { a, b } = twoPeers([toggle('C', ['c1']), paragraph('c1', 'child', 'C'), paragraph('b2', 'dragged')]);

    a.applyPlacement('b2', { parentId: 'C', afterId: 'c1' }, 'local');
    pasteBlock(b, paragraph('x1', 'X', 'C'), 2);

    sync(a, b);
    expect(contentOf(a, 'C').slice().sort()).toEqual(['b2', 'c1', 'x1']);
    expect(idsOf(a)).toEqual(idsOf(b));
    expect(textOf(a, 'b2')).toBe('dragged');
  });

  it('keeps text the peer typed into the block being dragged', () => {
    const { a, b } = twoPeers([toggle('C', []), paragraph('b2', 'dragged')]);

    a.applyPlacement('b2', { parentId: 'C', afterId: null }, 'local');
    b.updateBlockData('b2', 'text', 'dragged!');

    sync(a, b);
    expect(textOf(a, 'b2')).toBe('dragged!');
  });

  it('keeps a pasted container and its children while the peer edits a sibling', () => {
    const { a, b } = twoPeers([paragraph('b1', 'one')]);

    // insert() never passes `content`; the parent link comes from each child.
    pasteBlock(a, toggle('T', [], undefined), 1);
    pasteBlock(a, paragraph('t1', 'T1', 'T'), 2);
    pasteBlock(a, paragraph('t2', 'T2', 'T'), 3);

    b.updateBlockData('b1', 'text', 'one!');

    sync(a, b);
    expect(idsOf(a)).toEqual(['b1', 'T', 't1', 't2']);
    expect(contentOf(a, 'T')).toEqual(['t1', 't2']);
  });

  it('replaces the block it was told to replace, leaving the rest alone', () => {
    const { a, b } = twoPeers([paragraph('b1', 'target'), paragraph('b2', 'after')]);

    // BlockInsertion: one transaction, removeBlock(old) + addBlock(new).
    a.transact(() => {
      a.removeBlock('b1');
      a.addBlock(paragraph('p1', 'pasted'), 0);
    }, 'local');

    b.updateBlockData('b1', 'text', 'target typed');

    sync(a, b);
    expect(idsOf(a)).toEqual(['p1', 'b2']);
  });

  it('keeps the dragged block\'s content when the target container is deleted', () => {
    const { a, b } = twoPeers([toggle('C', []), paragraph('b2', 'dragged')]);

    a.applyPlacement('b2', { parentId: 'C', afterId: null }, 'local');
    b.removeBlock('C');

    sync(a, b);
    expect(idsOf(a)).toContain('b2');
    expect(textOf(a, 'b2')).toBe('dragged');
    expect(idsOf(b)).toEqual(idsOf(a));
  });

  it('keeps pasted blocks when the target container is deleted', () => {
    const { a, b } = twoPeers([toggle('C', []), paragraph('b2', 'after')]);

    pasteBlock(a, paragraph('p1', 'P1', 'C'), 1);
    pasteBlock(a, paragraph('p2', 'P2', 'C'), 2);
    b.removeBlock('C');

    sync(a, b);
    expect(idsOf(a)).toContain('p1');
    expect(idsOf(a)).toContain('p2');
    expect(idsOf(b)).toEqual(idsOf(a));
  });

  it('keeps both documents, each contiguous, when two peers paste at one spot', () => {
    const { a, b } = twoPeers([paragraph('b1', 'one'), paragraph('b2', 'two')]);

    pasteBlock(a, paragraph('a1', 'A1'), 1);
    pasteBlock(a, paragraph('a2', 'A2'), 2);
    pasteBlock(b, paragraph('z1', 'Z1'), 1);
    pasteBlock(b, paragraph('z2', 'Z2'), 2);

    sync(a, b);
    expect(idsOf(a)).toEqual(idsOf(b));
    expect(idsOf(a)).toHaveLength(6);
    const ids = idsOf(a);
    expect(ids.indexOf('a2')).toBe(ids.indexOf('a1') + 1);
    expect(ids.indexOf('z2')).toBe(ids.indexOf('z1') + 1);
  });

  it('keeps the pasted child when the peer drags another child out', () => {
    const { a, b } = twoPeers([toggle('C', ['c1', 'c2']), paragraph('c1', 'one', 'C'), paragraph('c2', 'two', 'C'), paragraph('b2', 'tail')]);

    // A drags c1 out to root after b2.
    a.applyPlacement('c1', { parentId: null, afterId: 'b2' }, 'local');
    // B pastes a block into C right after c1.
    pasteBlock(b, paragraph('x1', 'X', 'C'), 2);

    sync(a, b);
    expect(contentOf(a, 'C').slice().sort()).toEqual(['c2', 'x1']);
    expect(idsOf(a)).toEqual(idsOf(b));
  });
});

describe('drag while a peer edits — moveBlock then applyPlacement', () => {
  it('keeps the peer\'s typing through a cross-container drag', () => {
    const { a, b } = twoPeers([
      toggle('C', ['c1']), paragraph('c1', 'one', 'C'),
      paragraph('b2', 'dragged'), paragraph('b3', 'tail'),
    ]);

    // DragController: transactMoves( move() -> moveBlock, setBlockParent -> applyPlacement )
    a.transact(() => {
      a.moveBlock('b2', 2);
      a.applyPlacement('b2', { parentId: 'C', afterId: 'c1' }, 'no-capture');
    }, 'local');

    b.updateBlockData('b2', 'text', 'dragged!');

    sync(a, b);
    expect(textOf(a, 'b2')).toBe('dragged!');
    expect(contentOf(a, 'C')).toEqual(['c1', 'b2']);
    expect(idsOf(a)).toEqual(idsOf(b));
  });

  it('lists both dragged blocks once when two peers drop into one container', () => {
    const { a, b } = twoPeers([
      toggle('C', ['c1']), paragraph('c1', 'one', 'C'),
      paragraph('x', 'X'), paragraph('y', 'Y'),
    ]);

    a.transact(() => {
      a.moveBlock('x', 2);
      a.applyPlacement('x', { parentId: 'C', afterId: 'c1' }, 'no-capture');
    }, 'local');
    b.transact(() => {
      b.moveBlock('y', 2);
      b.applyPlacement('y', { parentId: 'C', afterId: 'c1' }, 'no-capture');
    }, 'local');

    sync(a, b);
    expect(contentOf(a, 'C').slice().sort()).toEqual(['c1', 'x', 'y']);
    expect(contentOf(b, 'C')).toEqual(contentOf(a, 'C'));
    expect(idsOf(a)).toEqual(idsOf(b));
  });

  it('keeps every block when a drag lands where the peer pasted', () => {
    const { a, b } = twoPeers([paragraph('b1', 'one'), paragraph('b2', 'two'), paragraph('b3', 'three')]);

    a.transact(() => {
      a.moveBlock('b3', 1);
      a.applyPlacement('b3', { parentId: null, afterId: 'b1' }, 'no-capture');
    }, 'local');

    pasteBlock(b, paragraph('p1', 'P1'), 1);
    pasteBlock(b, paragraph('p2', 'P2'), 2);

    sync(a, b);
    expect(idsOf(a).slice().sort()).toEqual(['b1', 'b2', 'b3', 'p1', 'p2']);
    expect(idsOf(a)).toEqual(idsOf(b));
  });

  it('survives save and reload when two peers swap a container\'s children', () => {
    const { a, b } = twoPeers([
      toggle('C', ['c1', 'c2']), paragraph('c1', 'one', 'C'), paragraph('c2', 'two', 'C'),
      paragraph('z', 'Z'),
    ]);

    a.transact(() => {
      a.moveBlock('c1', 3);
      a.applyPlacement('c1', { parentId: null, afterId: 'z' }, 'no-capture');
    }, 'local');
    b.transact(() => {
      b.moveBlock('z', 2);
      b.applyPlacement('z', { parentId: 'C', afterId: 'c1' }, 'no-capture');
    }, 'local');

    sync(a, b);
    const fresh = createStore();

    fresh.fromJSON(a.toJSON());
    expect(idsOf(a).slice().sort()).toEqual(['C', 'c1', 'c2', 'z']);
    expect(idsOf(fresh).slice().sort()).toEqual(['C', 'c1', 'c2', 'z']);
    expect(idsOf(a)).toEqual(idsOf(b));
  });

  it('keeps both peers\' pasted block ids in one table cell', () => {
    const cell = (blocks: string[]): YjsOutputBlockData => ({
      id: 'T', type: 'table',
      data: { content: [[{ blocks }]] },
    });
    const { a, b } = twoPeers([cell(['s1'])]);

    a.updateBlockData('T', 'content', [[{ blocks: ['s1', 'a1', 'a2'] }]]);
    b.updateBlockData('T', 'content', [[{ blocks: ['s1', 'z1', 'z2'] }]]);

    sync(a, b);
    const content = (store: DocumentStore): unknown =>
      (store.toJSON().find((x) => x.id === 'T')?.data as { content?: unknown }).content;

    expect(JSON.stringify(content(a))).toContain('a1');
    expect(JSON.stringify(content(a))).toContain('z1');
  });

  it('keeps the pasted run contiguous when its anchor block is dragged away', () => {
    const { a, b } = twoPeers([paragraph('b1', 'one'), paragraph('b2', 'two'), paragraph('b3', 'three')]);

    // A pastes two blocks right after b2.
    pasteBlock(a, paragraph('p1', 'P1'), 2);
    pasteBlock(a, paragraph('p2', 'P2'), 3);

    // B drags b2 to the very top.
    b.transact(() => {
      b.moveBlock('b2', 0);
      b.applyPlacement('b2', { parentId: null, afterId: null }, 'no-capture');
    }, 'local');

    sync(a, b);
    expect(idsOf(a).slice().sort()).toEqual(['b1', 'b2', 'b3', 'p1', 'p2']);
    expect(idsOf(a)).toEqual(idsOf(b));
    const ids = idsOf(a);

    expect(ids.indexOf('p2')).toBe(ids.indexOf('p1') + 1);
  });

  it('keeps the dropped child inside the container the peer moved', () => {
    const { a, b } = twoPeers([
      toggle('C', []), paragraph('b2', 'dragged'), toggle('D', []),
    ]);

    a.transact(() => {
      a.moveBlock('b2', 1);
      a.applyPlacement('b2', { parentId: 'C', afterId: null }, 'no-capture');
    }, 'local');
    b.transact(() => {
      b.moveBlock('C', 2);
      b.applyPlacement('C', { parentId: 'D', afterId: null }, 'no-capture');
    }, 'local');

    sync(a, b);
    expect(idsOf(a).slice().sort()).toEqual(['C', 'D', 'b2']);
    expect(contentOf(a, 'C')).toEqual(['b2']);
    expect(idsOf(a)).toEqual(idsOf(b));
  });
});
