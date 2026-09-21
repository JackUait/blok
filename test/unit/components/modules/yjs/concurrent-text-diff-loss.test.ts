import { describe, it, expect } from 'vitest';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer, type YjsOutputBlockData } from '../../../../../src/components/modules/yjs/serializer';

/**
 * `atomize` (src/components/modules/yjs/text-diff.ts) splits a block's text
 * into a whole tag, a whole entity, otherwise ONE CODE POINT. A user-visible
 * character is often several code points — a letter plus a combining accent,
 * an emoji plus a skin-tone modifier, a ZWJ family, a two-letter flag — and
 * the code-point atom lets the diff put an edit boundary INSIDE one of those.
 *
 * The merge then hands a peer's edit a cluster's continuation code point: the
 * accent moves onto the other person's character, a skin-tone modifier is left
 * orphaned, a family emoji comes apart, and two people each fixing one letter
 * of a flag land on a THIRD country's flag.
 *
 * Every case below is checked on two real Y.Text peers and asserted on the
 * converged text. Simulating a GRAPHEME atom instead — a whole-cluster replace
 * applied straight to the same two Y.Docs — produced the clean result in every
 * one of them, so the cluster damage is the atom unit, not a Yjs tie.
 */
const paragraph = (id: string, text: string): YjsOutputBlockData => ({
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
 * @param idA - the first peer's client id
 * @param idB - the second peer's client id
 */
const twoPeers = (text: string, idA = 1, idB = 2): { a: DocumentStore; b: DocumentStore } => {
  const a = new DocumentStore(new YBlockSerializer());
  const b = new DocumentStore(new YBlockSerializer());

  pinClientId(a, idA);
  pinClientId(b, idB);

  a.fromJSON([paragraph('b1', text)]);
  b.applyRemoteUpdate(a.encodeStateAsUpdate());

  return { a,
    b };
};

const textOf = (store: DocumentStore): string =>
  ((store.toJSON()[0]?.data as { text?: string } | undefined)?.text ?? '');

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** What the reader actually sees as characters. */
const graphemesOf = (text: string): string[] => [...segmenter.segment(text)].map((part) => part.segment);

const THUMB = '\u{1F44D}';
const TONE_MEDIUM = '\u{1F3FD}';
const TONE_DARK = '\u{1F3FF}';
const ZWJ = '‍';
const MAN = '\u{1F468}';
const WOMAN = '\u{1F469}';
const GIRL = '\u{1F467}';
const BOY = '\u{1F466}';
const ACUTE = '́';
const GRAVE = '̀';
const RI_U = '\u{1F1FA}';
const RI_S = '\u{1F1F8}';
const RI_A = '\u{1F1E6}';
const RI_G = '\u{1F1EC}';

/**
 * A cluster the other peer is COMPLETING lands at the same offset the typist's
 * character does, and Yjs breaks that tie by client id — so these three are a
 * coin flip per session. The ids are pinned to the losing order, which is half
 * of all real pairs.
 */
describe('a peer completing a character where the other peer types', () => {
  it.fails('keeps the accent on the letter it was typed for', () => {
    const { a, b } = twoPeers('cafe tail', 2, 1);

    // A dead key, an autocorrect or a Mac press-and-hold finishes "cafe" into
    // "café" — ONE combining code point appended to the "e". B types "!" at the
    // same offset. The accent is a free-standing atom, so it attaches to
    // whatever ends up in front of it: B's "!".
    a.updateBlockData('b1', 'text', `cafe${ACUTE} tail`);
    b.updateBlockData('b1', 'text', 'cafe! tail');

    sync(a, b);

    expect(graphemesOf(textOf(a))).not.toContain(`!${ACUTE}`);
    expect(textOf(a)).toContain(`e${ACUTE}`);
    expect(textOf(b)).toBe(textOf(a));
  });

  it.fails('keeps a skin tone on the hand it was chosen for', () => {
    const { a, b } = twoPeers(`a${THUMB}b`, 2, 1);

    // A picks a skin tone for the thumb already in the text — the picker
    // appends the modifier. B types "!" right after the thumb.
    a.updateBlockData('b1', 'text', `a${THUMB}${TONE_MEDIUM}b`);
    b.updateBlockData('b1', 'text', `a${THUMB}!b`);

    sync(a, b);

    // A lone modifier renders as a bare colour swatch next to the "!".
    expect(graphemesOf(textOf(a))).not.toContain(`!${TONE_MEDIUM}`);
    expect(textOf(a)).toContain(`${THUMB}${TONE_MEDIUM}`);
    expect(textOf(b)).toBe(textOf(a));
  });

  it.fails('does not let a typed character land inside a family emoji', () => {
    const { a, b } = twoPeers(`x ${MAN}${ZWJ}${WOMAN} y`, 2, 1);

    a.updateBlockData('b1', 'text', `x ${MAN}${ZWJ}${WOMAN}${ZWJ}${GIRL} y`);
    b.updateBlockData('b1', 'text', `x ${MAN}${ZWJ}${WOMAN}! y`);

    sync(a, b);

    // "!" plus the joiner becomes its own grapheme and the couple and the girl
    // render as separate people.
    expect(graphemesOf(textOf(a))).not.toContain(`!${ZWJ}`);
    expect(textOf(a)).toContain(`${MAN}${ZWJ}${WOMAN}${ZWJ}${GIRL}`);
    expect(textOf(b)).toBe(textOf(a));
  });
});

/**
 * These four do not depend on the client ids at all — both orders were
 * measured and produce the same damaged text, so they happen in every session.
 */
describe('a peer editing a cluster the other peer removes', () => {
  it.fails('does not strand a skin-tone modifier on the previous letter', () => {
    const { a, b } = twoPeers(`a${THUMB}${TONE_MEDIUM}b`, 1, 2);

    // A changes the tone — one code point replaced. B deletes the whole emoji.
    a.updateBlockData('b1', 'text', `a${THUMB}${TONE_DARK}b`);
    b.updateBlockData('b1', 'text', 'ab');

    sync(a, b);

    // The thumb is gone but the new modifier is not, so the paragraph reads
    // "a" wearing a colour swatch.
    expect(textOf(a)).not.toContain(TONE_DARK);
    expect(textOf(b)).toBe(textOf(a));
  });

  it.fails('does not leave a joiner and a lone child behind when a family is deleted', () => {
    const { a, b } = twoPeers(`x ${MAN}${ZWJ}${WOMAN}${ZWJ}${GIRL} y`, 1, 2);

    // A adds a boy to the family. B deletes the emoji.
    a.updateBlockData('b1', 'text', `x ${MAN}${ZWJ}${WOMAN}${ZWJ}${GIRL}${ZWJ}${BOY} y`);
    b.updateBlockData('b1', 'text', 'x  y');

    sync(a, b);

    // What survives is an invisible joiner glued to the space, then a child on
    // his own — a family neither person has in their document.
    expect(textOf(a)).not.toContain(` ${ZWJ}`);
    expect(textOf(b)).toBe(textOf(a));
  });

  it.fails('does not move an accent onto the letter before it', () => {
    const { a, b } = twoPeers(`cafe${ACUTE} x`, 1, 2);

    // A switches the accent. B deletes the accented letter.
    a.updateBlockData('b1', 'text', `cafe${GRAVE} x`);
    b.updateBlockData('b1', 'text', 'caf x');

    sync(a, b);

    // The accent outlives its letter and settles on the "f": "caf̀".
    expect(graphemesOf(textOf(a))).not.toContain(`f${GRAVE}`);
    expect(textOf(b)).toBe(textOf(a));
  });

  it.fails('never produces a flag neither person typed', () => {
    const { a, b } = twoPeers(`go ${RI_U}${RI_S} home`, 1, 2);

    // Two people fixing the same flag: A makes it Ukraine, B makes it South
    // Georgia. Each changes ONE regional indicator, so the merge keeps one
    // letter from each.
    a.updateBlockData('b1', 'text', `go ${RI_U}${RI_A} home`);
    b.updateBlockData('b1', 'text', `go ${RI_G}${RI_S} home`);

    sync(a, b);

    // The result is 🇬🇦 — Gabon. Same shape as the merged href that pointed at a
    // domain nobody typed.
    expect(textOf(a)).not.toContain(`${RI_G}${RI_A}`);
    expect(textOf(b)).toBe(textOf(a));
  });
});

/**
 * The single cases above are not anecdotes. This matrix walks every
 * cluster-completion against every typed character in both client-id orders —
 * 144 pairs, no randomness — and counts the ones where the merged text carries
 * a character NEITHER peer's own text has.
 */
describe('cluster completion versus a typed character, swept', () => {
  const GROWN: Array<[string, string]> = [
    ['cafe', `cafe${ACUTE}`],
    ['naive', 'naivë'],
    [THUMB, `${THUMB}${TONE_MEDIUM}`],
    [`${MAN}${ZWJ}${WOMAN}`, `${MAN}${ZWJ}${WOMAN}${ZWJ}${GIRL}`],
    [RI_U, `${RI_U}${RI_S}`],
    [WOMAN, `${WOMAN}${ZWJ}\u{1F4BB}`],
  ];
  const TYPED = ['!', 'X', ' ', '.'];
  const LEADS = ['prefix ', '', 'x '];
  /** Continuation code points: a grapheme carrying one is a cluster. */
  const CONTINUATION = /[‍\u{1F3FB}-\u{1F3FF}̀-ͯ\u{1F1E6}-\u{1F1FF}]/u;

  it.fails('never shows a character neither peer typed', () => {
    const damaged: Array<Record<string, string>> = [];

    GROWN.forEach(([word, grown]) => {
      TYPED.forEach((typed) => {
        [[1, 2], [2, 1]].forEach(([idA, idB]) => {
          LEADS.forEach((lead) => {
            const base = `${lead}${word} tail`;
            const wrote = `${lead}${grown} tail`;
            const typedText = `${lead}${word}${typed} tail`;
            const { a, b } = twoPeers(base, idA, idB);

            a.updateBlockData('b1', 'text', wrote);
            b.updateBlockData('b1', 'text', typedText);

            sync(a, b);

            const known = new Set([...graphemesOf(wrote), ...graphemesOf(typedText), ...graphemesOf(base)]);
            const strays = graphemesOf(textOf(a))
              .filter((grapheme) => CONTINUATION.test(grapheme) && !known.has(grapheme));

            if (strays.length > 0) {
              damaged.push({ wrote,
                typed: typedText,
                merged: textOf(a),
                strays: strays.join('') });
            }
          });
        });
      });
    });

    expect(damaged).toHaveLength(0);
  });
});
