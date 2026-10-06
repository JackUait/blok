/**
 * Base direction of a piece of text from its first strong character (UBA
 * rules P2/P3), shared by the editor's per-block stamp and the view renderer.
 *
 * PURITY: no imports — safe for the DOM-free view graph.
 */

/** A letter, or an explicit LRM/RLM mark. Digits and punctuation are neutral. */
const STRONG = /[\p{L}‎‏]/u;

/**
 * Letters in these ranges are bidi class R or AL: Hebrew to Arabic Extended-A,
 * the Hebrew/Arabic presentation forms, and the supplementary RTL blocks.
 * Ranges instead of `\p{Script=…}` so an engine that lacks a newer script name
 * cannot fail to parse the module.
 */
const RTL = /[֐-ࣿ‏יִ-﷿ﹰ-﻿\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;

/**
 * @param text - text to scan; stops at the first strong character
 * @returns 'ltr' or 'rtl', or null when the text has no strong character
 */
export const firstStrongDirection = (text: string): 'ltr' | 'rtl' | null => {
  const match = STRONG.exec(text);

  if (match === null) {
    return null;
  }

  return RTL.test(match[0]) ? 'rtl' : 'ltr';
};
