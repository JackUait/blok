import { simpleDiffString } from 'lib0/diff';

/**
 * How far the minimal diff searches before giving up. Myers costs O(N·D) in the
 * edit distance: typing is D of about 1 and wrapping a range in tags is D of
 * about 2 — a complete tag is ONE unit here — so the cap never bites a real
 * edit, while a whole-string replacement — a paste over a selection, a tool
 * normalising its own markup — has a D the size of the text and costs seconds
 * at a few thousand characters. Past the cap `diffText` splits both texts at
 * runs of atoms that occur exactly once in each, and answers every gap between
 * two of those anchors on its own — the words of that gap, and only then its
 * single region, which is what the write did before any of this existed.
 *
 * The number is not a free dial: measured on a 20k-character whole-string
 * rewrite, a cap of 512 costs 25-70ms and 1024 costs 80-100ms, against under
 * 2ms here. Widen the UNITS, not the cap.
 */
const MAX_DIFF_DISTANCE = 64;

/** One edit turning the stored text into the saved text. */
export interface TextEditOp {
  index: number;
  remove: number;
  insert: string;
}

/** `<` */
const LT = 0x3c;
/** `>` */
const GT = 0x3e;
/** `/` */
const SLASH = 0x2f;
/** `&` */
const AMP = 0x26;
/** `;` */
const SEMICOLON = 0x3b;
/** `#` */
const HASH = 0x23;
/** `"` */
const DOUBLE_QUOTE = 0x22;
/** `'` */
const SINGLE_QUOTE = 0x27;

/**
 * Longest an entity reference may be before the scanner gives up and treats the
 * `&` as ordinary text. `&CounterClockwiseContourIntegral;` is the longest named
 * reference HTML defines, at 31 characters plus the ampersand.
 */
const MAX_ENTITY_LENGTH = 32;

/**
 * The quote character a tag scanner is inside of after reading `code`, or 0
 * when it is not inside one.
 * @param code - the character just read
 * @param quote - the quote the scanner was inside of, or 0
 */
const nextQuote = (code: number, quote: number): number => {
  if (quote !== 0) {
    return code === quote ? 0 : quote;
  }

  return code === DOUBLE_QUOTE || code === SINGLE_QUOTE ? code : 0;
};

/**
 * Where the tag that starts at `start` ends, or `start` when the text does not
 * carry a complete tag there.
 *
 * Quoted attribute values are scanned through, because serializing an element
 * does NOT escape `>` inside an attribute value — `<a title="a>b">` is a single
 * tag and splitting it at the first `>` would hand half of it to the diff.
 * @param text - the string being scanned
 * @param start - index of the `<`
 */
const tagEnd = (text: string, start: number): number => {
  /* eslint-disable no-restricted-syntax -- a character scanner: the index and
     the quote state both advance inside the loop. */
  let index = start + 1;

  if (text.charCodeAt(index) === SLASH) {
    index += 1;
  }

  const nameStart = text.charCodeAt(index);
  const isName = (nameStart >= 0x41 && nameStart <= 0x5a) || (nameStart >= 0x61 && nameStart <= 0x7a);

  // `<` followed by anything but a tag name is a literal character the user
  // typed, and must stay one — an atom per code point, exactly as before.
  if (!isName) {
    return start;
  }

  let quote = 0;

  while (index < text.length) {
    const code = text.charCodeAt(index);
    const wasQuoted = quote !== 0;

    quote = nextQuote(code, quote);

    if (!wasQuoted && quote === 0 && code === GT) {
      return index + 1;
    }

    // A second `<` before any `>`: the first one was literal text.
    if (!wasQuoted && quote === 0 && code === LT) {
      return start;
    }

    index += 1;
  }
  /* eslint-enable no-restricted-syntax */

  // Unclosed — a half-typed tag, or text that merely contains a `<`.
  return start;
};

/**
 * Where the entity reference that starts at `start` ends, or `start` when there
 * is no complete one there.
 * @param text - the string being scanned
 * @param start - index of the `&`
 */
const entityEnd = (text: string, start: number): number => {
  // eslint-disable-next-line no-restricted-syntax -- character scanner
  let index = start + 1;

  if (text.charCodeAt(index) === HASH) {
    index += 1;
  }

  const limit = Math.min(text.length, start + MAX_ENTITY_LENGTH);

  for (; index < limit; index += 1) {
    const code = text.charCodeAt(index);

    if (code === SEMICOLON) {
      // `&;` is not a reference.
      return index > start + 1 ? index + 1 : start;
    }

    const alphanumeric = (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a);

    if (!alphanumeric) {
      return start;
    }
  }

  return start;
};

