import { afterEach, describe, expect, it } from 'vitest';
import { createHighlighter } from '../../../../../src/tools/code/highlight/engine';
import { BASE_GRAMMARS, createGrammarLoader } from '../../../../../src/tools/code/highlight/grammar-loader';

/**
 * Greedy rematching can make one wrap re-tokenize the rest of the line, and
 * each of those steps can rescan the line. A shared document can carry any
 * text, so the regex work must grow about linearly with the line.
 *
 * Work is the characters each regex exec scans, so one exec that scans the
 * whole line counts as much as it costs. Linear work quadruples at 4n.
 */
const N = 400;
const MAX_GROWTH = 6;

const originalExec = RegExp.prototype.exec;

afterEach(() => {
  RegExp.prototype.exec = originalExec;
});

class WorkCapReached extends Error {}

/** Characters scanned by every exec while tokenizing; stops early once past `cap`. */
const regexWork = (tokenize: () => unknown, cap = Infinity): number => {
  let work = 0;

  RegExp.prototype.exec = function exec(this: RegExp, input: string): RegExpExecArray | null {
    const from = this.global || this.sticky ? this.lastIndex : 0;
    const match = originalExec.call(this, input);

    work += (match ? match.index + match[0].length : input.length) - from;

    if (work > cap) {
      throw new WorkCapReached();
    }

    return match;
  };

  try {
    tokenize();
  } catch (error) {
    if (!(error instanceof WorkCapReached)) {
      throw error;
    }

    return Infinity;
  } finally {
    RegExp.prototype.exec = originalExec;
  }

  return work;
};

const growth = async (language: string, unit: string): Promise<number> => {
  const hl = createHighlighter();

  await createGrammarLoader(hl, { base: BASE_GRAMMARS, optional: true })(language);

  const grammar = hl.languages[language];
  const line = (n: number): string => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
  const small = regexWork(() => hl.tokenize(line(N), grammar));
  // The cap only stops a quadratic run early; it is above the asserted bound.
  const large = regexWork(() => hl.tokenize(line(4 * N), grammar), (MAX_GROWTH + 1) * small);

  return large / small;
};

describe('engine work grows linearly on runs of quotes and marks', () => {
  it.each([
    ['rust', '"\''],
    ['rust', '\'"'],
    ['javascript', '\'"`'],
    ['javascript', '`\''],
    ['python', '\'"""'],
    ['c', '"\''],
    ['cpp', '"\''],
    ['go', '"\'`'],
    ['php', '"\''],
    ['sql', '"\'`'],
    ['scala', '"\''],
    ['markdown', '`*_'],
  ])('%s: %j', async (language, unit) => {
    expect(await growth(language, unit)).toBeLessThanOrEqual(MAX_GROWTH);
  });
});
