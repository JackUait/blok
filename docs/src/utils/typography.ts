import type { Locale } from '../i18n';

/** The non-breaking space character (U+00A0). */
const NBSP = ' ';

/**
 * English short words (articles, prepositions, conjunctions) that read badly when
 * left dangling at the end of a line. We glue them to the word that follows.
 */
const EN_SHORT_WORDS = [
  'a', 'an', 'the',
  'to', 'of', 'in', 'on', 'at', 'by', 'as', 'is', 'it', 'or', 'no', 'so', 'if', 'we',
  'and', 'but', 'for', 'nor', 'yet', 'per', 'via',
];

/** Russian particles that belong to the PRECEDING word, never start a line. */
const RU_PARTICLES = ['бы', 'ли', 'же', 'ль', 'уж'];

/** Build a case-insensitive alternation, longest first so e.g. "an" wins over "a". */
const alternation = (words: string[]): string =>
  [...words].sort((a, b) => b.length - a.length).join('|');

/**
 * Insert non-breaking spaces into a piece of prose so short words, numbers and
 * dashes don't get stranded at the end of a line. Rules are locale-aware: Russian
 * binds one/two-letter prepositions forward and particles backward, English binds a
 * curated set of short function words forward. Shared rules (numbers + em dashes)
 * apply to both. Already-present non-breaking spaces are left untouched.
 */
export const applyTypography = (text: string, locale: Locale): string => {
  if (!text) {
    return text;
  }

  let result = text;

  // Shared: a non-breaking space goes BEFORE an em dash so it can't open a line.
  result = result.replace(/ +(—)/g, `${NBSP}$1`);

  if (locale === 'ru') {
    // Particles attach to the preceding word.
    const particles = alternation(RU_PARTICLES);
    result = result.replace(
      new RegExp(` +(${particles})(?=$|[\\s.,!?;:)])`, 'gi'),
      `${NBSP}$1`,
    );

    // One/two-letter Cyrillic words attach to the word that follows them, except
    // the particles handled above.
    result = result.replace(/(?<=^|\s)([а-яёА-ЯЁ]{1,2}) +/g, (match, word: string) => {
      if (RU_PARTICLES.includes(word.toLowerCase())) {
        return match;
      }
      return `${word}${NBSP}`;
    });
  } else {
    // English short function words attach to the word that follows them.
    const shorts = alternation(EN_SHORT_WORDS);
    result = result.replace(new RegExp(`(?<=^|\\s)(${shorts}) +`, 'gi'), `$1${NBSP}`);
  }

  // Shared: a number binds to the unit/word that follows it.
  result = result.replace(/(\d) +(?=\S)/g, `$1${NBSP}`);

  return result;
};