/**
 * Where the structure starting at `start` ends — a tag, an entity — or `start`
 * when nothing structured starts there.
 * @param text - the string being scanned
 * @param start - index to read from
 * @param code - the character at `start`
 */
const structuredEnd = (text: string, start: number, code: number): number => {
  if (code === LT) {
    return tagEnd(text, start);
  }

  if (code === AMP) {
    return entityEnd(text, start);
  }

  return start;
};

/**
 * The units the diff may put an edit boundary between: a COMPLETE tag, a
 * complete entity reference, otherwise one code point.
 *
 * This is what stops the merge treating markup as spellable text. A block's
 * `text` is the tool's `innerHTML` — markup and content in one string with no
 * boundary — and Myers is minimal, so over code points it happily expresses
 * "bold this word" as "insert `<`, REUSE the word's own `b`, insert `>`…".
 * The tag then owns a letter of the word, and the peer fixing that letter is
 * editing the inside of the tag: measured, that produced visible `<>b` rubbish,
 * an `<mak>` nobody can render, and an `href` pointing at a domain neither
 * person typed. Whole tags cannot be half-edited and never share a character
 * with content.
 *
 * Code points, never code units: an edit boundary inside a surrogate pair puts
 * the halves in separate CRDT items and Yjs replaces both with U+FFFD — 43% of
 * emoji edits corrupted, measured.
 * @param text - the string to split
 */
export const atomize = (text: string): string[] => {
  // Nothing structured to protect: the native iterator splits code points in
  // one pass, where the scanner below costs 0.45ms more per 20k characters —
  // measured, and this runs on every keystroke.
  if (!text.includes('<') && !text.includes('&')) {
    return [...text];
  }

  const atoms: string[] = [];
  /* eslint-disable-next-line no-restricted-syntax -- character scanner */
  let index = 0;

  while (index < text.length) {
    const code = text.charCodeAt(index);
    const structured = structuredEnd(text, index, code);

    if (structured > index) {
      atoms.push(text.slice(index, structured));
      index = structured;

      continue;
    }

    const low = code >= 0xd800 && code <= 0xdbff ? text.charCodeAt(index + 1) : 0;
    const size = low >= 0xdc00 && low <= 0xdfff ? 2 : 1;

    atoms.push(text.slice(index, index + size));
    index += size;
  }

  return atoms;
};

/**
 * Walk a Myers trace back into edits, oldest first.
 * @param trace - V snapshots, one per search depth
 * @param before - the stored text, split into atoms
 * @param after - the saved text, split into atoms
 * @param depth - the depth the search ended at
 */
const backtrackMyers = (
  trace: Array<Map<number, number>>,
  before: string[],
  after: string[],
  depth: number
): TextEditOp[] => {
  const ops: TextEditOp[] = [];
  /* eslint-disable no-restricted-syntax -- the trace is walked backwards; both
     coordinates move on every step, which is the shape of the algorithm. */
  let x = before.length;
  let y = after.length;

  for (let step = depth; step > 0; step -= 1) {
    const previous = trace[step];
    const k = x - y;
    const down = k === -step || (k !== step && (previous.get(k - 1) ?? 0) < (previous.get(k + 1) ?? 0));
    const previousK = down ? k + 1 : k - 1;
    const previousX = previous.get(previousK) ?? 0;
    const previousY = previousX - previousK;

    ops.push(down
      ? { index: previousX,
        remove: 0,
        insert: after[previousY] }
      : { index: previousX,
        remove: 1,
        insert: '' });

    x = previousX;
    y = previousY;
  }
  /* eslint-enable no-restricted-syntax */

  ops.reverse();

  // Fuse neighbours so a typed word is one insert, not one per character, and
  // so a delete with an insert against its end is ONE replacement. The pair
  // matters: applied separately the new text is anchored to the RIGHT of the
  // run it replaces, so a peer's concurrent keystroke inside that run — whose
  // own anchor is a character now tombstoned — surfaces BEFORE all of it, and
  // the block reads "!Completely different…". Measured.
  return ops.reduce<TextEditOp[]>((fused, op) => {
    const last = fused[fused.length - 1];
    const abuts = last !== undefined && last.index + last.remove === op.index;

    if (abuts && last.insert === '' && op.remove === 0) {
      last.insert = op.insert;

      return fused;
    }

    if (abuts && last.remove === 0 && op.insert === '') {
      last.remove = op.remove;

      return fused;
    }

    if (abuts && (last.insert === '') === (op.insert === '')) {
      last.remove += op.remove;
      last.insert += op.insert;

      return fused;
    }

    fused.push({ ...op });

    return fused;
  }, []);
};

