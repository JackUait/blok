import type { RichText } from '../../../types/rich-text';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (record: Record<string, unknown>, allowed: string[]): boolean =>
  Object.keys(record).every(key => allowed.includes(key));

/**
 * A segment has exactly the keys of one shape. An extra key means the array is
 * some other record list (a custom tool's `{ text, checked }` items), not rich text.
 * @param item - one array entry
 */
const isSegment = (item: unknown): boolean => {
  if (!isRecord(item) || ('marks' in item && !isRecord(item.marks))) {
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
