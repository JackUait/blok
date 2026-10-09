import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { compileFormula, FORMULA_ERROR_CODES } from '../../../../../src/tools/database/formula';
import type { FormulaError } from '../../../../../src/tools/database/formula';
import en from '../../../../../src/components/i18n/locales/en.json';
import { schema } from './helpers';

const errorOf = (source: string): FormulaError => {
  const result = compileFormula(source, schema);

  if (result.ok) throw new Error(`${source} compiled`);

  return result.error;
};

describe('formula error codes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['1 # 2', 'unexpectedCharacter', { char: '#' }],
    ['/* open', 'unterminatedComment', {}],
    ['"open', 'unterminatedString', {}],
    ['1 2', 'unexpectedToken', { token: '2' }],
    ['(1', 'expectedToken', { token: ')' }],
    ['1 +', 'unexpectedEnd', {}],
    ['prop(1)', 'propNeedsName', {}],
    ['prop("Nope")', 'unknownProperty', { name: 'Nope' }],
    ['-"a"', 'negateNotNumber', { type: 'Text' }],
    ['current', 'lambdaKeywordOutside', { name: 'current' }],
    ['foo', 'unknownVariable', { name: 'foo' }],
    ['if(true, 1, "a")', 'branchTypesDiffer', { a: 'Number', b: 'Text' }],
    ['true > 1', 'cannotCompare', { a: 'Boolean', b: 'Number' }],
    ['true + 1', 'cannotAdd', { a: 'Boolean', b: 'Number' }],
    ['"a" * 2', 'operatorNotNumber', { op: '*', type: 'Text' }],
    ['nope(1)', 'unknownFunction', { name: 'nope' }],
    ['abs(1, 2)', 'argumentCount', { name: 'abs', count: 1, got: 2 }],
    ['round()', 'argumentCountRange', { name: 'round', min: 1, max: 2, got: 0 }],
    ['and(true)', 'argumentCountAtLeast', { name: 'and', min: 2, got: 1 }],
    ['abs("a")', 'argumentType', { name: 'abs', index: 1, expected: 'Number', got: 'Text' }],
    ['concat([1], ["a"])', 'cannotConcat', { a: 'Number (list)', b: 'Text (list)' }],
    ['let(1, 2, 3)', 'bindingName', { name: 'let', index: 1 }],
    ['ifs(true, 1)', 'pairedArguments', { name: 'ifs' }],
    ['map(1, current)', 'listExpected', { name: 'map', type: 'Number' }],
    ['filter([1], current)', 'conditionNotBoolean', { name: 'filter', type: 'Number' }],
  ])('%s fails with %s', (source, code, params) => {
    const error = errorOf(source);

    expect(error.code).toBe(code);
    expect(error.params).toEqual(params);
    expect(error.end).toBeGreaterThanOrEqual(error.start);
  });

  it('has an English string for every code', () => {
    const strings = en as Record<string, string>;
    const missing = FORMULA_ERROR_CODES.filter((code) => strings[`tools.database.formula.error.${code}`] === undefined);

    expect(missing).toEqual([]);
  });

  it('names every placeholder of a code in its English string', () => {
    const strings = en as Record<string, string>;

    for (const [source, code, params] of [['abs("a")', 'argumentType', ['name', 'index', 'expected', 'got']]] as const) {
      expect(errorOf(source).code).toBe(code);
      for (const param of params) {
        expect(strings[`tools.database.formula.error.${code}`]).toContain(`{${param}}`);
      }
    }
  });
});