/**
 * How far a Myers step can run along the diagonal: the two texts agree
 * atom for atom from (x, y) until they do not.
 * @param before - the stored text, split into atoms
 * @param after - the saved text, split into atoms
 * @param fromX - index into `before` to start at
 * @param fromY - index into `after` to start at
 */
const slideDiagonal = (before: string[], after: string[], fromX: number, fromY: number): number => {
  const reach = Math.min(before.length - fromX, after.length - fromY);
  // eslint-disable-next-line no-restricted-syntax -- scan index, advanced in the loop below
  let matched = 0;

  while (matched < reach && before[fromX + matched] === after[fromY + matched]) {
    matched += 1;
  }

  return fromX + matched;
};

/**
 * One step of the search: extend every diagonal reachable at `depth`, recording
 * how far each one got. True once a path has consumed both texts.
 * @param before - the stored text, split into atoms
 * @param after - the saved text, split into atoms
 * @param v - furthest x reached per diagonal, updated in place
 * @param depth - the edit distance being tried
 */
const reachesEnd = (before: string[], after: string[], v: Map<number, number>, depth: number): boolean => {
  /* eslint-disable-next-line no-restricted-syntax -- walks the diagonals */
  for (let k = -depth; k <= depth; k += 2) {
    const down = k === -depth || (k !== depth && (v.get(k - 1) ?? 0) < (v.get(k + 1) ?? 0));
    const start = down ? (v.get(k + 1) ?? 0) : (v.get(k - 1) ?? 0) + 1;
    const x = slideDiagonal(before, after, start, start - k);

    v.set(k, x);

    if (x >= before.length && x - k >= after.length) {
      return true;
    }
  }

  return false;
};

/**
 * Re-express edits counted in atoms as the code-unit offsets `Y.Text` indexes
 * by.
 * @param ops - edits whose index and remove count atoms
 * @param beforeAtoms - the stored text, split into atoms
 */
const toUnitOps = (ops: TextEditOp[], beforeAtoms: string[]): TextEditOp[] => {
  const unitAt = unitOffsets(beforeAtoms);

  return ops.map((op) => ({
    index: unitAt[op.index],
    remove: unitAt[op.index + op.remove] - unitAt[op.index],
    insert: op.insert,
  }));
};

/**
 * Myers over a sequence, bounded by `MAX_DIFF_DISTANCE`. Null when the two
 * sequences are further apart than the cap allows the search to look.
 * @param before - the stored text, split into the units being diffed
 * @param after - the saved text, split the same way
 */
const myersOps = (before: string[], after: string[]): TextEditOp[] | null => {
  const limit = Math.min(before.length + after.length, MAX_DIFF_DISTANCE);
  const v = new Map<number, number>([[1, 0]]);
  const trace: Array<Map<number, number>> = [];

  /* eslint-disable-next-line no-restricted-syntax -- counts the search depth */
  for (let depth = 0; depth <= limit; depth += 1) {
    trace.push(new Map(v));

    if (reachesEnd(before, after, v, depth)) {
      return toUnitOps(backtrackMyers(trace, before, after, depth), before);
    }
  }

  return null;
};

/**
 * Whitespace runs and non-whitespace runs, in order, concatenating back to
 * `text`. A word is one element, so a bulk edit that rewrites words has an
 * edit distance the size of the words it touched rather than the characters.
 * @param text - the string to split
 */
const tokenize = (text: string): string[] => text.match(/\s+|\S+/gu) ?? [];

/**
 * Where each atom starts, in the code-unit offsets `Y.Text` indexes by, with
 * one extra entry for the end of the string.
 *
 * Pushes into the accumulator: spreading it instead made the prefix sum
 * O(N squared), which is 2 SECONDS of blocked main thread for one keystroke
 * in a 20k-character block — measured.
 * @param atoms - the text, split into atoms
 */
const unitOffsets = (atoms: string[]): number[] => atoms.reduce<number[]>((offsets, atom) => {
  offsets.push(offsets[offsets.length - 1] + atom.length);

  return offsets;
}, [0]);

/**
 * The coarse answer for one span: Myers over its WORDS, and the single region
 * when even that is further than the cap allows.
 *
 * What the single-region answer costs is not characters — the length stays
 * exact — it is POSITION: the one region deletes every character a concurrent
 * keystroke sat between, so Yjs has no surviving neighbour to anchor it to and
 * it surfaces at the edge of the span. Measured with two peers: a two-ended
 * edit of distance 65 moved the other peer's character to index 0 of the block.
 * @param before - the stored span
 * @param after - the saved span
 */
