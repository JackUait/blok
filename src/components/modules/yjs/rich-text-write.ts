import type * as Y from 'yjs';

import { diffText, type TextEditOp } from './text-diff';
import { deltaToSegments, normalizeMarkValue, type ReadDeltaOp } from '../../../shared/rich-text/delta';
import { canonicalMarks, isTextSegment } from '../../../shared/rich-text/html-to-segments';
import type { RichText } from '../../../../types/rich-text';

type Attributes = Record<string, unknown>;

/** One write to a formatted text. The shape of the shared edit fixtures' `ops`. */
export type RichTextOp =
  | { op: 'insert'; index: number; text: string; attributes: Attributes }
  | { op: 'insertEmbed'; index: number; embed: Attributes; attributes: Attributes }
  | { op: 'delete'; index: number; length: number }
  | { op: 'format'; index: number; length: number; attributes: Attributes };

/** Stands for one embed (or foreign item) in the diffed projection. */
const EMBED_UNIT = '￼';

/**
 * One Y index: a UTF-16 code unit of text, or one embed. `foreign` is a live
 * item no segment can name (a nested type), which never pairs with anything.
 * `segment` is the index of the `next` segment it came from, -1 when live.
 */
interface Unit {
  char: string;
  embed?: Attributes;
  foreign: boolean;
  marks: Attributes;
  segment: number;
}

const isPlainObject = (value: unknown): value is Attributes =>
  typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;

const sameValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(normalizeMarkValue(left)) === JSON.stringify(normalizeMarkValue(right));

/** From the RAW delta: an item the canonical form drops still takes one index in yjs. */
const liveUnits = (live: readonly ReadDeltaOp[]): Unit[] => live.flatMap((op): Unit[] => {
  const marks = canonicalMarks(op.attributes);

  const insert = op.insert;

  if (typeof insert === 'string') {
    return Array.from({ length: insert.length }, (_, i) => ({ char: insert[i], foreign: false, marks, segment: -1 }));
  }

  return isPlainObject(insert)
    ? [{ char: EMBED_UNIT, embed: insert, foreign: false, marks, segment: -1 }]
    : [{ char: EMBED_UNIT, foreign: true, marks, segment: -1 }];
});

const nextUnits = (next: RichText): Unit[] => next.flatMap((segment, index): Unit[] => {
  const marks = (segment.marks ?? {}) as Attributes;

  if (isTextSegment(segment)) {
    return Array.from({ length: segment.text.length }, (_, i) => ({ char: segment.text[i], foreign: false, marks, segment: index }));
  }

  return [{ char: EMBED_UNIT, embed: segment.embed, foreign: false, marks, segment: index }];
});

const project = (units: Unit[]): string => units.map(unit => unit.char).join('');

const sameContent = (live: Unit, next: Unit): boolean => {
  if (live.foreign) {
    return false;
  }
  if (live.embed === undefined && next.embed === undefined) {
    return true;
  }

  return live.embed !== undefined && next.embed !== undefined && sameValue(live.embed, next.embed);
};

/**
 * Which unit each kept unit pairs with, from the diff of the projections. A
 * kept pair that is not the same content (a typed U+FFFC against an embed,
 * two different embeds, a foreign item) is unpaired, so it is replaced.
 */
const align = (before: Unit[], after: Unit[], edits: TextEditOp[]): { matchBefore: number[]; matchAfter: number[] } => {
  const matchBefore = new Array<number>(before.length).fill(-1);
  const matchAfter = new Array<number>(after.length).fill(-1);
  const cursor = { b: 0, a: 0 };
  const keep = (until: number): void => {
    for (; cursor.b < until; cursor.b += 1, cursor.a += 1) {
      if (sameContent(before[cursor.b], after[cursor.a])) {
        matchBefore[cursor.b] = cursor.a;
        matchAfter[cursor.a] = cursor.b;
      }
    }
  };

  edits.forEach((edit) => {
    keep(edit.index);
    cursor.b += edit.remove;
    cursor.a += edit.insert.length;
  });
  keep(before.length);

  return { matchBefore, matchAfter };
};

interface Region { before: number; removed: number; after: number; inserted: number }

/** Each maximal run of unpaired units on either side, front to back. */
const regionsOf = (matchBefore: number[], matchAfter: number[]): Region[] => {
  const regions: Region[] = [];
  const at = { b: 0, a: 0 };

  while (at.b < matchBefore.length || at.a < matchAfter.length) {
    if (at.b < matchBefore.length && at.a < matchAfter.length && matchBefore[at.b] === at.a) {
      at.b += 1;
      at.a += 1;
      continue;
    }

    const start = { ...at };

    while (at.b < matchBefore.length && matchBefore[at.b] < 0) {
      at.b += 1;
    }
    while (at.a < matchAfter.length && matchAfter[at.a] < 0) {
      at.a += 1;
    }
    regions.push({ before: start.b, removed: at.b - start.b, after: start.a, inserted: at.a - start.a });
  }

  return regions;
};

