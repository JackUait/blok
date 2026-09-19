import { describe, it, expect } from 'vitest';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer, type YjsOutputBlockData } from '../../../../../src/components/modules/yjs/serializer';

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
 * @param text - the paragraph both peers start from
 */
const twoPeers = (text: string): { a: DocumentStore; b: DocumentStore } => {
  const a = new DocumentStore(new YBlockSerializer());
  const b = new DocumentStore(new YBlockSerializer());

  pinClientId(a, 1);
  pinClientId(b, 2);

  a.fromJSON([paragraph('b1', text)]);
  b.applyRemoteUpdate(a.encodeStateAsUpdate());

  return { a,
    b };
};

const textOf = (store: DocumentStore): string =>
  ((store.toJSON()[0]?.data as { text?: string } | undefined)?.text ?? '');

/** The paragraph both peers start from. Words, so a word-level diff has anchors. */
const BASE = `HEAD ${'xx '.repeat(15)}MID ${'yy '.repeat(15)}TAIL`;

/** The other peer, typing one character in the middle at the same instant. */
const TYPED = BASE.replace('MID ', 'MID! ');

/**
 * An edit at BOTH ends, so the change cannot be described by one region. The
 * character count decides the edit distance, which is what the Myers cap
 * measures.
 * @param left - characters inserted before the text
 * @param right - characters inserted after the text
 */
const bothEnds = (left: number, right: number): string =>
  `${'L'.repeat(left)} ${BASE} ${'R'.repeat(right)}`;

/**
 * Past the character-level cap the write used to answer with ONE region, and
 * one region that spans the whole paragraph takes a concurrent keystroke with
 * it: every character the keystroke sat between is deleted, so Yjs has nothing
 * left to anchor it to and it surfaces at the edge of the replaced span.
 *
 * The span is what has to get narrower, not the cap — raising the cap costs
 * O(N·D) and was measured at 35ms for a 20k-character rewrite at a cap of 512.
 */
describe('DocumentStore — a bulk edit past the cap keeps a peer\'s keystroke in place', () => {
  it('leaves the character where it was typed at an edit distance of 65', () => {
    const { a, b } = twoPeers(BASE);

    a.updateBlockData('b1', 'text', bothEnds(33, 33));
    b.updateBlockData('b1', 'text', TYPED);

    sync(a, b);

    expect(textOf(a)).toContain('MID! ');
    expect(textOf(a)).toBe(`${'L'.repeat(33)} ${TYPED} ${'R'.repeat(33)}`);
    expect(textOf(b)).toBe(textOf(a));
  });

  it('leaves it in place for a much larger two-ended edit', () => {
    const { a, b } = twoPeers(BASE);

    a.updateBlockData('b1', 'text', bothEnds(200, 200));
    b.updateBlockData('b1', 'text', TYPED);

    sync(a, b);

    expect(textOf(a)).toContain('MID! ');
    expect(textOf(a)).toBe(`${'L'.repeat(200)} ${TYPED} ${'R'.repeat(200)}`);
    expect(textOf(b)).toBe(textOf(a));
  });

  it('keeps a peer\'s word when the bulk edit rewrites the words around it', () => {
    const { a, b } = twoPeers(BASE);

    // Every word on BOTH sides of the peer's is rewritten, so trimming the
    // common ends cannot narrow this: 120 characters of edit distance, well
    // past the cap, but only 60 words of it.
    a.updateBlockData('b1', 'text', BASE.replace(/xx/gu, 'zz').replace(/yy/gu, 'ww'));
    b.updateBlockData('b1', 'text', TYPED);

    sync(a, b);

    expect(textOf(a)).toContain('MID! ');
    expect(textOf(a)).toBe(TYPED.replace(/xx/gu, 'zz').replace(/yy/gu, 'ww'));
    expect(textOf(b)).toBe(textOf(a));
  });

  it('does not split an emoji when the bulk edit runs past the cap', () => {
    const base = `HEAD 🙂 ${'ab '.repeat(40)}TAIL`;
    const { a, b } = twoPeers(base);

    a.updateBlockData('b1', 'text', `${'L'.repeat(40)} ${base} ${'R'.repeat(40)}`);

    sync(a, b);

    expect(textOf(a)).toContain('🙂');
    expect([...textOf(a)].filter((point) => point === '🙂')).toHaveLength(1);
    expect(textOf(a)).toBe(`${'L'.repeat(40)} ${base} ${'R'.repeat(40)}`);
  });

  it('still narrows nothing wider than the single region for text without word breaks', () => {
    // CJK has no spaces, so a word-level pass has no anchors to work with. The
    // replaced span must not grow beyond the one region lib0 would have given.
    const base = '你好世界'.repeat(40);
    const { a, b } = twoPeers(base);

    // Replace 100 characters in the middle: distance 200, past the cap. The
    // peer types well clear of that range, so trimming the common ends is what
    // decides whether the keystroke survives where it was put.
    const edited = base.slice(0, 20) + '改'.repeat(100) + base.slice(120);

    a.updateBlockData('b1', 'text', edited);
    b.updateBlockData('b1', 'text', `${base.slice(0, 150)}。${base.slice(150)}`);

    sync(a, b);

    expect(textOf(a)).toBe(`${edited.slice(0, 150)}。${edited.slice(150)}`);
    expect(textOf(b)).toBe(textOf(a));
  });
});
