import type { ListMarker, NumberingApi } from './context';
import type { Css, ParaProps } from './props';
import { parseParaProps, parseRunProps } from './props';
import type { StyleSheet } from './styles';
import { visibleGlyph } from './glyphs';
import { listFormat } from './list-formats';
import { attr, kid, kids, num, onOff, val } from './xml';

/** Longest `w:lvlText` we expand; the rest is cut, so a repeated `%1` cannot grow every paragraph. */
const MAX_LVL_TEXT = 32;
/** Longest marker we draw, whatever the levels expand to. */
const MAX_MARKER = 100;

interface Level {
  start: number;
  format: string;
  text: string;
  suffix: ListMarker['suffix'];
  /** One-based level whose use restarts this one; 0 never; null by default. */
  restart: number | null;
  legal: boolean;
  para: ParaProps;
  run: Css;
}

type Levels = Map<number, Level>;

const MAX_LINKS = 8;

const ROMAN: Array<[number, string]> = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

function roman(n: number): string {
  const out: string[] = [];
  ROMAN.reduce((rest, [value, digits]) => {
    out.push(digits.repeat(Math.floor(rest / value)));

    return rest % value;
  }, n);

  return out.join('');
}

/** a…z, then aa…zz, aaa… (ECMA-376 §17.18.59). */
const letter = (n: number): string => String.fromCharCode(97 + ((n - 1) % 26)).repeat(Math.floor((n - 1) / 26) + 1);

/** Word's largest list number. A document may ask for more; it gets this. */
const MAX_VALUE = 32767;
/** Past this a letter marker would be a run of 40+ repeated letters, so it shows as decimal. */
const MAX_LETTER_VALUE = 26 * 40;

/** A counter value in a level format. Letters and roman numerals have no 0, so 0 shows as decimal. */
function formatValue(raw: number, format: string): string {
  const n = Math.min(Math.max(Math.trunc(raw), 0), MAX_VALUE);
  const positive = n >= 1;
  const lettered = positive && n <= MAX_LETTER_VALUE;
  switch (format) {
    case 'bullet':
    case 'none':
      return '';
    case 'decimalZero':
      return positive && n < 10 ? `0${n}` : String(n);
    case 'upperRoman':
      return positive ? roman(n) : String(n);
    case 'lowerRoman':
      return positive ? roman(n).toLowerCase() : String(n);
    case 'upperLetter':
      return lettered ? letter(n).toUpperCase() : String(n);
    case 'lowerLetter':
      return lettered ? letter(n) : String(n);
    default:
      return listFormat(n, format) ?? String(n);
  }
}

function suffixOf(lvl: Element): ListMarker['suffix'] {
  const suff = val(lvl, 'suff');

  return suff === 'space' || suff === 'nothing' ? suff : 'tab';
}

function parseLevel(lvl: Element, styles: StyleSheet): Level {
  const pPr = parseParaProps(kid(lvl, 'pPr'));

  return {
    start: num(val(lvl, 'start')) ?? 0,
    format: val(lvl, 'numFmt') ?? 'decimal',
    text: (val(lvl, 'lvlText') ?? '').slice(0, MAX_LVL_TEXT),
    suffix: suffixOf(lvl),
    restart: num(val(lvl, 'lvlRestart')),
    legal: onOff(lvl, 'isLgl') === true,
    para: { css: pPr.css, ...(pPr.bidi === undefined ? {} : { bidi: pPr.bidi }) },
    run: parseRunProps(kid(lvl, 'rPr'), styles.theme),
  };
}

function levelsOf(el: Element, styles: StyleSheet): Levels {
  const out: Levels = new Map();
  for (const lvl of kids(el, 'lvl')) {
    out.set(num(attr(lvl, 'ilvl')) ?? 0, parseLevel(lvl, styles));
  }

  return out;
}

/** Deeper levels restart when a level at or above their restart level is used. */
function restarts(level: Level, deeper: number, used: number): boolean {
  if (level.restart === 0) {
    return false;
  }
  const after = level.restart === null || level.restart > deeper ? deeper - 1 : level.restart - 1;

  return used <= after;
}

