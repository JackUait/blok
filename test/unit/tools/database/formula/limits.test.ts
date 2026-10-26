import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { compileFormula, evaluateFormula } from '../../../../../src/tools/database/formula';
import type { PropertyDefinition } from '../../../../../src/tools/database/types';
import { DOC_NOW, row, run, schema } from './helpers';

const longText = (length: number): string => `"${'a'.repeat(length)}"`;

/** The value, and whether the evaluation hit a cap. */
const evaluated = (source: string, properties: Record<string, string> = {}): { value: unknown; limited: boolean; ms: number } => {
  const compiled = compileFormula(source, schema);

  if (!compiled.ok) throw new Error(`${source}: ${compiled.error.message}`);
  const onLimit = vi.fn();
  const begin = performance.now();
  const value = evaluateFormula(compiled.formula, row(properties), { now: new Date(DOC_NOW), timeZone: 'UTC', schema, onLimit });

  return { value, limited: onLimit.mock.calls.length > 0, ms: performance.now() - begin };
};

const compileCode = (source: string): string => {
  const result = compileFormula(source, schema);

  return result.ok ? 'compiled' : result.error.code;
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
    ])('%s reports a limit instead of growing past the cap', (source) => {
      expect(evaluated(source)).toMatchObject({ limited: true, value: null });
    });

    it('reports a limit for two long texts joined with +', () => {
      expect(evaluated('prop("Notes") + prop("Notes")', { notes: 'a'.repeat(6000) })).toMatchObject({ limited: true, value: null });
    });

    it('keeps text up to the cap', () => {
      expect(evaluated('repeat("a", 10000)')).toMatchObject({ limited: false, value: 'a'.repeat(10000) });
      expect(run('padStart("7", 10000, "0")')).toHaveLength(10000);
    });

    it('does not charge a lookup for the whole list it reads', () => {
      expect(run('lets(xs, split(repeat("a", 2000), ""), length(map(xs, at(xs, index) + first(xs) + last(xs))))')).toBe(2000);
    });

    it('stops a nested loop that would do too much work', () => {
      const { limited, ms } = evaluated('length(map(split(repeat("a", 5000), ""), length(filter(split(repeat("b", 5000), ""), current == "b"))))');

      expect(limited).toBe(true);
      expect(ms).toBeLessThan(2000);
    });
  });

  describe('regular expressions', () => {
    it.each([
      'test("aaa", "(a+)+$")',
      'test("aaa", "(a*)*b")',
      'test("aa", "(a)\\\\1")',
      'test("aa", "(?=a)a")',
      'test("aa", "(?<!b)a")',
      'match("aaa", "(\\\\w+\\\\s?)*$")',
      'replace("aa", "(a)\\\\1", "b")',
    ])('%s fails to compile: the pattern could run without bound', (source) => {
      expect(compileCode(source)).toBe('patternTooComplex');
    });

    it('fails to compile a very long literal pattern', () => {
      expect(compileCode(`test("a", "${'a'.repeat(1001)}")`)).toBe('patternTooComplex');
    });

    it('reports a limit for a pattern built at run time that could run without bound', () => {
      expect(evaluated('test("aaa", "(a+" + ")+$")')).toMatchObject({ limited: true, value: null });
    });

    it('reports a limit for a backtracking pattern on a long text, quickly', () => {
      const { limited, ms } = evaluated(`test(${longText(5000)} + "b", "a*a*a*$")`);

      expect(limited).toBe(true);
      expect(ms).toBeLessThan(500);
    });

    it.each([
      ['(a|aa)+$', 'a'],
      ['(a|a)+$', 'a'],
      ['a*a*a*a*a*b', 'a'],
    ])('runs %s on a short text, and fails fast on a long one', (pattern, unit) => {
      expect(evaluated(`test("${unit.repeat(3)}", "${pattern}")`)).toMatchObject({ limited: false });

      expect(evaluated(`test("${unit.repeat(30)}!", "${pattern}")`).ms).toBeLessThan(100);
    });

    it('reports a limit for a repeated choice that overlaps on a long text', () => {
      expect(evaluated(`test("${'a'.repeat(30)}!", "(a|a)+$")`)).toMatchObject({ limited: true, value: null });
    });

    it.each([
      ['test("12-34", "^\\\\d+-\\\\d+$")', true],
      ['match("a1 b2 c3", "[a-z]\\\\d")', ['a1', 'b2', 'c3']],
      ['replaceAll("2024-05-06", "(?<y>\\\\d+)-(\\\\d+)", "$2/$<y>")', '05/2024-06'],
      ['test("x(y)", "\\\\(y\\\\)")', true],
      ['test("a{b", "a{b")', true],
      ['replaceAll("a,b,c", "[,]", "$&$&")', 'a,,b,,c'],
      ['test("foobarfoo", "^(foo|bar)+$")', true],
      ['replaceAll("foo bar baz", "(foo|bar)+", "x")', 'x x baz'],
      ['test("aaa", "(a|aa)+$")', true],
    ])('%s still works', (source, expected) => {
      expect(run(source)).toEqual(expected);
    });

    it('runs (foo|bar)+ over a long text', () => {
      expect(evaluated('test(prop("Notes"), "^(foo|bar)+$")', { notes: 'foobar'.repeat(1000) })).toMatchObject({ limited: false, value: true });
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

    const compiledNext = (): Parameters<typeof evaluateFormula>[0] => {
      const compiled = compileFormula('prop("Next") + 1', chained, { typeOf: () => ({ kind: 'number' }) });

      if (!compiled.ok) throw new Error(compiled.error.message);

      return compiled.formula;
    };

    it('reports a limit when a chained formula overflows the stack', () => {
      const onLimit = vi.fn();

      expect(evaluateFormula(compiledNext(), row(), { now: new Date(0), schema: chained, propValue: overflow, onLimit })).toBeNull();
      expect(onLimit).toHaveBeenCalledTimes(1);
    });

    it('lets any other RangeError through, such as an invalid time zone', () => {
      const badZone = (): never => {
        throw new RangeError('Invalid time zone specified: Mars/Base');
      };

      expect(() => evaluateFormula(compiledNext(), row(), { now: new Date(0), schema: chained, propValue: badZone })).toThrow(RangeError);
    });

    it('lets any other RangeError out of compiling', () => {
      const badZone = (): never => {
        throw new RangeError('Invalid time zone specified: Mars/Base');
      };

      expect(() => compileFormula('prop("Next") + 1', chained, { typeOf: badZone })).toThrow(RangeError);
    });

    it('fails to compile with tooComplex when a chained formula overflows the stack', () => {
      const result = compileFormula('prop("Next") + 1', chained, { typeOf: overflow });

      expect(result.ok ? 'compiled' : result.error.code).toBe('tooComplex');
    });
  });
});
