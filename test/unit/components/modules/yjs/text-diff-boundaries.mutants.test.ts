import { describe, it, expect } from 'vitest';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer, type YjsOutputBlockData } from '../../../../../src/components/modules/yjs/serializer';

const createStore = (): DocumentStore => new DocumentStore(new YBlockSerializer());

const paragraph = (id: string, text: string): YjsOutputBlockData => ({
  id,
  type: 'paragraph',
  data: { text },
});

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
 * Two peers holding the same one-paragraph document.
 *
 * The client ids are pinned: when both peers insert at the SAME position Yjs
 * breaks the tie by client id, and an unpinned id is random per run.
 * @param text - the paragraph both peers start from
 */
const twoPeers = (text: string): { a: DocumentStore; b: DocumentStore } => {
  const a = createStore();
  const b = createStore();

  pinClientId(a, 1);
  pinClientId(b, 2);

  a.fromJSON([paragraph('b1', text)]);
  b.applyRemoteUpdate(a.encodeStateAsUpdate());

  return { a,
    b };
};

const textOf = (store: DocumentStore): string =>
  ((store.toJSON()[0]?.data as { text?: string } | undefined)?.text ?? '');

const GRIN = '\u{1F600}';

/**
 * Index arithmetic inside the text diff: an off-by-one here does not throw,
 * it writes the wrong characters into a document and syncs them to everyone.
 * Each test below states the defect it exists for FIRST, so an unrelated
 * earlier assertion cannot pass for it.
 */
describe('DocumentStore — index arithmetic in the text diff', () => {
  describe('code points vs code units: an emoji BEFORE the edit', () => {
    it('inserts after the right character when an emoji precedes the edit point', () => {
      const store = createStore();

      store.fromJSON([paragraph('b1', `${GRIN}abc`)]);

      // The edit is at code point 3, which is code UNIT 5 because the emoji
      // is two units wide. Getting that mapping wrong lands the character
      // inside the emoji's neighbourhood instead, and nothing throws.
      store.updateBlockData('b1', 'text', `${GRIN}abXc`);

      expect(textOf(store)).toBe(`${GRIN}abXc`);
      expect([...textOf(store)]).toHaveLength(5);
    });

    it('removes the right character when an emoji precedes the removal', () => {
      const store = createStore();

      store.fromJSON([paragraph('b1', `${GRIN}abcdef`)]);

      store.updateBlockData('b1', 'text', `${GRIN}abdef`);

      expect(textOf(store)).toBe(`${GRIN}abdef`);
      expect(textOf(store).startsWith(GRIN)).toBe(true);
    });

    it('removes a whole emoji, not one half of it', () => {
      const store = createStore();

      store.fromJSON([paragraph('b1', `a${GRIN}b${GRIN}c`)]);

      // The removed run is TWO code units wide but ONE code point. Counting
      // the removal in code points leaves a lone surrogate behind, which is a
      // broken character for every reader of the document.
      store.updateBlockData('b1', 'text', `a${GRIN}bc`);

      expect(textOf(store)).toBe(`a${GRIN}bc`);
      expect([...textOf(store)]).toHaveLength(4);
    });

    it('keeps both peers\' edits around an emoji that sits between them', () => {
      const { a, b } = twoPeers(`a${GRIN}b${GRIN}c`);

      // A types between the two emoji, B appends after the second one.
      a.updateBlockData('b1', 'text', `a${GRIN}bZ${GRIN}c`);
      b.updateBlockData('b1', 'text', `a${GRIN}b${GRIN}c!`);

      sync(a, b);

      expect(textOf(a)).toBe(`a${GRIN}bZ${GRIN}c!`);
      // Both emoji are still whole: a split surrogate pair would still be two
      // code units, so count code POINTS.
      expect([...textOf(a)]).toHaveLength(7);
      expect(textOf(b)).toBe(textOf(a));
    });
  });

  describe('edits are applied right to left', () => {
    it('does not shift the later edit by the length of the earlier one', () => {
      const store = createStore();

      store.fromJSON([paragraph('b1', 'ab')]);

      // Two separate inserts, the first three characters long. Applied left to
      // right, the second one lands three characters too early.
      store.updateBlockData('b1', 'text', 'XXXaYb');

      expect(textOf(store)).toBe('XXXaYb');
    });

    it('applies three inserts of different lengths to the right places', () => {
      const store = createStore();

      store.fromJSON([paragraph('b1', 'one two three')]);

      store.updateBlockData('b1', 'text', '(((one ((two (three');

      expect(textOf(store)).toBe('(((one ((two (three');
    });
  });

  describe('the Myers search reaches the end of both texts', () => {
    it('merges a markup wrap with a peer\'s typing instead of replacing the block', () => {
      const { a, b } = twoPeers('The quick brown fox');

      a.updateBlockData('b1', 'text', 'The <b>quick</b> brown fox');
      b.updateBlockData('b1', 'text', 'The quick brown fox jumps');

      sync(a, b);

      // A search that never reports "done" falls through to the single-region
      // fallback, which rewrites the whole string and drops one of the two
      // intents. Both must be here.
      expect(textOf(a)).toBe('The <b>quick</b> brown fox jumps');
      expect(textOf(b)).toBe(textOf(a));
    });

    it('merges a deleted word with a peer\'s typing at the other end', () => {
      const { a, b } = twoPeers('one two three four five');

      a.updateBlockData('b1', 'text', 'one three four five');
      b.updateBlockData('b1', 'text', 'one two three four five!');

      sync(a, b);

      expect(textOf(a)).toBe('one three four five!');
      expect(textOf(b)).toBe(textOf(a));
    });

    it('merges an edit at the very first character with one at the very last', () => {
      const { a, b } = twoPeers('abcdef');

      a.updateBlockData('b1', 'text', 'Zabcdef');
      b.updateBlockData('b1', 'text', 'abcdefZ');

      sync(a, b);

      expect(textOf(a)).toBe('ZabcdefZ');
      expect(textOf(b)).toBe(textOf(a));
    });
  });
});
