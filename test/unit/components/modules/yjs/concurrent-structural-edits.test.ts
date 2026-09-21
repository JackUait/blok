import { describe, it, expect } from 'vitest';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer, type YjsOutputBlockData } from '../../../../../src/components/modules/yjs/serializer';

const createStore = (): DocumentStore => new DocumentStore(new YBlockSerializer());

const paragraph = (id: string, text: string, parent?: string): YjsOutputBlockData => ({
  id,
  type: 'paragraph',
  data: { text },
  ...(parent === undefined ? {} : { parent }),
});

/**
 * Exchange diffs computed against each peer's pre-exchange state vector, the
 * way the provider does. Both directions in one call: nothing is delivered
 * until both peers have already made their edit, which is what makes the edits
 * concurrent rather than sequential.
 */
const sync = (a: DocumentStore, b: DocumentStore): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

/**
 * Fix a store's Yjs client id, so a tie between two concurrent inserts at the
 * same position resolves the same way on every run.
 * @param store - the store to pin
 * @param clientId - the id to give it
 */
const pinClientId = (store: DocumentStore, clientId: number): void => {
  const doc = store.blocksMap.doc;

  if (doc === null) {
    throw new Error('DocumentStore has no Y.Doc');
  }

  doc.clientID = clientId;
};

/**
 * Two peers holding the same document.
 *
 * The client ids are pinned. When both peers insert at the SAME position, Yjs
 * breaks the tie by client id, and an unpinned id is random per run — so an
 * exact-text assertion about such a pair is a coin flip. Pinning makes the
 * tiebreak reproducible; it is not a promise that either order is "correct".
 * @param blocks - the document both peers start from
 */
const twoPeers = (blocks: YjsOutputBlockData[]): { a: DocumentStore; b: DocumentStore } => {
  const a = createStore();
  const b = createStore();

  pinClientId(a, 1);
  pinClientId(b, 2);

  a.fromJSON(blocks);
  b.applyRemoteUpdate(a.encodeStateAsUpdate());

  return { a,
    b };
};

/** The text of one block as a reader sees it. */
const textOf = (store: DocumentStore, id: string): string => {
  const block = store.toJSON().find((candidate) => candidate.id === id);

  return (block?.data as { text?: string } | undefined)?.text ?? '';
};

/** Every block's text, in document order — what a reader of the page sees. */
const documentText = (store: DocumentStore): string =>
  store.orderedIds().map((id) => textOf(store, id)).join('');

/** The parent a block ended up under, or null at the root. */
const parentOf = (store: DocumentStore, id: string): string | null => {
  const block = store.toJSON().find((candidate) => candidate.id === id);

  return (block as { parent?: string | null } | undefined)?.parent ?? null;
};

/**
 * Split and merge rewrite TWO blocks' text in one action, so they are the
 * operations most able to drop a peer's keystroke silently. Content
 * preservation is asserted FIRST in every case: two peers converging on the
 * same wrong text passes a convergence-only test, which is the usual way a
 * collaboration test lies.
 */
