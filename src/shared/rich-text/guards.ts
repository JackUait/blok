import type { RichText } from '../../../types/rich-text';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Whether a field value is segment rich text. `[]` counts: it is an empty
 * text field. Callers only ask this about fields known to hold rich text.
 * @param value - stored field value
 */
export const isRichText = (value: unknown): value is RichText =>
  Array.isArray(value) && value.every(item =>
    isRecord(item) && (typeof item.text === 'string' || isRecord(item.embed)));
