import { MAX_PATTERN_LENGTH } from './limits';

/**
 * What bounds a pattern's backtracking. A pattern outside this shape returns
 * null from `patternShape` and the formula treats it as invalid.
 */
export interface PatternShape {
  /** `*`, `+` and `{m,}`. */
  unbounded: number;
  /** Choices of `?` and `{m,n}`, one entry each. */
  spans: number[];
  /** Product of the branch counts of every `|`. */
  branches: number;
}

interface Frame {
  /** Holds a quantifier or a `|`: repeating it can backtrack exponentially. */
  complex: boolean;
  branches: number;
}

/** What a quantifier would repeat: null at the start, after `(`, `|`, `^`, `$` or another quantifier. */
type Atom = { complex: boolean } | null;

const QUANTIFIER = /^(?:([*+?])|\{(\d+)(?:(,)(\d*))?\})\??/;

class Unbounded extends Error {}

class PatternScanner {
  private pos = 0;
  private atom: Atom = null;
  private readonly frames: Frame[] = [{ complex: false, branches: 1 }];
  readonly shape: PatternShape = { unbounded: 0, spans: [], branches: 1 };

  constructor(private readonly pattern: string) {}

  run(): PatternShape {
    while (this.pos < this.pattern.length) {
      this.step(this.pattern[this.pos]);
    }
    if (this.frames.length !== 1) throw new Unbounded();
    this.shape.branches *= this.frames[0].branches;

    return this.shape;
  }

  private top(): Frame {
    return this.frames[this.frames.length - 1];
  }

  private step(ch: string): void {
    switch (ch) {
      case '\\': return this.escape();
      case '[': return this.characterClass();
      case '(': return this.openGroup();
      case ')': return this.closeGroup();
      case '|':
        this.top().branches++;
        this.atom = null;
        this.pos++;

        return;
      default:
        break;
    }
    const quantifier = '*+?{'.includes(ch) ? QUANTIFIER.exec(this.pattern.slice(this.pos)) : null;

    if (quantifier !== null) return this.quantify(quantifier);
    if (ch === '*' || ch === '+' || ch === '?') throw new Unbounded();
    // `^` and `$` cannot be repeated; any other character, `{` included, is one atom.
    this.atom = ch === '^' || ch === '$' ? null : { complex: false };
    this.pos++;
  }

  /** Backreferences (`\1`, `\k<name>`) are refused: no bound on their backtracking. */
  private escape(): void {
    const next = this.pattern[this.pos + 1];

    if (next === undefined || /[1-9k]/.test(next)) throw new Unbounded();
    this.pos += 2;
    this.atom = { complex: false };
  }

  private characterClass(): void {
    const close = /^(?:\\.|[^\\\]])*\]/.exec(this.pattern.slice(this.pos + 1));

    if (close === null) throw new Unbounded();
    this.pos += 1 + close[0].length;
    this.atom = { complex: false };
  }

  /** Only plain, `(?:` and named groups: lookarounds and modifiers are refused. */
  private openGroup(): void {
    const head = this.pattern.slice(this.pos, this.pos + 4);
    const named = /^\(\?<[^=!]/.test(head) ? this.pattern.indexOf('>', this.pos + 3) : -1;

    if (head.startsWith('(?:')) this.pos += 3;
    else if (named !== -1) this.pos = named + 1;
    else if (head.startsWith('(?')) throw new Unbounded();
    else this.pos++;
    this.frames.push({ complex: false, branches: 1 });
    this.atom = null;
  }

  private closeGroup(): void {
    const frame = this.frames.pop();

    if (frame === undefined || this.frames.length === 0) throw new Unbounded();
    const complex = frame.complex || frame.branches > 1;

    this.shape.branches *= frame.branches;
    this.top().complex ||= complex;
    this.atom = { complex };
    this.pos++;
  }

  private quantify([text, symbol, min, comma, max]: RegExpExecArray): void {
    if (this.atom === null || this.atom.complex) throw new Unbounded();
    if (comma !== undefined && max !== '' && Number(max) < Number(min)) throw new Unbounded();
    if (symbol === '?') this.shape.spans.push(2);
    else if (symbol !== undefined || (comma !== undefined && max === '')) this.shape.unbounded++;
    else if (comma !== undefined) this.shape.spans.push(Number(max) - Number(min) + 1);
    this.top().complex = true;
    this.atom = null;
    this.pos += text.length;
  }
}

/**
 * Accepts only patterns whose backtracking `regexCost` can bound: no
 * backreferences, no lookarounds, and no quantified group that holds a
 * quantifier or a `|` (`(a+)+`, `(a|aa)*`).
 */
export const patternShape = (pattern: string): PatternShape | null => {
  if (pattern.length > MAX_PATTERN_LENGTH) return null;
  try {
    return new PatternScanner(pattern).run();
  } catch (error) {
    if (error instanceof Unbounded) return null;
    throw error;
  }
};

/**
 * An upper bound on backtracking steps over `length` characters. A start
 * position and q unbounded quantifiers split the text at q + 1 ordered points:
 * C(length + q + 1, q + 1) ways. Each bounded choice and branch multiplies it.
 * A step that backtracks into an earlier quantifier measured about 5-10x
 * slower in V8 than one with a single quantifier, hence `weight`.
 */
export const regexCost = (shape: PatternShape, length: number, limit: number): number => {
  const weight = shape.unbounded > 1 || shape.spans.length > 0 ? 10 : 1;
  const ways = Array.from({ length: shape.unbounded + 1 }, (_, i) => i + 1)
    .reduce((cost, k) => (cost > limit ? cost : (cost * (length + shape.unbounded + 2 - k)) / k), shape.branches * weight);
  const cost = shape.spans.reduce((total, span) => (total > limit ? total : total * Math.min(span, length + 1)), ways);

  return Math.max(cost, length + 1);
};
