import type { ProcessedEmoji } from './emoji-data';
import type { EmojiLocaleData } from './emoji-locale';

const DEFAULT_LIMIT = 10;

// Lower is better. Gaps left between tiers so a tier can be inserted later
// without renumbering the others.
const RANK_EXACT_ID = 0;
// An emoji's id is its literal shortcode — a primary key, unique per emoji.
// A keyword (or a locale's translated name/keyword) is a descriptive tag
// that can collide: "fire" is also a keyword of "firefighter", "candle" and
// "name_badge" in the real @emoji-mart/data set. Both used to share
// RANK_EXACT_ID, so a query like "fire" tied between the "fire" emoji and
// "firefighter", and the tie broke on dataset (category) order — not
// relevance — sometimes putting the keyword collision first. This tier sits
// strictly below the id tier so an id match always wins that tie.
const RANK_EXACT_KEYWORD = 5;
const RANK_ID_PREFIX = 10;
const RANK_KEYWORD_PREFIX = 20;
const RANK_NAME_PREFIX = 30;
const RANK_SUBSTRING = 40;
const RANK_NONE = Number.POSITIVE_INFINITY;

function rankOne(emoji: ProcessedEmoji, query: string, localeData?: EmojiLocaleData | null): number {
  const id = emoji.id.toLowerCase();
  const name = emoji.name.toLowerCase();
  const keywords = emoji.keywords.map(k => k.toLowerCase());
  const localized = localeData?.[emoji.native];
  const localizedName = localized?.n.toLowerCase() ?? '';
  const localizedKeywords = (localized?.k ?? []).map(k => k.toLowerCase());

  if (id === query) {
    return RANK_EXACT_ID;
  }

  if (keywords.includes(query) || localizedName === query || localizedKeywords.includes(query)) {
    return RANK_EXACT_KEYWORD;
  }

  if (id.startsWith(query)) {
    return RANK_ID_PREFIX;
  }

  if (keywords.some(k => k.startsWith(query)) || localizedKeywords.some(k => k.startsWith(query))) {
    return RANK_KEYWORD_PREFIX;
  }

  if (name.startsWith(query) || localizedName.startsWith(query)) {
    return RANK_NAME_PREFIX;
  }

  if (id.includes(query) || name.includes(query) || localizedName.includes(query)) {
    return RANK_SUBSTRING;
  }

  return RANK_NONE;
}

/**
 * True when `query` is an exact shortcode match for `emoji` — the same two
 * top tiers searchEmojisRanked uses, id OR keyword OR localized name/keyword
 * (RANK_EXACT_ID or RANK_EXACT_KEYWORD). Exported so a caller that needs a
 * yes/no answer (e.g. committing on a closing ":") shares this single rule
 * instead of re-deriving its own, narrower copy of it (which would silently
 * drop the keyword case — see rankOne). Does not distinguish which of the two
 * tiers matched — callers that need an id match to win a collision (see
 * emojiTrigger.ts's commitOnClosingColon) check the id separately first.
 * @param emoji - candidate emoji
 * @param query - the text typed after ":", already without whitespace
 * @param localeData - translated names/keywords, when loaded
 */
export function isExactShortcodeMatch(emoji: ProcessedEmoji, query: string, localeData?: EmojiLocaleData | null): boolean {
  const rank = rankOne(emoji, query.toLowerCase(), localeData);

  return rank === RANK_EXACT_ID || rank === RANK_EXACT_KEYWORD;
}

/**
 * Emoji matching the query, best first, capped.
 *
 * Ties keep the dataset's own order so the list does not reshuffle between
 * keystrokes — the menu's highlighted row must not move under the user.
 * @param emojis - the loaded dataset
 * @param query - the text typed after ":", already without whitespace
 * @param localeData - translated names/keywords, when loaded
 * @param limit - maximum results
 */
export function searchEmojisRanked(
  emojis: ProcessedEmoji[],
  query: string,
  localeData?: EmojiLocaleData | null,
  limit: number = DEFAULT_LIMIT
): ProcessedEmoji[] {
  // resolveEmojiTriggerSpan rejects whitespace upstream; a query like "fire e" would
  // otherwise prefix-match "Fire Engine" here. Guard so the contract holds on its own.
  if (/\s/.test(query)) {
    return [];
  }

  const lower = query.toLowerCase();

  return emojis
    .map((emoji, index) => ({ emoji, index, rank: rankOne(emoji, lower, localeData) }))
    .filter(entry => entry.rank !== RANK_NONE)
    .sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
    .slice(0, limit)
    .map(entry => entry.emoji);
}
