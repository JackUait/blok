import { MAX_PATTERN_LENGTH } from './limits';

/** A repeated choice whose branches can overlap, like `(a|aa)+`. */
interface Choice {
  /** Paths through one pass of the group. */
  paths: number;
  /** The fewest characters one pass reads (at least 1). */
  width: number;
  /** The most passes, or Infinity. */
  max: number;
}

/**
 * What bounds a pattern's backtracking. A pattern outside this shape returns
 * null from `patternShape`.
 */
export interface PatternShape {
  /** `*`, `+` and `{m,}` on a single character, class or plain group. */
  unbounded: number;
  /** Choices of `?` and `{m,n}`, one entry each. */
  spans: number[];
  /** Product of the branch counts of every `|`. */
  branches: number;
  choices: Choice[];
}

interface Frame {
  /** Holds a quantifier: repeating it backtracks without bound, so it is refused. */
  quantified: boolean;
  /** Paths through the group: its own branches times those of groups inside. */
  paths: number;
  /** A group inside has a `|`. */
  nestedChoice: boolean;
  branches: number;
  /** The fewest characters a branch reads, over the branches closed so far. */
  width: number;
  branchWidth: number;
  /** Each branch's first character when it is a literal, else null. */
  firsts: Array<string | null>;
  branchFirst: string | null | undefined;
}

/** What a quantifier would repeat. */
interface Atom {
  quantified: boolean;
  paths: number;
  /** One pass picks at most one branch: they start with different literal characters. */
  deterministic: boolean;
  width: number;
}

const QUANTIFIER = /^(?:([*+?])|\{(\d+)(?:(,)(\d*))?\})\??/;

const frame = (): Frame => ({
  quantified: false, paths: 1, nestedChoice: false, branches: 1, width: Infinity, branchWidth: 0, firsts: [], branchFirst: undefined,
});

const SINGLE: Atom = { quantified: false, paths: 1, deterministic: true, width: 1 };

class Unbounded extends Error {}

class PatternScanner {
  private pos = 0;
  /** Null at the start, after `(`, `|`, `^`, `$` or another quantifier. */
  private atom: Atom | null = null;
  private readonly frames: Frame[] = [frame()];
  readonly shape: PatternShape = { unbounded: 0, spans: [], branches: 1, choices: [] };

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

  /** Records an atom in the current branch; `literal` is its character when it matches only that. */
  private push(atom: Atom, literal: string | null): void {
    const current = this.top();

    if (current.branchFirst === undefined) current.branchFirst = literal;
    current.branchWidth += atom.width;
    this.atom = atom;
  }

  /** Closes the branch of the innermost group. */
  private endBranch(): void {
    const current = this.top();

    current.width = Math.min(current.width, current.branchWidth);
    current.firsts.push(current.branchFirst ?? null);
    current.branchWidth = 0;
    current.branchFirst = undefined;
  }

  private step(ch: string): void {
    switch (ch) {
      case '\\': return this.escape();
      case '[': return this.characterClass();
      case '(': return this.openGroup();
      case ')': return this.closeGroup();
      case '|':
        this.endBranch();
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
    this.pos++;
    // `^` and `$` read nothing and cannot be repeated; any other character, `{` included, is one atom.
    if (ch === '^' || ch === '$') {
      this.atom = null;

      return;
    }
    this.push(SINGLE, ch === '.' ? null : ch);
  }

  /** Backreferences (`\1`, `\k<name>`) are refused: no bound on their backtracking. */
  private escape(): void {
    const next = this.pattern[this.pos + 1];

    if (next === undefined || /[1-9k]/.test(next)) throw new Unbounded();
    this.pos += 2;
    this.push(SINGLE, /[A-Za-z0-9]/.test(next) ? null : next);
  }

  private characterClass(): void {
    const close = /^(?:\\.|[^\\\]])*\]/.exec(this.pattern.slice(this.pos + 1));

    if (close === null) throw new Unbounded();
    this.pos += 1 + close[0].length;
    this.push(SINGLE, null);
  }

  /** Only plain, `(?:` and named groups: lookarounds and modifiers are refused. */
  private openGroup(): void {
    const head = this.pattern.slice(this.pos, this.pos + 4);
    const named = /^\(\?<[^=!]/.test(head) ? this.pattern.indexOf('>', this.pos + 3) : -1;

    if (head.startsWith('(?:')) this.pos += 3;
    else if (named !== -1) this.pos = named + 1;
    else if (head.startsWith('(?')) throw new Unbounded();
    else this.pos++;
    this.frames.push(frame());
    this.atom = null;
  }

  private closeGroup(): void {
    if (this.frames.length < 2) throw new Unbounded();
    this.endBranch();
    const group = this.frames.pop() ?? frame();
    const literals = group.firsts.filter((first): first is string => first !== null);
    const parent = this.top();

    this.shape.branches *= group.branches;
    parent.quantified ||= group.quantified;
    parent.nestedChoice ||= group.branches > 1 || group.nestedChoice;
    parent.paths *= group.paths * group.branches;
    this.pos++;
    this.push({
      quantified: group.quantified,
      paths: group.paths * group.branches,
      deterministic: !group.nestedChoice && literals.length === group.firsts.length && new Set(literals).size === literals.length,
      width: group.width,
    }, null);
  }

  private quantify([text, symbol, minText, _comma, maxText]: RegExpExecArray): void {
    const atom = this.atom;

    if (atom === null || atom.quantified) throw new Unbounded();
    const min = symbol === undefined ? Number(minText) : Number(symbol === '+');
    const bounded = symbol === undefined && maxText !== '';
    const max = symbol === '?' ? 1 : Number(bounded ? (maxText ?? minText) : Infinity);

    if (max < min) throw new Unbounded();
    if (atom.paths > 1 && !atom.deterministic) this.choice(atom, max);
    else if (max === Infinity) this.shape.unbounded++;
    else if (max > min) this.shape.spans.push(max - min + 1);
    // An optional atom reads nothing at its fewest.
    if (min === 0) this.top().branchWidth -= atom.width;
    this.top().quantified = true;
    this.atom = null;
    this.pos += text.length;
  }

  private choice(atom: Atom, max: number): void {
    if (atom.width < 1) throw new Unbounded();
    this.shape.choices.push({ paths: atom.paths, width: atom.width, max });
  }
}

/**
 * Accepts only patterns whose backtracking `regexCost` can bound: no
 * backreferences, no lookarounds, and no repeated group that holds a
 * quantifier (`(a+)+`). A repeated `|` group is fine.
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
 * A repeated choice whose branches overlap takes one of `paths` per pass, at
 * most length / width passes: 2 * paths ^ passes. A step that backtracks into
 * an earlier quantifier measured about 5-10x slower in V8 than one with a
 * single quantifier, hence `weight`.
 */
export const regexCost = (shape: PatternShape, length: number, limit: number): number => {
  const weight = shape.unbounded > 1 || shape.spans.length > 0 || shape.choices.length > 0 ? 10 : 1;
  const ways = Array.from({ length: shape.unbounded + 1 }, (_, i) => i + 1)
    .reduce((cost, k) => (cost > limit ? cost : (cost * (length + shape.unbounded + 2 - k)) / k), shape.branches * weight);
  const spans = shape.spans.reduce((total, span) => (total > limit ? total : total * Math.min(span, length + 1)), ways);
  const cost = shape.choices.reduce((total, { paths, width, max }) => {
    const passes = Math.min(max, Math.floor((length + 1) / width));

    return total > limit ? total : total * 2 * paths ** passes;
  }, spans);

  return Math.max(cost, length + 1);
};
