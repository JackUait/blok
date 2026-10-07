import type { RichText, RichTextEmbed, RichTextMarks, RichTextSegment } from '../../../types/rich-text';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A key holding `undefined` counts as absent, as it does after a JSON round trip. */
const hasOnlyKeys = (record: Record<string, unknown>, allowed: string[]): boolean =>
  Object.keys(record).every(key => allowed.includes(key) || record[key] === undefined);

const definedKeys = (record: Record<string, unknown>): string[] =>
  Object.keys(record).filter(key => record[key] !== undefined);

const isOnly = (value: unknown, key: string): value is Record<string, unknown> => {
  if (!isRecord(value)) {
    return false;
  }

  const keys = definedKeys(value);

  return keys.length === 1 && keys[0] === key;
};

/**
 * The embed if it has exactly one of the three shapes, else `undefined`.
 * LOCKSTEP with C# `RichText.cs`: both sides drop the same embeds.
 * @param value - a segment's `embed`
 */
export const readEmbed = (value: unknown): RichTextEmbed | undefined => {
  if (isOnly(value, 'html')) {
    return typeof value.html === 'string' ? { html: value.html } : undefined;
  }
  if (isOnly(value, 'equation')) {
    const { equation } = value;

    return isOnly(equation, 'expression') && typeof equation.expression === 'string'
      ? { equation: { expression: equation.expression } }
      : undefined;
  }
  if (isOnly(value, 'page')) {
    const { page } = value;

    return isOnly(page, 'id') && typeof page.id === 'string' ? { page: { id: page.id } } : undefined;
  }

  return undefined;
};

/**
 * A segment has exactly the keys of one shape. An extra key means the array is
 * some other record list (a custom tool's `{ text, checked }` items), not rich text.
 * @param item - one array entry
 */
const isSegment = (item: unknown): boolean => {
  // Both keys, even one undefined, is ambiguous; the converters would read it as text.
  if (!isRecord(item) || ('text' in item && 'embed' in item) || (item.marks !== undefined && !isRecord(item.marks))) {
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
 * or a valid `embed`, plus a record `marks`; drops other keys and items.
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

  const embed = readEmbed(item.embed);

  return embed === undefined ? [] : [{ embed, ...marks }];
});