const coarseOps = (before: string, after: string): TextEditOp[] => {
  // Code units, and surrogate-safe: lib0 rolls its own ends back off a
  // surrogate boundary, so the region never starts or ends inside a character.
  const { index, remove, insert } = simpleDiffString(before, after);

  if (remove === 0 && insert === '') {
    return [];
  }

  const wordOps = myersOps(tokenize(before.slice(index, index + remove)), tokenize(insert));

  return wordOps === null
    ? [{ index,
      remove,
      insert }]
    : wordOps.map((op) => ({ ...op,
      index: op.index + index }));
};

/**
 * How many atoms an anchor is measured over. A single atom is almost never
 * unique — every `e` in the paragraph is the same atom — so anchoring on one
 * finds nothing in ordinary prose. Three consecutive atoms is the shortest run
 * that is unique in everyday text: measured, `rd0` (the tail of `word0`) and
 * `重点0` each occur once in their paragraph, where `d0` and `点0` do not.
 */
const ANCHOR_ATOMS = 3;

/**
 * Runs of `ANCHOR_ATOMS` atoms that occur exactly once, keyed by a hash of the
 * run and valued with the atom index it starts at. A repeated run maps to -1,
 * so a lookup answers "unique, and here" in one step.
 *
 * Hashes, not the runs themselves: slicing a key string per position cost 25ms
 * on a 20k-character rewrite — measured — against under 4ms here. A hash can
 * collide, so `anchors` re-reads the two runs and compares them before trusting
 * a pair.
 * @param text - the text being split
 * @param unitAt - where each atom starts, in code units
 */
const singleOccurrences = (text: string, unitAt: number[]): Map<number, number> => {
  const found = new Map<number, number>();
  const last = unitAt.length - ANCHOR_ATOMS;

  /* eslint-disable no-restricted-syntax -- FNV-1a over the run's characters;
     both the index and the accumulator advance inside the loop. */
  for (let index = 0; index < last; index += 1) {
    let hash = 0x811c9dc5;

    for (let at = unitAt[index]; at < unitAt[index + ANCHOR_ATOMS]; at += 1) {
      hash = Math.imul(hash ^ text.charCodeAt(at), 0x01000193);
    }

    found.set(hash, found.has(hash) ? -1 : index);
  }
  /* eslint-enable no-restricted-syntax */

  return found;
};

/**
 * Where the two texts can only be each other: runs of atoms occurring exactly
 * once on both sides, longest increasing run only so the matches stay in
 * order. Patience diff's anchor step, over atoms rather than lines — a block
 * has no lines, and a CJK one has no words either.
 * @param before - the stored text
 * @param after - the saved text
 * @param beforeUnits - where each of `before`'s atoms starts, in code units
 * @param afterUnits - where each of `after`'s atoms starts, in code units
 */
