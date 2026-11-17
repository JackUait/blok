import type { DatabaseCommentMention } from '../../types/tools/database-comment';

const TYPES = new Set<unknown>(['person', 'page', 'date']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The mentions that still cover their label in `text`, in text order, none
 * overlapping. An edit that rewrites only `text` (an agent, a peer) leaves
 * stale ones behind, so readers and the tool both pass mentions through here.
 */
export const keptMentions = (text: string, raw: unknown): DatabaseCommentMention[] => {
  if (!Array.isArray(raw)) return [];
  const valid = raw.flatMap((item): DatabaseCommentMention[] => {
    if (!isRecord(item) || !TYPES.has(item.type) || typeof item.id !== 'string' || item.id === ''
      || typeof item.label !== 'string' || item.label === '' || !Number.isInteger(item.start)) return [];
    const start = item.start as number;

    if (start < 0 || text.slice(start, start + item.label.length) !== item.label) return [];

    return [{ type: item.type as DatabaseCommentMention['type'], id: item.id, start, label: item.label }];
  }).sort((a, b) => a.start - b.start);

  return valid.filter((mention, index) => index === 0 || mention.start >= valid[index - 1].start + valid[index - 1].label.length);
};

/**
 * Finds each picked mention's label again in `text`, in order, after the user
 * typed around them. A label that is gone drops its mention.
 */
export const relocateMentions = (text: string, picked: readonly Omit<DatabaseCommentMention, 'start'>[]): DatabaseCommentMention[] => {
  const from = { at: 0 };

  return picked.flatMap((mention) => {
    const start = text.indexOf(mention.label, from.at);

    if (start === -1) return [];
    from.at = start + mention.label.length;

    return [{ ...mention, start }];
  });
};