/** Inserts for one region: one per piece of a `next` segment, one per embed. */
const insertOps = (after: Unit[], region: Region): RichTextOp[] => {
  const ops: RichTextOp[] = [];
  const end = region.after + region.inserted;
  const at = { index: region.after, position: region.before };

  while (at.index < end) {
    const unit = after[at.index];
    const attributes = normalizeMarkValue(unit.marks) as Attributes;

    if (unit.embed !== undefined) {
      ops.push({ op: 'insertEmbed', index: at.position, embed: normalizeMarkValue(unit.embed) as Attributes, attributes });
      at.position += 1;
      at.index += 1;
      continue;
    }

    const stop = { index: at.index };

    while (stop.index < end && after[stop.index].embed === undefined && after[stop.index].segment === unit.segment) {
      stop.index += 1;
    }

    const text = project(after.slice(at.index, stop.index));

    ops.push({ op: 'insert', index: at.position, text, attributes });
    at.position += text.length;
    at.index = stop.index;
  }

  return ops;
};

/** Only the mark keys whose canonical value changed, sorted; `null` for a removed one. */
const changesOf = (live: Attributes, next: Attributes): Attributes | null => {
  const keys = [...new Set([...Object.keys(live), ...Object.keys(next)])].sort();
  const changes = keys
    .filter(key => (key in live) !== (key in next) || !sameValue(live[key], next[key]))
    .map(key => [key, key in next ? normalizeMarkValue(next[key]) : null] as const);

  return changes.length === 0 ? null : Object.fromEntries(changes);
};

/** Over the kept units, in final positions. Adjacent units with the same change share one call. */
const formatOps = (before: Unit[], after: Unit[], matchAfter: number[]): RichTextOp[] => {
  const ops: Array<RichTextOp & { op: 'format'; key: string }> = [];

  after.forEach((unit, index) => {
    const changes = matchAfter[index] < 0 ? null : changesOf(before[matchAfter[index]].marks, unit.marks);

    if (changes === null) {
      return;
    }

    const key = JSON.stringify(changes);
    const last = ops.at(-1);

    if (last !== undefined && last.key === key && last.index + last.length === index) {
      last.length += 1;
    } else {
      ops.push({ op: 'format', index, length: 1, attributes: changes, key });
    }
  });

  return ops.map(({ key: _key, ...op }) => op);
};

/**
 * The writes turning a formatted text holding `live` into `next`, fewest
 * first, so characters outside the change keep their CRDT identity and a
 * peer's concurrent typing or formatting there survives.
 *
 * LOCKSTEP with C# `RichTextEdit.Plan` (packages/server/dotnet/Blok.Server/
 * Collab/RichTextEdit.cs): both must issue the same ops for the same change,
 * pinned by test/unit/server-conformance/fixtures/rich-text-edits/ (its
 * README states the rules). Content ops come back to front, each region's
 * inserts before its delete; then format calls front to back.
 * @param live - the text's raw `toDelta()`
 * @param next - canonical segments to store
 */
export const planRichTextEdit = (live: readonly ReadDeltaOp[], next: RichText): RichTextOp[] => {
  // A respelling must write nothing, or two peers re-saving it ping-pong.
  if (JSON.stringify(deltaToSegments(live)) === JSON.stringify(next)) {
    return [];
  }

  const before = liveUnits(live);
  const after = nextUnits(next);
  // The characters of a formatted text are text: `<b>` there was typed.
  const edits = diffText(project(before), project(after), { markup: false });
  const { matchBefore, matchAfter } = align(before, after, edits);
  const content = regionsOf(matchBefore, matchAfter).reverse().flatMap(region => [
    ...insertOps(after, region),
    ...(region.removed > 0
      ? [{ op: 'delete', index: region.before + region.inserted, length: region.removed } as const]
      : []),
  ]);

  return [...content, ...formatOps(before, after, matchAfter)];
};

/**
 * Bring a formatted text to `next` (canonical segments). Call inside a
 * transaction. Every attributes object is fresh: yjs writes `null` into the
 * one it is handed for each mark in force that it does not name.
 * @param text - the stored formatted text
 * @param next - the saved canonical segments
 */
export const writeRichText = (text: Y.XmlText, next: RichText): void => {
  planRichTextEdit(text.toDelta() as ReadDeltaOp[], next).forEach((op) => {
    switch (op.op) {
      case 'insert':
        text.insert(op.index, op.text, op.attributes);
        break;
      case 'insertEmbed':
        text.insertEmbed(op.index, op.embed, op.attributes);
        break;
      case 'delete':
        text.delete(op.index, op.length);
        break;
      case 'format':
        text.format(op.index, op.length, op.attributes);
        break;
    }
  });
};