describe('DocumentStore — a structural edit concurrent with a peer\'s typing', () => {
  describe('split (Enter in the middle) while the peer types in that block', () => {
    it('keeps the character the peer appended at the end', () => {
      const { a, b } = twoPeers([paragraph('b1', 'Hello world')]);

      // A splits after "Hello ": the head shrinks, the tail becomes a new block.
      a.updateBlockData('b1', 'text', 'Hello ');
      a.addBlock(paragraph('b2', 'world'), 1);
      // B, at the same instant, types "!" at the end of the untouched block.
      b.updateBlockData('b1', 'text', 'Hello world!');

      sync(a, b);

      expect(documentText(a)).toContain('!');
      expect(documentText(a)).toContain('Hello ');
      expect(documentText(a)).toContain('world');
      // Measured placement: the "!" was typed inside the run A moved away, so
      // it stays with the head block rather than following the tail.
      expect(textOf(a, 'b1')).toBe('Hello !');
      expect(textOf(a, 'b2')).toBe('world');
      expect(textOf(b, 'b1')).toBe(textOf(a, 'b1'));
      expect(textOf(b, 'b2')).toBe(textOf(a, 'b2'));
    });

    it('keeps a character the peer typed INSIDE the run the split moves away', () => {
      const { a, b } = twoPeers([paragraph('b1', 'Hello world')]);

      a.updateBlockData('b1', 'text', 'Hello ');
      a.addBlock(paragraph('b2', 'world'), 1);
      // B types "B" between "wo" and "rld" — inside the tail A is moving.
      b.updateBlockData('b1', 'text', 'Hello woBrld');

      sync(a, b);

      expect(documentText(a)).toContain('B');
      expect(textOf(a, 'b1')).toBe('Hello B');
      expect(textOf(a, 'b2')).toBe('world');
      expect(documentText(b)).toBe(documentText(a));
    });

    it('gives both peers the same two blocks in the same order', () => {
      const { a, b } = twoPeers([paragraph('b1', 'Hello world')]);

      a.updateBlockData('b1', 'text', 'Hello ');
      a.addBlock(paragraph('b2', 'world'), 1);
      b.updateBlockData('b1', 'text', 'Hello world!');

      sync(a, b);

      expect(a.orderedIds()).toEqual(['b1', 'b2']);
      expect(b.orderedIds()).toEqual(a.orderedIds());
    });
  });

  describe('merge (Backspace at block start) while the peer types', () => {
    it('keeps the peer\'s typing when they type in the SURVIVING block', () => {
      const { a, b } = twoPeers([paragraph('b1', 'Hello '), paragraph('b2', 'world')]);

      // A merges b2 into b1: b1 takes both texts, b2 is removed.
      a.updateBlockData('b1', 'text', 'Hello world');
      a.removeBlock('b2');
      // B types "X" at the end of b1 at the same instant.
      b.updateBlockData('b1', 'text', 'Hello X');

      sync(a, b);

      expect(textOf(a, 'b1')).toContain('X');
      expect(textOf(a, 'b1')).toContain('world');
      // Both bursts land at the same offset; which one sits first is the
      // client-id tiebreak the helper pins, not a guarantee.
      expect(textOf(a, 'b1')).toBe('Hello worldX');
      expect(textOf(b, 'b1')).toBe(textOf(a, 'b1'));
      expect(a.orderedIds()).toEqual(['b1']);
    });

    it('LOSES the peer\'s typing when they type in the block the merge removes', () => {
      const { a, b } = twoPeers([paragraph('b1', 'Hello '), paragraph('b2', 'world')]);

      a.updateBlockData('b1', 'text', 'Hello world');
      a.removeBlock('b2');
      // B types "ZZ" into b2 — the block A is about to delete.
      b.updateBlockData('b2', 'text', 'worldZZ');

      sync(a, b);

      // Measured, not desired: a removed block takes its concurrent edits with
      // it. This is delete-wins, the same rule every Yjs map delete follows —
      // the text merge cannot save a container that no longer exists. Recorded
      // so a future change to merge (moving the tail's Y.Text instead of
      // copying it) has a statement of today's loss to change.
      expect(documentText(a)).not.toContain('ZZ');
      expect(a.orderedIds()).toEqual(['b1']);
      expect(textOf(a, 'b1')).toBe('Hello world');
      expect(documentText(b)).toBe(documentText(a));
      expect(b.orderedIds()).toEqual(a.orderedIds());
    });
  });

  describe('a paste past the diff cap while the peer types in the same block', () => {
    it('keeps every character both peers produced', () => {
      const base = 'The quick brown fox jumps over the lazy dog. ';
      const { a, b } = twoPeers([paragraph('b1', base)]);
      // 100 characters replacing 4: edit distance 104, well past
      // MAX_DIFF_DISTANCE, so this write takes the single-region fallback.
      const pasted = 'Z'.repeat(100);

      a.updateBlockData('b1', 'text', base.slice(0, 20) + pasted + base.slice(24));
      b.updateBlockData('b1', 'text', base.slice(0, 22) + 'BBB' + base.slice(22));

      sync(a, b);

      expect(textOf(a, 'b1')).toContain('BBB');
      expect(textOf(a, 'b1')).toContain(pasted);
      // The typed run survives, but at the END of the replaced range rather
      // than where it was typed — the fallback deletes the whole range in one
      // op, so there is no surviving neighbour to anchor it to, and the
      // replacement is anchored to the range's LEFT edge. The other anchoring
      // put the stray run in FRONT of everything pasted, which on a paste over
      // a whole block made it the first character of the block.
      expect(textOf(a, 'b1')).toBe(`${base.slice(0, 20)}${pasted}BBB${base.slice(24)}`);
      expect(textOf(b, 'b1')).toBe(textOf(a, 'b1'));
    });
  });

  describe('both peers delete the same block', () => {
    it('removes it once and leaves the siblings alone', () => {
      const { a, b } = twoPeers([
        paragraph('b1', 'one'),
        paragraph('b2', 'two'),
        paragraph('b3', 'three'),
      ]);

      a.removeBlock('b2');
      b.removeBlock('b2');

      sync(a, b);

      expect(a.orderedIds()).toEqual(['b1', 'b3']);
      expect(documentText(a)).toBe('onethree');
      expect(b.orderedIds()).toEqual(a.orderedIds());
      expect(documentText(b)).toBe(documentText(a));
    });

    it('survives one peer deleting while the other deletes AND types in a sibling', () => {
      const { a, b } = twoPeers([
        paragraph('b1', 'one'),
        paragraph('b2', 'two'),
        paragraph('b3', 'three'),
      ]);

      a.removeBlock('b2');
      b.removeBlock('b2');
      b.updateBlockData('b3', 'text', 'three!');

      sync(a, b);

      expect(textOf(a, 'b3')).toBe('three!');
      expect(a.orderedIds()).toEqual(['b1', 'b3']);
      expect(b.orderedIds()).toEqual(a.orderedIds());
      expect(textOf(b, 'b3')).toBe(textOf(a, 'b3'));
    });
  });

  describe('indent by one peer against outdent by the other', () => {
    it('leaves the block in exactly one place, under one parent', () => {
      const { a, b } = twoPeers([
        paragraph('b1', 'one'),
        paragraph('b2', 'two', 'b1'),
        paragraph('b3', 'three', 'b1'),
      ]);

      // A indents b3 under its preceding sibling; B outdents it to the root.
      a.applyPlacement('b3', { parentId: 'b2',
        afterId: null }, 'local');
      b.applyPlacement('b3', { parentId: null,
        afterId: 'b1' }, 'local');

      sync(a, b);

      // The block must not be duplicated or dropped by the competing moves.
      expect(a.orderedIds().filter((id) => id === 'b3')).toHaveLength(1);
      expect(b.orderedIds().filter((id) => id === 'b3')).toHaveLength(1);
      expect(documentText(a)).toContain('three');
      // One winner, and both peers agree which.
      expect(parentOf(b, 'b3')).toBe(parentOf(a, 'b3'));
      expect(a.orderedIds()).toEqual(b.orderedIds());
      expect(a.orderedIds()).toEqual(['b1', 'b2', 'b3']);
    });

    it('keeps text typed into the block while it is being reparented', () => {
      const { a, b } = twoPeers([
        paragraph('b1', 'one'),
        paragraph('b2', 'two', 'b1'),
        paragraph('b3', 'three', 'b1'),
      ]);

      a.applyPlacement('b3', { parentId: 'b2',
        afterId: null }, 'local');
      b.updateBlockData('b3', 'text', 'three more');

      sync(a, b);

      expect(textOf(a, 'b3')).toBe('three more');
      expect(textOf(b, 'b3')).toBe('three more');
      expect(a.orderedIds()).toEqual(b.orderedIds());
    });
  });
});
