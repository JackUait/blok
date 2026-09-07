import { describe, it, expect } from 'vitest';
import { isExactShortcodeMatch, searchEmojisRanked } from '../../../../../src/components/utils/emoji/emoji-search-ranked';
import type { ProcessedEmoji } from '../../../../../src/components/utils/emoji/emoji-data';

function emoji(id: string, name: string, keywords: string[], native: string): ProcessedEmoji {
  return { id, name, keywords, native, skins: [native], category: 'test' };
}

const DATA: ProcessedEmoji[] = [
  emoji('fire', 'Fire', ['hot', 'cook', 'flame'], '🔥'),
  emoji('fire_engine', 'Fire Engine', ['truck'], '🚒'),
  emoji('firecracker', 'Firecracker', ['dynamite'], '🧨'),
  emoji('+1', 'Thumbs Up', ['+1', 'thumbsup', 'yes'], '👍'),
  emoji('extinguisher', 'Fire Extinguisher', ['quench'], '🧯'),
];

describe('searchEmojisRanked', () => {
  it('puts an exact shortcode match first', () => {
    expect(searchEmojisRanked(DATA, 'fire')[0]?.native).toBe('🔥');
  });

  it('resolves a keyword-only shortcode such as thumbsup', () => {
    expect(searchEmojisRanked(DATA, 'thumbsup')[0]?.native).toBe('👍');
  });

  it('ranks an id prefix above a name-substring match', () => {
    const natives = searchEmojisRanked(DATA, 'firec').map(e => e.native);

    expect(natives[0]).toBe('🧨');
  });

  it('ranks an id prefix above a name prefix', () => {
    const natives = searchEmojisRanked(DATA, 'fire').map(e => e.native);

    // fire_engine matches on the id; Fire Extinguisher only on the name.
    expect(natives.indexOf('🚒')).toBeLessThan(natives.indexOf('🧯'));
  });

  it('never matches a query containing whitespace', () => {
    // resolveEmojiTriggerSpan rejects these upstream; assert the contract here too.
    expect(searchEmojisRanked(DATA, 'fire e')).toEqual([]);
  });

  it('caps the result list', () => {
    expect(searchEmojisRanked(DATA, 'fire', null, 2)).toHaveLength(2);
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(searchEmojisRanked(DATA, 'zzzz')).toEqual([]);
  });

  it('is stable: equal-rank results keep dataset order', () => {
    const natives = searchEmojisRanked(DATA, 'fire').map(e => e.native);

    // fire_engine and firecracker both rank as id prefixes, so their relative
    // order must come from the dataset, not from the sort.
    expect(natives.indexOf('🚒')).toBeLessThan(natives.indexOf('🧨'));
  });

  it('matches a localized name when locale data is supplied', () => {
    const locale = { '🔥': { n: 'Огонь', k: ['жар'] } };

    expect(searchEmojisRanked(DATA, 'огонь', locale)[0]?.native).toBe('🔥');
  });

  it('ranks an exact localized-name match above a lower-tier id-prefix competitor', () => {
    const locale = { '🔥': { n: 'Огонь', k: ['жар'] } };
    // id starts with the same query, so this only reaches RANK_ID_PREFIX —
    // it must not outrank an exact localized match.
    const competitor = emoji('огонь_show', 'Fireworks Show', ['show'], '🎆');
    const data = [...DATA, competitor];

    const natives = searchEmojisRanked(data, 'огонь', locale).map(e => e.native);

    expect(natives[0]).toBe('🔥');
  });
});

describe('isExactShortcodeMatch', () => {
  const fire = DATA.find(e => e.id === 'fire');
  const thumbsUp = DATA.find(e => e.id === '+1');
  const fireEngine = DATA.find(e => e.id === 'fire_engine');

  if (fire === undefined || thumbsUp === undefined || fireEngine === undefined) {
    throw new Error('fixture emoji missing');
  }

  it('is true for an exact id match', () => {
    expect(isExactShortcodeMatch(fire, 'fire')).toBe(true);
  });

  // Pins the load-bearing rule: "thumbsup" is a keyword of "+1", not its id
  // — this is what makes ":thumbsup:" commit on the closing colon.
  it('is true for an exact keyword match, even though the id differs', () => {
    expect(isExactShortcodeMatch(thumbsUp, 'thumbsup')).toBe(true);
  });

  it('is false for a prefix-only match', () => {
    expect(isExactShortcodeMatch(fire, 'fir')).toBe(false);
  });

  it('is false when the query matches neither this emoji\'s id nor its keywords', () => {
    expect(isExactShortcodeMatch(fireEngine, 'fire')).toBe(false);
  });
});
