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

/** The paragraph both regimes are measured against. */
const BASE = `HEAD ${'x'.repeat(30)} MID ${'y'.repeat(30)} TAIL`;

/**
 * One peer's edit, in two separate places, of `left + right` inserted
 * characters — so its edit distance is exactly `left + right` and can be
 * dialled either side of the cap. Two places, because a single contiguous
 * change is described identically by the minimal diff and by the fallback,
 * and would not tell the regimes apart.
 * @param left - characters inserted before the text
 * @param right - characters inserted after the text
 */
const bulkEdit = (left: number, right: number): string =>
  `${'L'.repeat(left)}${BASE}${'R'.repeat(right)}`;

/** The other peer, typing one character in the middle at the same instant. */
const TYPED = BASE.replace(' MID ', ' MID! ');

/**
 * `MAX_DIFF_DISTANCE` caps the Myers search at an edit distance of 64. Past
 * it the write falls back to lib0's `simpleDiffString`, which answers with ONE
 * region — and the two regimes do NOT merge the same way. Nothing in the suite
 * reached the cap before this file: every text test used short strings, so the
 * fallback branch was dark.
 */
describe('DocumentStore — the text diff cap, on both sides of it', () => {
  describe('under and at the cap: the minimal diff merges precisely', () => {
    it('keeps the peer\'s character where it was typed at distance 63', () => {
      const { a, b } = twoPeers(BASE);

      a.updateBlockData('b1', 'text', bulkEdit(31, 32));
      b.updateBlockData('b1', 'text', TYPED);

      sync(a, b);

      expect(textOf(a)).toContain(' MID! ');
      expect(textOf(a)).toBe(`${'L'.repeat(31)}${TYPED}${'R'.repeat(32)}`);
      expect(textOf(b)).toBe(textOf(a));
    });

    it('keeps it in place at exactly the cap, distance 64', () => {
      const { a, b } = twoPeers(BASE);

      a.updateBlockData('b1', 'text', bulkEdit(32, 32));
      b.updateBlockData('b1', 'text', TYPED);

      sync(a, b);

      expect(textOf(a)).toContain(' MID! ');
      expect(textOf(a)).toBe(`${'L'.repeat(32)}${TYPED}${'R'.repeat(32)}`);
      expect(textOf(b)).toBe(textOf(a));
    });
  });

  describe('past the cap: the single-region fallback MOVES the peer\'s typing', () => {
    it('relocates the character to the start of the paragraph at distance 65', () => {
      const { a, b } = twoPeers(BASE);

      a.updateBlockData('b1', 'text', bulkEdit(32, 33));
      b.updateBlockData('b1', 'text', TYPED);

      sync(a, b);

      // ONE more unit of edit distance than the test above, and the character
      // the user typed after "MID" is now at the very start of the block.
      // Measured, and asserted as the real behaviour rather than the wanted
      // one: the fallback deletes the whole paragraph in one op and re-inserts
      // it, so the typed character has no surviving neighbour to sit next to.
      expect(textOf(a)).not.toContain(' MID! ');
      expect(textOf(a).startsWith('!')).toBe(true);
      expect(textOf(a)).toBe(`!${bulkEdit(32, 33)}`);
      expect(textOf(b)).toBe(textOf(a));
    });

    it('still loses no character — the count is preserved, only the place is wrong', () => {
      const { a, b } = twoPeers(BASE);

      a.updateBlockData('b1', 'text', bulkEdit(33, 33));
      b.updateBlockData('b1', 'text', TYPED);

      sync(a, b);

      expect(textOf(a)).toHaveLength(bulkEdit(33, 33).length + 1);
      expect(textOf(a).split('!')).toHaveLength(2);
      expect(textOf(b)).toBe(textOf(a));
    });
  });

  describe('two peers replacing OVERLAPPING ranges, both past the cap', () => {
    it('keeps both replacements whole and deletes the shared original range once', () => {
      const base = 'abcdefghij'.repeat(15);
      const { a, b } = twoPeers(base);

      // Each replaces 70 characters: distance 140, both on the fallback.
      // The ranges overlap between offsets 60 and 90.
      a.updateBlockData('b1', 'text', base.slice(0, 20) + 'X'.repeat(70) + base.slice(90));
      b.updateBlockData('b1', 'text', base.slice(0, 60) + 'Y'.repeat(70) + base.slice(130));

      sync(a, b);

      // Neither run is duplicated and neither is truncated: the overlapping
      // deletes are idempotent, and both inserts survive whole.
      expect(textOf(a).match(/X/gu) ?? []).toHaveLength(70);
      expect(textOf(a).match(/Y/gu) ?? []).toHaveLength(70);
      expect(textOf(a)).toBe(`${base.slice(0, 20)}${'X'.repeat(70)}${'Y'.repeat(70)}${base.slice(130)}`);
      expect(textOf(b)).toBe(textOf(a));
    });
  });
});
