import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { compileError, run, text } from './helpers';

describe('formula math, operators and logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('operators (help: Built-ins)', () => {
    it.each([
      ['2 * pi()', 2 * Math.PI],
      ['5 + 10', 15],
      ['5 - 10', -5],
      ['5 * 10', 50],
      ['5 % 10', 5],
      ['5 ^ 10', 9765625],
      ['5 / 10', 0.5],
      ['1 + 2 * 3', 7],
      ['(1 + 2) * 3', 9],
      ['2 ^ 3 ^ 2', 512],
      ['-2 ^ 2', -4],
      ['10 - 4 - 3', 3],
    ])('%s = %s', (source, expected) => {
      expect(run(source)).toBe(expected);
    });

    it('joins text with +', () => {
      expect(run('"hello" + "world"')).toBe('helloworld');
    });

    it('joins text with a number as in the ifs() progress example', () => {
      expect(run('"In progress (" + 50 + ")%"')).toBe('In progress (50)%');
    });

    it.each([
      ['123 == 123', true],
      ['"Notion" == "Motion"', false],
      ['2 > 1', true],
      ['2 >= 2', true],
      ['1 < 1', false],
      ['1 <= 1', true],
      ['"a" != "a"', false],
      ['1 !== 2', true],
      ['"b" > "a"', true],
      ['[1, 2] == [1, 2]', true],
    ])('%s is %s', (source, expected) => {
      expect(run(source)).toBe(expected);
    });

    it.each([
      ['true and false', false],
      ['true && false', false],
      ['and(true, false)', false],
      ['true or false', true],
      ['true || false', true],
      ['or(true, false)', true],
      ['not true', false],
      ['!true', false],
      ['not 0', true],
    ])('%s is %s', (source, expected) => {
      expect(run(source)).toBe(expected);
    });

    it('evaluates the ternary like if()', () => {
      expect(run('true ? "Complete" : "Incomplete"')).toBe('Complete');
      expect(run('false ? 1 : 2')).toBe(2);
    });
  });

  describe('if / ifs', () => {
    it.each([
      ['if(true, 1, 2)', 1],
      ['if(false, 1, 2)', 2],
      ['ifs(true, 1, true, 2, 3)', 1],
      ['ifs(false, 1, false, 2, 3)', 3],
      ['ifs(false, 1, true, 2, 3)', 2],
    ])('%s = %s', (source, expected) => {
      expect(run(source)).toBe(expected);
    });

    it('treats empty values as false in a condition', () => {
      expect(run('if("", 1, 2)')).toBe(2);
      expect(run('if([], 1, 2)')).toBe(2);
      expect(run('if(prop("Due"), 1, 2)')).toBe(2);
      expect(run('if(prop("Due"), 1, 2)', { properties: { due: '2024-01-01' } })).toBe(1);
    });
  });

  describe('equal / unequal', () => {
    it.each([
      ['equal(1, 1)', true],
      ['"a" == "b"', false],
      ['unequal(1, 2)', true],
      ['unequal("a", "a")', false],
    ])('%s is %s', (source, expected) => {
      expect(run(source)).toBe(expected);
    });
  });

  describe('math functions (help: Functions)', () => {
    it.each([
      ['add(5, 10)', 15],
      ['subtract(5, 10)', -5],
      ['multiply(5, 10)', 50],
      ['mod(5, 10)', 5],
      ['pow(5, 10)', 9765625],
      ['divide(5, 10)', 0.5],
      ['min(1, 2, 3)', 1],
      ['min([1, 2, 3])', 1],
      ['max(1, 2, 3)', 3],
      ['max([1, 2, 3])', 3],
      ['sum(1, 2, 3)', 6],
      ['sum([1, 2, 3], 4, 5)', 15],
      ['median(1, 2, 4)', 2],
      ['median([1, 2, 3], 4)', 2.5],
      ['mean(1, 2, 3)', 2],
      ['mean([1, 2, 3], 4, 5)', 3],
      ['abs(10)', 10],
      ['abs(-10)', 10],
      ['round(0.4)', 0],
      ['round(-0.6)', -1],
      ['round(1.234, 0)', 1],
      ['round(1.234, 2)', 1.23],
      ['round(1234, -2)', 1200],
      ['round(1.005, 2)', 1.01],
      ['ceil(0.4)', 1],
      ['ceil(-0.6)', 0],
      ['floor(0.4)', 0],
      ['floor(-0.6)', -1],
      ['sqrt(4)', 2],
      ['sqrt(7)', 2.6457513110645907],
      ['cbrt(9)', 2.080083823051904],
      ['cbrt(64)', 4],
      ['exp(1)', 2.718281828459045],
      ['exp(-1)', 0.36787944117144233],
      ['ln(2.718281828459045)', 1],
      ['ln(10)', 2.302585092994046],
      ['log10(10)', 1],
      ['log10(100000)', 5],
      ['log2(4)', 2],
      ['log2(1024)', 10],
      ['sign(-10)', -1],
      ['sign(10)', 1],
      ['sign(0)', 0],
      ['pi()', 3.141592653589793],
      ['e()', 2.718281828459045],
      ['let(radius, 4, round(pi() * radius ^ 2))', 50],
    ])('%s = %s', (source, expected) => {
      expect(run(source)).toBe(expected);
    });

    it('never returns negative zero', () => {
      expect(Object.is(run('ceil(-0.6)'), 0)).toBe(true);
      expect(Object.is(run('round(-0.4)'), 0)).toBe(true);
      expect(Object.is(run('0 * -1'), 0)).toBe(true);
    });

    it('turns a non-finite result into empty', () => {
      expect(run('1 / 0')).toBeNull();
      expect(run('sqrt(-1)')).toBeNull();
      expect(run('mod(1, 0)')).toBeNull();
    });

    it('returns empty for min/max/median/mean of nothing and 0 for sum of nothing', () => {
      expect(run('min([])')).toBeNull();
      expect(run('mean([])')).toBeNull();
      expect(run('sum([])')).toBe(0);
    });
  });

  describe('empty / length / format / toNumber', () => {
    it.each([
      ['empty(0)', true],
      ['empty([])', true],
      ['empty("")', true],
      ['empty(1)', false],
      ['empty("a")', false],
      ['empty(empty())', true],
      ['length("hello")', 5],
      ['length([1, 2, 3])', 3],
      ['"hello".length()', 5],
      ['toNumber("2")', 2],
      ['toNumber(true)', 1],
      ['toNumber(false)', 0],
      ['toNumber(5)', 5],
      ['toNumber(now())', 1693443300000],
    ])('%s = %s', (source, expected) => {
      expect(run(source)).toEqual(expected);
    });

    it('returns empty from toNumber for text that is not a number', () => {
      expect(run('toNumber("abc")')).toBeNull();
    });

    it.each([
      ['format(1234)', '1234'],
      ['format(0.1 + 0.2)', '0.30000000000000004'],
      ['format(true)', 'true'],
      ['format("x")', 'x'],
      ['format([1, "a"])', '1, a'],
      ['format(empty())', ''],
      ['format(-0)', '0'],
    ])('%s = %s', (source, expected) => {
      expect(run(source)).toBe(expected);
    });

    it('counts characters, not UTF-16 units', () => {
      expect(run('length("😀a")')).toBe(2);
    });
  });

  describe('let / lets', () => {
    it.each([
      ['let(person, "Alan", "Hello, " + person + "!")', 'Hello, Alan!'],
      ['lets(a, "Hello", b, "world", a + " " + b)', 'Hello world'],
      ['lets(base, 3, height, 8, base * height / 2)', 12],
      ['lets(a, 2, b, a * 3, b)', 6],
      ['let(x, 1, let(x, 2, x))', 2],
    ])('%s = %s', (source, expected) => {
      expect(run(source)).toBe(expected);
    });
  });

  describe('compile errors', () => {
    it.each([
      ['1 + true', 'Operator "+" cannot combine Number and Boolean'],
      ['"a" - 1', 'Operator "-" expects Number, got Text'],
      ['-"a"', 'Operator "-" expects Number, got Text'],
      ['abs(1, 2)', 'abs() takes 1 argument, got 2'],
      ['round("a")', 'Argument 1 of round() expects Number, got Text'],
      ['larger(1, 2)', 'Unknown function "larger"'],
      ['largerEq(1, 2)', 'Unknown function "largerEq"'],
      ['smaller(1, 2)', 'Unknown function "smaller"'],
      ['smallerEq(1, 2)', 'Unknown function "smallerEq"'],
      ['foo', 'Unknown variable "foo"'],
      ['if(true, 1, "a")', 'if() branches return different types: Number and Text'],
      ['ifs(true, 1)', 'ifs() takes conditions and values in pairs, then a fallback value'],
      ['let(1, 2, 3)', 'let() needs a variable name as argument 1'],
      ['lets(a, 1, b, 2)', 'lets() takes names and values in pairs, then an expression'],
      ['1 > "a"', 'Cannot compare Number with Text'],
      ['true > false', 'Cannot compare Boolean with Boolean'],
      ['sum("a")', 'Argument 1 of sum() expects Number, got Text'],
    ])('%s fails with "%s"', (source, message) => {
      expect(compileError(source)).toBe(message);
    });

    it('accepts empty() in either branch of if()', () => {
      expect(compileError('if(true, 1, empty())')).toBe('compiled');
    });
  });

  describe('number formatting of results', () => {
    it('prints numbers as JavaScript does', () => {
      expect(text('1 / 3')).toBe('0.3333333333333333');
      expect(text('1234567')).toBe('1234567');
    });
  });
});
