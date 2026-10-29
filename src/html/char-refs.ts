/**
 * Character references (`&amp;`, `&#38;`, `&#x26;`) as the HTML tokenizer
 * reads them: the longest known name wins, legacy names may skip the `;`,
 * and numeric values are repaired the way the spec says.
 */
import { PACKED_ENTITIES } from '../markdown/engine/entities';
import { LEGACY_ENTITIES } from './legacy-entities';

// Values 0x80..0x9F come from windows-1252; 0 means "keep the code point".
const C1 = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0,
  0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178,
];

// Longer than any name (the longest has 31 characters), so a capped run never ends in `;`.
const NAME_RUN = /[a-zA-Z0-9]{1,32}/y;
const ZEROS = /0*/y;
const DECIMAL = /[0-9]*/y;
const HEX = /[0-9a-fA-F]*/y;
const ALPHANUMERIC = /[a-zA-Z0-9]/;
// Seven hex or decimal digits already pass 0x10FFFF; more never come back into range.
const MAX_DIGITS = 8;
const LEGACY_LENGTHS = [6, 5, 4, 3, 2];

const tables: { named: Map<string, string> | null; legacy: Set<string> | null } = { named: null, legacy: null };

const namedTable = (): Map<string, string> => {
  tables.named ??= new Map(
    PACKED_ENTITIES.split('~').map((pair): [string, string] => {
      const space = pair.indexOf(' ');

      return [pair.slice(0, space), pair.slice(space + 1)];
    })
  );

  return tables.named;
};

const legacyTable = (): Set<string> => {
  tables.legacy ??= new Set(LEGACY_ENTITIES.split(' '));

  return tables.legacy;
};

/** The text a numeric reference stands for. */
export const codePointText = (code: number): string => {
  if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
    return '�';
  }
  if (code >= 0x80 && code <= 0x9f && C1[code - 0x80] !== 0) {
    return String.fromCharCode(C1[code - 0x80]);
  }

  return String.fromCodePoint(code);
};

const numericCode = (html: string, start: number, end: number, hex: boolean): number => {
  const significant = end - start;

  if (significant === 0) {
    return 0;
  }

  return significant > MAX_DIGITS ? Infinity : parseInt(html.slice(start, end), hex ? 16 : 10);
};

/** Reads one reference at a time; the last one read is in `value` and ends at `end`. */
export class CharRefReader {
  public value = '';
  public end = 0;

  /**
   * Reads the reference that starts at `start`, just after an `&`. Returns
   * false when there is none: the `&` is then plain text. In an attribute a
   * legacy name followed by `=` or a letter or digit stays plain text too.
   */
  public read(html: string, start: number, inAttribute: boolean): boolean {
    return html.charCodeAt(start) === 0x23 ? this.readNumeric(html, start) : this.readNamed(html, start, inAttribute);
  }

  private readNumeric(html: string, start: number): boolean {
    const hex = (html.charCodeAt(start + 1) | 0x20) === 0x78;
    const digitsStart = start + (hex ? 2 : 1);
    const digits = hex ? HEX : DECIMAL;

    ZEROS.lastIndex = digitsStart;
    ZEROS.test(html);
    const significantStart = ZEROS.lastIndex;

    digits.lastIndex = significantStart;
    digits.test(html);
    const end = digits.lastIndex;

    if (end === digitsStart) {
      return false;
  }
  this.value = codePointText(numericCode(html, significantStart, end, hex));
  this.end = html.charCodeAt(end) === 0x3b ? end + 1 : end;

  return true;
  }

  private readNamed(html: string, start: number, inAttribute: boolean): boolean {
    NAME_RUN.lastIndex = start;
    if (!NAME_RUN.test(html)) {
      return false;
  }
  const runEnd = NAME_RUN.lastIndex;
  const run = html.slice(start, runEnd);
  const named = namedTable();

  if (html.charCodeAt(runEnd) === 0x3b) {
    const value = named.get(run);

    if (value !== undefined) {
      this.value = value;
      this.end = runEnd + 1;

      return true;
    }
  }
  const legacy = legacyTable();
  const length = LEGACY_LENGTHS.find((candidate) => candidate <= run.length && legacy.has(run.slice(0, candidate)));

  if (length === undefined) {
    return false;
  }
  const next = html.charAt(start + length);

  if (inAttribute && (next === '=' || ALPHANUMERIC.test(next))) {
    return false;
  }
  this.value = named.get(run.slice(0, length)) ?? '';
  this.end = start + length;

  return true;
  }
}
