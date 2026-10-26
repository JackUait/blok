import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { compileFormula, evaluateFormula } from '../../../../../src/tools/database/formula';
import type { PropertyDefinition } from '../../../../../src/tools/database/types';
import { row, run, schema } from './helpers';

const longText = (length: number): string => `"${'a'.repeat(length)}"`;

const elapsed = (source: string): { value: unknown; ms: number } => {
  const begin = performance.now();
  const value = run(source);

  return { value, ms: performance.now() - begin };
};

describe('formula limits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('text and list size', () => {
    it.each([
      'repeat("ab", 1000000000)',
      'repeat("a", 10001)',
      'padStart("7", 1000000000)',
      'padEnd("7", 1000000000, "0")',
      'join(split(repeat("a", 5000), ""), repeat("-", 5000))',
      'replaceAll(repeat("a", 5000), "", repeat("b", 5000))',
      'replaceAll(repeat("a", 5000), "a", "$&$&$&")',
      'format(map(split(repeat("a", 2000), ""), repeat(current, 2000)))',
    ])('%s reads empty instead of growing past the cap', (source) => {
      expect(run(source)).toBeNull();
    });

    it('reads two long texts joined with + as empty', () => {
      expect(run('prop("Notes") + prop("Notes")', { properties: { notes: 'a'.repeat(6000) } })).toBeNull();
    });

    it('keeps text up to the cap', () => {
      expect(run('repeat("a", 10000)')).toBe('a'.repeat(10000));
      expect(run('padStart("7", 10000, "0")')).toHaveLength(10000);
    });

    it('does not charge a lookup for the whole list it reads', () => {
      expect(run('lets(xs, split(repeat("a", 2000), ""), length(map(xs, at(xs, index) + first(xs) + last(xs))))')).toBe(2000);
    });

    it('stops a nested loop that would do too much work', () => {
      const { value, ms } = elapsed('length(map(split(repeat("a", 5000), ""), length(filter(split(repeat("b", 5000), ""), current == "b"))))');

      expect(value).toBeNull();
      expect(ms).toBeLessThan(2000);
    });
  });

  describe('regular expressions', () => {
    it.each([
      'test("aaa", "(a+)+$")',
      'test("aaa", "(a*)*b")',
      'test("aaa", "(a|aa)+$")',
      'test("aa", "(a)\\\\1")',
      'test("aa", "(?=a)a")',
      'test("aa", "(?<!b)a")',
      'match("aaa", "(\\\\w+\\\\s?)*$")',
    ])('%s reads empty: the pattern can take too long', (source) => {
      expect(run(source)).toBeNull();
    });

    it('reads a very long pattern as empty', () => {
      expect(run(`test("a", "${'a'.repeat(1001)}")`)).toBeNull();
    });

    it('refuses a backtracking pattern on a long text quickly', () => {
      const { value, ms } = elapsed(`test(${longText(5000)} + "b", "a*a*a*$")`);

      expect(value).toBeNull();
      expect(ms).toBeLessThan(500);
    });

    it.each([
      ['test("12-34", "^\\\\d+-\\\\d+$")', true],
      ['match("a1 b2 c3", "[a-z]\\\\d")', ['a1', 'b2', 'c3']],
      ['replaceAll("2024-05-06", "(?<y>\\\\d+)-(\\\\d+)", "$2/$<y>")', '05/2024-06'],
      ['test("x(y)", "\\\\(y\\\\)")', true],
      ['test("a{b", "a{b")', true],
      ['replaceAll("a,b,c", "[,]", "$&$&")', 'a,,b,,c'],
    ])('%s still works', (source, expected) => {
      expect(run(source)).toEqual(expected);
    });

    it('runs a+ on a text at the cap', () => {
      expect(run('test(prop("Notes"), "a+")', { properties: { notes: 'a'.repeat(10000) } })).toBe(true);
    });
  });

  describe('formula source', () => {
    it.each([
      ['a deeply nested formula', `${'('.repeat(300)}1${')'.repeat(300)}`],
      ['a long operator chain', Array(400).fill('1').join(' + ')],
      ['a deep unary chain', `${'-'.repeat(300)}1`],
      ['a deep list', `${'['.repeat(300)}${']'.repeat(300)}`],
      ['a long method chain', `"a"${'.lower()'.repeat(300)}`],
      ['a very long formula', `${longText(20000)}`],
    ])('%s fails to compile with tooComplex', (_, source) => {
      const result = compileFormula(source, schema);

      expect(result.ok ? 'compiled' : result.error.code).toBe('tooComplex');
    });

    it('keeps a formula nested exactly to the cap', () => {
      expect(run(`${'('.repeat(63)}1${')'.repeat(63)}`)).toBe(1);
      expect(run(Array(64).fill('1').join(' + '))).toBe(64);
      expect(run(`${'-'.repeat(63)}1`)).toBe(-1);
      expect(run(`"A"${'.lower()'.repeat(63)}`)).toBe('a');
    });

    it('fails one level past the cap', () => {
      const result = compileFormula(`${'('.repeat(64)}1${')'.repeat(64)}`, schema);

      expect(result.ok ? 'compiled' : result.error.code).toBe('tooComplex');
    });

    it('does not overflow the stack on extreme nesting', () => {
      const result = compileFormula(`${'('.repeat(100000)}1`, schema);

      expect(result.ok ? 'compiled' : result.error.code).toBe('tooComplex');
    });
  });

  describe('a stack that runs out', () => {
    const chained: PropertyDefinition[] = [...schema, { id: 'next', name: 'Next', type: 'formula', position: 'c0', formula: { expression: '1' } }];
    const overflow = (): never => {
      throw new RangeError('Maximum call stack size exceeded');
    };

    it('reads empty when a chained formula overflows the stack', () => {
      const compiled = compileFormula('prop("Next") + 1', chained, { typeOf: () => ({ kind: 'number' }) });

      if (!compiled.ok) throw new Error(compiled.error.message);

      expect(evaluateFormula(compiled.formula, row(), { now: new Date(0), schema: chained, propValue: overflow })).toBeNull();
    });

    it('fails to compile with tooComplex when a chained formula overflows the stack', () => {
      const result = compileFormula('prop("Next") + 1', chained, { typeOf: overflow });

      expect(result.ok ? 'compiled' : result.error.code).toBe('tooComplex');
    });
  });
});
