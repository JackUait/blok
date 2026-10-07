import type * as Y from 'yjs';

import { diffText, type TextEditOp } from './text-diff';
import { deltaToSegments, normalizeMarkValue, type ReadDeltaOp } from '../../../shared/rich-text/delta';
import { isTextSegment } from '../../../shared/rich-text/html-to-segments';
import type { RichText, RichTextEmbed } from '../../../../types/rich-text';

/** Stands in for an embed in the plain projection the character diff runs on. */
const OBJECT_REPLACEMENT = '￼';

/** One Y index unit: a UTF-16 code unit of text, or one embed. */
interface Atom {
  char: string;
  embed?: RichTextEmbed;
  marks: Record<string, unknown>;
  /** JSON of `marks`; equal for equal marks because both sides are canonical. */
  marksKey: string;
}

const atomsOf = (segments: RichText): Atom[] => segments.flatMap((segment): Atom[] => {
  const marks = (segment.marks ?? {}) as Record<string, unknown>;
  const marksKey = JSON.stringify(marks);

  if (isTextSegment(segment)) {
    return Array.from({ length: segment.text.length }, (_, i) => ({ char: segment.text[i], marks, marksKey }));
  }

  return [{ char: OBJECT_REPLACEMENT, embed: segment.embed, marks, marksKey }];
});

const atomsOfText = (text: Y.XmlText): Atom[] => atomsOf(deltaToSegments(text.toDelta() as ReadDeltaOp[]));

const plainOf = (atoms: Atom[]): string => atoms.map(atom => atom.char).join('');

const attributesOf = (atom: Atom): Record<string, unknown> => normalizeMarkValue(atom.marks) as Record<string, unknown>;

/** One insert call each: an embed alone, or a stretch of text with equal marks. */
const runsOf = (atoms: Atom[]): Atom[][] => atoms.reduce<Atom[][]>((runs, atom) => {
  const last = runs.at(-1);

  if (last !== undefined && atom.embed === undefined && last[0].embed === undefined && last[0].marksKey === atom.marksKey) {
    last.push(atom);
  } else {
    runs.push([atom]);
  }

  return runs;
}, []);

/** Insert `atoms` at `index`, each run with its full marks (`{}` when unmarked), so nothing inherits. */
const insertAtoms = (text: Y.XmlText, index: number, atoms: Atom[]): void => {
  runsOf(atoms).reduce((at, run) => {
    const [first] = run;

    if (first.embed !== undefined) {
      text.insertEmbed(at, first.embed, attributesOf(first));

      return at + 1;
    }

    const chars = plainOf(run);

    text.insert(at, chars, attributesOf(first));

    return at + chars.length;
  }, index);
};

/** The marks that differ at one position, `null` for a mark to remove. */
const patchOf = (current: Atom, target: Atom): Record<string, unknown> => {
  if (current.marksKey === target.marksKey) {
    return {};
  }

  const keys = [...new Set([...Object.keys(current.marks), ...Object.keys(target.marks)])];

  return Object.fromEntries(keys
    .filter(key => JSON.stringify(current.marks[key]) !== JSON.stringify(target.marks[key]))
    .map(key => [key, target.marks[key] === undefined ? null : normalizeMarkValue(target.marks[key])]));
};

/** Each diff op with where its inserted text starts in the TARGET. */
const withTargetOffsets = (ops: TextEditOp[]): Array<TextEditOp & { targetAt: number }> =>
  ops.reduce<Array<TextEditOp & { targetAt: number }>>((planned, op) => {
    const previous = planned.at(-1);
    const shift = previous === undefined ? 0 : previous.targetAt - previous.index + previous.insert.length - previous.remove;

    return [...planned, { ...op, targetAt: op.index + shift }];
  }, []);

/**
 * INTERIM (B2): bring a formatted text to `target` with narrow edits, so two
 * peers typing in one paragraph keep both bursts. Characters first (the plain
 * projection through `diffText`, insert before delete, right to left), then
 * embeds whose payload differs, then one `format` per run of equal mark
 * patches. B3 owns the final write path, its shared edit fixtures and perf.
 * @param text - the stored formatted text
 * @param current - its canonical segments, as read
 * @param target - the saved canonical segments
 */
export const writeRichText = (text: Y.XmlText, current: RichText, target: RichText): void => {
  const after = atomsOf(target);

  // Right to left keeps earlier offsets valid. Insert BEFORE delete, for the
  // reason given at the unformatted Y.Text branch in `updateBlockData`.
  withTargetOffsets(diffText(plainOf(atomsOf(current)), plainOf(after))).reverse().forEach((op) => {
    insertAtoms(text, op.index, after.slice(op.targetAt, op.targetAt + op.insert.length));

    if (op.remove > 0) {
      text.delete(op.index + op.insert.length, op.remove);
    }
  });

  // Positions now match one to one. A typed U+FFFC diffs equal to an embed, so
  // embeds are compared by payload, not by their stand-in character.
  const placed = atomsOfText(text);

  [...after.keys()].reverse().forEach((i) => {
    if (JSON.stringify(placed[i].embed) !== JSON.stringify(after[i].embed)) {
      insertAtoms(text, i, [after[i]]);
      text.delete(i + 1, 1);
    }
  });

  const ranges = atomsOfText(text).reduce<Array<{ start: number; length: number; patch: Record<string, unknown>; key: string }>>((acc, atom, i) => {
    const patch = patchOf(atom, after[i]);
    const key = JSON.stringify(patch);
    const last = acc.at(-1);

    if (last !== undefined && last.key === key && last.start + last.length === i) {
      last.length += 1;
    } else {
      acc.push({ start: i, length: 1, patch, key });
    }

    return acc;
  }, []);

  ranges.filter(range => range.key !== '{}').forEach((range) => {
    text.format(range.start, range.length, range.patch);
  });
};