const anchors = (
  before: string,
  after: string,
  beforeUnits: number[],
  afterUnits: number[]
): Array<[number, number]> => {
  const uniqueInBefore = singleOccurrences(before, beforeUnits);
  const uniqueInAfter = singleOccurrences(after, afterUnits);
  const pairs: Array<[number, number]> = [];

  uniqueInBefore.forEach((index, run) => {
    const inAfter = uniqueInAfter.get(run) ?? -1;
    const matches = index >= 0 && inAfter >= 0 &&
      before.slice(beforeUnits[index], beforeUnits[index + ANCHOR_ATOMS]) ===
      after.slice(afterUnits[inAfter], afterUnits[inAfter + ANCHOR_ATOMS]);

    if (matches) {
      pairs.push([index, inAfter]);
    }
  });

  // A Map iterates in insertion order, which is `before` order for the runs
  // that survived — but a run first seen as a duplicate keeps its early slot,
  // so sort rather than trust it.
  pairs.sort((left, right) => left[0] - right[0]);

  // Patience sort: `piles[length - 1]` is the smallest `after` index any
  // increasing run of that length can end on, and `previous` chains the run
  // back so the winner can be walked out.
  const piles: number[] = [];
  const tails: number[] = [];
  const previous = new Array<number>(pairs.length).fill(-1);

  pairs.forEach(([, afterIndex], pairIndex) => {
    /* eslint-disable no-restricted-syntax -- binary search bounds move per step */
    let low = 0;
    let high = piles.length;

    while (low < high) {
      const middle = (low + high) >> 1;

      if (piles[middle] < afterIndex) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    /* eslint-enable no-restricted-syntax */

    piles[low] = afterIndex;
    tails[low] = pairIndex;
    previous[pairIndex] = low > 0 ? tails[low - 1] : -1;
  });

  const chosen: Array<[number, number]> = [];

  /* eslint-disable-next-line no-restricted-syntax -- walks the chain back */
  for (let at = tails[piles.length - 1] ?? -1; at >= 0; at = previous[at]) {
    chosen.push(pairs[at]);
  }

  return chosen.reverse();
};

/**
 * The smallest set of edits turning `before` into `after`.
 *
 * Minimal, not single-region, because these edits merge with a peer's. A
 * one-region diff describes "wrap this phrase in a tag" as "delete the phrase,
 * insert the tagged phrase" — so two peers wrapping OVERLAPPING phrases each
 * delete what the other re-inserts, and the shared words land twice while the
 * rest is dropped. Measured, and it is why `lib0`'s `simpleDiffString` is the
 * last resort here rather than the answer.
 *
 * Three steps, each narrower than the next is wide:
 *
 * 1. Myers over ATOMS — a whole tag, a whole entity, otherwise a code point
 *    (see `atomize`). Never code units: an emoji is two units, and an edit
 *    boundary between them puts the halves in separate CRDT items — measured,
 *    that shows the peer (and the writer) a broken character. And never bare
 *    code points either, or the diff spends a word's own letters on a tag's
 *    name and the peer fixing that letter edits the inside of the tag.
 * 2. Once the atom distance passes the cap, SPLIT the texts at atoms that occur
 *    exactly once in both — they can only be each other — and answer each gap
 *    between two anchors on its own. A bulk rewrite is then several narrow
 *    answers instead of one block-wide one, and a peer's keystroke in an
 *    untouched gap keeps the neighbours Yjs anchors it to. Anchors are atoms,
 *    not words, so this narrows text with no word breaks at all (CJK) too.
 * 3. Per gap, `coarseOps`: the words of that gap, then the gap's single region.
 *    With no anchors at all — a paste that shares nothing with what it replaces
 *    — there is one gap spanning everything, and the answer is exactly what it
 *    was before any of this existed.
 *
 * LOCKSTEP: packages/server/dotnet/Blok.Server/Collab/TextDiff.cs is a port of
 * this file — the atom units, the anchored split, the fused replace, and the
 * insert-BEFORE-delete apply order in `YDocConverter.EditText`. The two sides
 * must answer the same ops for the same pair, or the same edit merges
 * differently depending on who applied it.
 * @param before - the stored text
 * @param after - the saved text
 */
export const diffText = (before: string, after: string): TextEditOp[] => {
  const beforeAtoms = atomize(before);
  const afterAtoms = atomize(after);
  const atomOps = myersOps(beforeAtoms, afterAtoms);

  if (atomOps !== null) {
    return atomOps;
  }

  const beforeUnits = unitOffsets(beforeAtoms);
  const afterUnits = unitOffsets(afterAtoms);
  const found = anchors(before, after, beforeUnits, afterUnits);

  if (found.length === 0) {
    return coarseOps(before, after);
  }

  // Anchors are SPLIT POINTS, not consumed matches: every atom stays inside
  // some gap, and each gap's ops turn that gap of `before` into that gap of
  // `after` on their own. The result is then exactly `after` whatever the
  // anchors were — a bad pairing can only cost a worse answer, never a wrong
  // one.
  const bounds = [
    ...found.map(([beforeIndex, afterIndex]) => ({ beforeIndex,
      afterIndex })),
    { beforeIndex: beforeAtoms.length,
      afterIndex: afterAtoms.length },
  ];

  return bounds.reduce<{ ops: TextEditOp[]; beforeFrom: number; afterFrom: number }>((state, anchor) => {
    const beforeText = before.slice(beforeUnits[state.beforeFrom], beforeUnits[anchor.beforeIndex]);
    const afterText = after.slice(afterUnits[state.afterFrom], afterUnits[anchor.afterIndex]);

    if (beforeText !== afterText) {
      const gapAtoms = beforeAtoms.slice(state.beforeFrom, anchor.beforeIndex);
      const gapOps = myersOps(gapAtoms, afterAtoms.slice(state.afterFrom, anchor.afterIndex)) ??
        coarseOps(beforeText, afterText);

      state.ops.push(...gapOps.map((op) => ({ ...op,
        index: op.index + beforeUnits[state.beforeFrom] })));
    }

    return { ops: state.ops,
      beforeFrom: anchor.beforeIndex,
      afterFrom: anchor.afterIndex };
  }, { ops: [],
    beforeFrom: 0,
    afterFrom: 0 }).ops;
};
