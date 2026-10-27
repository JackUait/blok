import { PACKED_ENTITIES } from './entities';

/**
 * Character classes and string decoding shared by the block and inline parsers.
 *
 * Classes test ONE UTF-16 code unit, as the parser Blok used before did: an
 * emoji's surrogate halves are neither punctuation nor whitespace, so `*😀*`
 * flanks the same way it always has.
 */

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;
const UNICODE_PUNCTUATION = /[\p{P}\p{S}]/u;
const UNICODE_WHITESPACE = /\s/;

export const isAsciiPunctuation = (char: string): boolean => char.length === 1 && ASCII_PUNCTUATION.test(char);

/** End of input counts as whitespace, as CommonMark's flanking rules read it. */
export const isUnicodeWhitespace = (char: string | undefined): boolean => char === undefined || char === '' || UNICODE_WHITESPACE.test(char);

export const isUnicodePunctuation = (char: string | undefined): boolean => char !== undefined && char !== '' && UNICODE_PUNCTUATION.test(char);

const cache: { entities?: Map<string, string> } = {};

/**
 * The characters a named reference stands for, or undefined when the name is
 * not an HTML entity. `name` has no `&` and no `;`.
 * @param name - the entity name
 */
export const decodeNamedEntity = (name: string): string | undefined => {
  cache.entities ??= new Map(PACKED_ENTITIES.split('~').map((pair) => {
    const space = pair.indexOf(' ');

    return [pair.slice(0, space), pair.slice(space + 1)];
  }));

  return cache.entities.get(name);
};

/**
 * A numeric reference's character. Controls, surrogates, noncharacters and
 * out-of-range codes become U+FFFD.
 * @param digits - the digits after `&#` or `&#x`
 * @param base - 10 or 16
 */
export const decodeNumericEntity = (digits: string, base: 10 | 16): string => {
  const code = Number.parseInt(digits, base);
  const low = code & 0xFFFF;

  if (
    code < 9 || code === 11 || (code > 13 && code < 32)
    || (code > 126 && code < 160)
    || (code > 0xD7FF && code < 0xE000)
    || (code > 0xFDCF && code < 0xFDF0)
    || low === 0xFFFF || low === 0xFFFE
    || code > 0x10FFFF
  ) {
    return '�';
  }

  return String.fromCodePoint(code);
};

/** A backslash escape, or a character reference: `&#35;`, `&#x23;`, `&amp;`. */
const ESCAPE_OR_REFERENCE = /\\([!-/:-@[-`{-~])|&(#(?:\d{1,7}|[xX][\dA-Fa-f]{1,6})|[\dA-Za-z]{1,31});/g;

/**
 * Decode one character reference body (what sits between `&` and `;`), or
 * return undefined when it is not one.
 * @param body - e.g. `amp`, `#35`, `#x23`
 */
export const decodeReference = (body: string): string | undefined => {
  if (body.startsWith('#')) {
    const hex = body[1] === 'x' || body[1] === 'X';

    return decodeNumericEntity(body.slice(hex ? 2 : 1), hex ? 16 : 10);
  }

  return decodeNamedEntity(body);
};

/**
 * Decode backslash escapes and character references in a string that holds
 * no other markup: a link destination, a title, a fence info string.
 * @param value - the raw string
 */
export const decodeString = (value: string): string =>
  value.replace(ESCAPE_OR_REFERENCE, (whole, escaped: string | undefined, reference: string | undefined) =>
    escaped ?? (reference === undefined ? whole : decodeReference(reference) ?? whole));

/**
 * The key a link label matches its definition by: whitespace runs collapsed,
 * trimmed, case-folded. mdast stores it lower-cased.
 * @param label - the label as written, without brackets
 */
export const normalizeIdentifier = (label: string): string =>
  label.replace(/[\t\n\r ]+/g, ' ').replace(/^ | $/g, '').toLowerCase().toUpperCase().toLowerCase();
