import type { RichText, RichTextEmbed, RichTextMarks, RichTextSegment } from '../../../types/rich-text';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A key holding `undefined` counts as absent, as it does after a JSON round trip. */
const hasOnlyKeys = (record: Record<string, unknown>, allowed: string[]): boolean =>
  Object.keys(record).every(key => allowed.includes(key) || record[key] === undefined);

/**
 * A segment has exactly the keys of one shape. An extra key means the array is
 * some other record list (a custom tool's `{ text, checked }` items), not rich text.
 * @param item - one array entry
 */
const isSegment = (item: unknown): boolean => {
  if (!isRecord(item) || (item.marks !== undefined && !isRecord(item.marks))) {
    return false;
  }

  return (typeof item.text === 'string' && hasOnlyKeys(item, ['text', 'marks'])) ||
    (isRecord(item.embed) && hasOnlyKeys(item, ['embed', 'marks']));
};

/**
 * Whether a field value is segment rich text. `[]` counts: it is an empty
 * text field. Callers only ask this about fields known to hold rich text.
 * @param value - stored field value
 */
export const isRichText = (value: unknown): value is RichText =>
  Array.isArray(value) && value.every(isSegment);

/**
 * Segments out of an array that fails {@link isRichText}: keeps a string `text`
 * or a record `embed`, plus a record `marks`; drops other keys and items.
 * @param value - an array stored in a rich-text field
 */
export const readRichTextLeniently = (value: unknown[]): RichText => value.flatMap((item): RichTextSegment[] => {
  if (!isRecord(item)) {
    return [];
  }

  // Unknown mark keys are the input layer's to warn about and drop.
  const marks = isRecord(item.marks) ? { marks: item.marks as RichTextMarks } : {};

  if (typeof item.text === 'string') {
    return [{ text: item.text, ...marks }];
  }

  return isRecord(item.embed) ? [{ embed: item.embed as RichTextEmbed, ...marks }] : [];
});
