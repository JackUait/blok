import type { FormulaValue } from './types';
import { isRichText } from './types';
import { isText } from './values';

/**
 * Formulas saved in a document also run on the server (agent reads, Jint).
 * These caps keep one formula from hanging or exhausting it. Editor and
 * server share them, so a formula reads the same everywhere.
 */

/** The longest text a value may hold: about what a cell can show. */
export const MAX_TEXT_LENGTH = 10_000;

/** The most items a list may hold. */
export const MAX_LIST_LENGTH = 10_000;

/** A list counts its items plus the size of each; this caps the whole value. */
export const MAX_VALUE_SIZE = 100_000;

/** Work units for one evaluation: a node visit is 1, a builtin pays for what it reads and makes. */
export const MAX_EVALUATION_STEPS = 1_000_000;

/**
 * Backtracking steps all regular expressions of one evaluation may cost, as
 * `regexCost` bounds them. About 50 ms in V8: `a+b` on 10,000 characters.
 */
export const MAX_REGEX_COST = 6e7;

export const MAX_PATTERN_LENGTH = 1_000;

export const MAX_FORMULA_LENGTH = 10_000;

/**
 * Parser nesting: brackets, operators and calls. The checker and evaluator
 * recurse as deep. Measured in Jint on an agent read: lists overflow at 128
 * levels, brackets at 200. Keep at least half that.
 */
export const MAX_FORMULA_DEPTH = 64;

/** Thrown when an evaluation passes a cap. `evaluateFormula` reports it through `onLimit`. */
export class FormulaLimitExceeded extends Error {}

/**
 * The stack ran out. V8 and Jint both say "Maximum call stack size
 * exceeded"; any other RangeError (an invalid time zone) is not a limit.
 */
export const isStackOverflow = (error: unknown): boolean =>
  error instanceof RangeError && /call stack/i.test(error.message);

/**
 * Work all formulas of one pass over a database may spend together. The caps
 * above are per evaluation, and rows multiply them: 100 rows of a formula just
 * under the regex cap ran for seconds. About 1.7 s of steps and 0.6 s of regex in V8.
 */
export const MAX_PASS_STEPS = 20 * MAX_EVALUATION_STEPS;
export const MAX_PASS_REGEX_COST = 10 * MAX_REGEX_COST;

export class EvaluationBudget {
  private steps: number;
  private regex: number;

  /** `pass` is charged too, so one pass over many rows stays bounded. */
  constructor(private readonly pass?: EvaluationBudget, steps = MAX_EVALUATION_STEPS, regex = MAX_REGEX_COST) {
    this.steps = steps;
    this.regex = regex;
  }

  spend(units: number): void {
    this.steps -= units;
    if (this.steps < 0) throw new FormulaLimitExceeded();
    this.pass?.spend(units);
  }

  spendRegex(cost: number): void {
    this.regex -= cost;
    if (this.regex < 0) throw new FormulaLimitExceeded();
    this.pass?.spendRegex(cost);
  }
}

/** One per pass over a database: give it to every `evaluateFormula` of that pass. */
export const passBudget = (): EvaluationBudget => new EvaluationBudget(undefined, MAX_PASS_STEPS, MAX_PASS_REGEX_COST);

/** Text length, or a list's items plus their sizes. Other values count 1. */
export const valueSize = (value: FormulaValue): number => {
  if (typeof value === 'string') return value.length;
  if (Array.isArray(value)) return value.reduce<number>((total, item) => total + 1 + valueSize(item), 0);
  if (value !== null && isRichText(value)) return value.runs.reduce((total, run) => total + run.text.length + (run.link?.length ?? 0), 0);

  return 1;
};

/** Throws when a value passes a cap. Returns its size. */
export const checkValue = (value: FormulaValue): number => {
  const size = valueSize(value);
  const tooLong = Array.isArray(value) ? value.length > MAX_LIST_LENGTH : isText(value) && size > MAX_TEXT_LENGTH;

  if (tooLong || size > MAX_VALUE_SIZE) throw new FormulaLimitExceeded();

  return size;
};

/** Throws before text longer than the cap is built. */
export const checkTextLength = (length: number): void => {
  if (!(length <= MAX_TEXT_LENGTH)) throw new FormulaLimitExceeded();
};
