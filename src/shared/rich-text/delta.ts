import { canonicalizeSegments } from './html-to-segments';
import type { RichText, RichTextEmbed, RichTextMarks, RichTextSegment } from '../../../types/rich-text';

const NUL_PATTERN = new RegExp(String.fromCharCode(0), 'g');

/** One op as written to (and read from) a formatted `Y.XmlText`. */
export interface DeltaOp {
  insert: string | RichTextEmbed;
  attributes: Record<string, unknown>;
}

/** A `toDelta()` op: `attributes` is absent on an unmarked run. */
export interface ReadDeltaOp {
  insert?: unknown;
  attributes?: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * One spelling per mark value, so equal marks compare equal in yjs: keys
 * sorted at every depth, `undefined` members dropped, NUL removed from keys
 * and strings.
 * @param value - a mark value
 */
export const normalizeMarkValue = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return value.replace(NUL_PATTERN, '');
  }
  if (Array.isArray(value)) {
    return value.map(normalizeMarkValue);
  }
  if (!isRecord(value)) {
    return value;
  }

  const entries = Object.keys(value)
    .filter(key => value[key] !== undefined)
    .map(key => [key.replace(NUL_PATTERN, ''), normalizeMarkValue(value[key])] as const)
    .sort(([a], [b]) => (a < b ? -1 : Number(a > b)));

  return Object.fromEntries(entries);
};

const segmentInsert = (segment: RichTextSegment): string | RichTextEmbed =>
  'embed' in segment && segment.embed !== undefined ? segment.embed : (segment as { text: string }).text;

/**
 * Canonical segments → ops for `insert`/`insertEmbed`. Every op carries an
 * explicit attributes object, `{}` when unmarked, so a run never inherits the
 * marks before it.
 * @param rich - segments in any spelling
 */
export const segmentsToDeltaOps = (rich: RichText): DeltaOp[] =>
  canonicalizeSegments(rich).map(segment => ({
    insert: segmentInsert(segment),
    attributes: normalizeMarkValue(segment.marks ?? {}) as Record<string, unknown>,
  }));

const readMarks = (attributes: Record<string, unknown> | undefined): { marks?: RichTextMarks } =>
  attributes === undefined || Object.keys(attributes).length === 0 ? {} : { marks: attributes as RichTextMarks };

/**
 * `Y.XmlText#toDelta()` → canonical segments. Inserts that are neither a
 * string nor a plain object (a nested Y type) are skipped.
 * @param delta - ops as yjs returns them
 */
export const deltaToSegments = (delta: readonly ReadDeltaOp[]): RichText => {
  const segments: RichTextSegment[] = [];

  for (const op of delta) {
    if (typeof op.insert === 'string') {
      segments.push({ text: op.insert, ...readMarks(op.attributes) });
    } else if (isRecord(op.insert) && Object.getPrototypeOf(op.insert) === Object.prototype) {
      segments.push({ embed: op.insert as RichTextEmbed, ...readMarks(op.attributes) });
    }
  }

  return canonicalizeSegments(segments);
};