class Numbering implements NumberingApi {
  private readonly abstracts = new Map<string, Element>();
  private readonly nums = new Map<string, Element>();
  private readonly cache = new Map<string, Levels | null>();
  private readonly counters = new Map<string, Map<number, number>>();

  constructor(doc: Document | null, private readonly styles: StyleSheet) {
    const root = doc?.documentElement ?? null;
    for (const el of root === null ? [] : kids(root, 'abstractNum')) {
      this.abstracts.set(attr(el, 'abstractNumId') ?? '', el);
    }
    for (const el of root === null ? [] : kids(root, 'num')) {
      this.nums.set(attr(el, 'numId') ?? '', el);
    }
  }

  /** The abstractNum behind a num, following numStyleLink through the linked style's num. */
  private abstractOf(numId: string): Element | null {
    const seen = new Set<string>();
    const walk = (id: string): Element | null => {
      const abs = this.abstracts.get(val(this.nums.get(id), 'abstractNumId') ?? '') ?? null;
      const link = val(abs, 'numStyleLink');
      if (abs === null || link === null) {
        return abs;
      }
      const next = this.styles.numIdOf(link);
      if (next === null || seen.has(next) || seen.size >= MAX_LINKS) {
        return null;
      }
      seen.add(next);

      return walk(next);
    };
    seen.add(numId);

    return walk(numId);
  }

  private levels(numId: string): Levels | null {
    if (!this.cache.has(numId)) {
      this.cache.set(numId, this.buildLevels(numId));
    }

    return this.cache.get(numId) ?? null;
  }

  private buildLevels(numId: string): Levels | null {
    const numEl = this.nums.get(numId);
    const abs = numEl === undefined ? null : this.abstractOf(numId);
    if (numEl === undefined || abs === null) {
      return null;
    }
    const levels = levelsOf(abs, this.styles);
    for (const override of kids(numEl, 'lvlOverride')) {
      this.applyOverride(levels, override);
    }

    return levels;
  }

  private applyOverride(levels: Levels, override: Element): void {
    const ilvl = num(attr(override, 'ilvl')) ?? 0;
    const lvl = kid(override, 'lvl');
    if (lvl !== null) {
      levels.set(ilvl, parseLevel(lvl, this.styles));
    }
    const start = num(val(override, 'startOverride'));
    const level = levels.get(ilvl);
    if (start !== null && level !== undefined) {
      levels.set(ilvl, { ...level, start });
    }
  }

  /** Advance the level's counter and restart the deeper ones. */
  private bump(numId: string, levels: Levels, ilvl: number, level: Level): Map<number, number> {
    const counts = this.counters.get(numId) ?? new Map<number, number>();
    this.counters.set(numId, counts);
    const current = counts.get(ilvl);
    counts.set(ilvl, current === undefined ? level.start : current + 1);
    for (const [deeper, other] of levels) {
      if (deeper > ilvl && restarts(other, deeper, ilvl)) {
        counts.delete(deeper);
      }
    }

    return counts;
  }

  marker(numId: string, ilvl: number): ListMarker | null {
    const levels = this.levels(numId);
    const level = levels?.get(ilvl);
    if (levels === null || level === undefined) {
      return null;
    }
    const counts = this.bump(numId, levels, ilvl, level);
    const raw = level.text.replace(/%([1-9])/g, (_, digit: string) => {
      const at = Number(digit) - 1;
      const own = levels.get(at);
      const value = counts.get(at) ?? own?.start ?? 0;

      return formatValue(value, level.legal ? 'decimal' : own?.format ?? 'decimal');
    });
    const font = level.run['font-family'] ?? '';
    const text = Array.from(raw).slice(0, MAX_MARKER).map((char) => visibleGlyph(char, font)).join('');
    const run = { ...level.run };
    if (text !== raw) {
      // The symbol font would draw the mapped glyph as a box.
      delete run['font-family'];
    }

    return { text, para: level.para, run, suffix: level.suffix };
  }
}

/** List numbering from `numbering.xml`. */
export function createNumbering(doc: Document | null, styles: StyleSheet): NumberingApi {
  return new Numbering(doc, styles);
}
