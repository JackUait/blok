import type { RowReactions } from './types';

/**
 * Each person's reactions live in their own top-level row data key. The row's
 * data map exists on every peer, so two people's first reactions are two keys
 * and merge. One shared `reactions` map would be created by both peers at
 * once, and only one map survives that.
 */
export const REACTION_KEY_PREFIX = 'reactions:';

export const reactionKey = (userId: string): string => `${REACTION_KEY_PREFIX}${userId}`;

export const isReactionKey = (key: string): boolean => key.startsWith(REACTION_KEY_PREFIX) && key.length > REACTION_KEY_PREFIX.length;

/** Row data's reaction keys, gathered by user id. Values that are not emoji-to-time maps are skipped. */
export const rowReactions = (data: Record<string, unknown> | undefined): RowReactions => Object.fromEntries(
  Object.entries(data ?? {})
    .filter(([key, value]) => isReactionKey(key) && typeof value === 'object' && value !== null && !Array.isArray(value))
    .map(([key, value]) => [
      key.slice(REACTION_KEY_PREFIX.length),
      Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === 'number')),
    ] as const)
    .filter(([, own]) => Object.keys(own).length > 0)
);
