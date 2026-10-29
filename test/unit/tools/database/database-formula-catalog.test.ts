import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FORMULA_FUNCTION_GROUPS, FORMULA_HELP, FORMULA_OPERATORS, FORMULA_VALUES, propertyExamples,
} from '../../../../src/tools/database/database-formula-catalog';
import { FORMULA_FUNCTION_NAMES, compileFormula, evaluateFormula, formulaValueToText } from '../../../../src/tools/database/formula';
import type { FormulaValue } from '../../../../src/tools/database/formula';
import type { DatabaseRow, PropertyDefinition } from '../../../../src/tools/database/types';

const schema: PropertyDefinition[] = [{ id: 'owner', name: 'Owner', type: 'person', position: 'a0' }];
const row: DatabaseRow = { id: 'row', position: 'a0', properties: {} };

/** How the help pane writes a result: text in quotes, lists in brackets, dates as a cell shows them. */
const written = (value: FormulaValue, timeZone: string): string | undefined => {
  if (value === null) return undefined;
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map((item) => written(item, timeZone)).join(', ')}]`;
  if (value.kind === 'date') return formulaValueToText(value, { timeZone });

  return undefined;
};

/** A result that depends on the clock, the row or rich text cannot be written down. */
const UNWRITABLE = /\b(?:now|today|id|prop|link|style)\(/;

const rows = [
  ...FORMULA_OPERATORS.map(([op]) => op),
  ...FORMULA_VALUES.map(([word]) => word),
  ...FORMULA_FUNCTION_GROUPS.flatMap((group) => group.names.map((name) => `${name}()`)),
];

describe('formula function catalogue', () => {
  it('lists every function the engine runs exactly once, plus not()', () => {
    const listed = FORMULA_FUNCTION_GROUPS.flatMap((group) => group.names);

    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...FORMULA_FUNCTION_NAMES.filter((name) => name !== 'prop'), 'not'].sort());
  });

  it('describes every row of the list with an English sentence and two examples', () => {
    const english = JSON.parse(readFileSync(resolve(__dirname, '../../../../src/components/i18n/locales/en.json'), 'utf-8')) as Record<string, string>;

    expect(Object.keys(FORMULA_HELP).sort()).toEqual([...rows].sort());
    for (const name of rows) {
      expect(english[FORMULA_HELP[name].key], name).toMatch(/^\S.*\.$/);
      expect(FORMULA_HELP[name].examples, name).toHaveLength(2);
    }
  });

  // The results are static text: each must be what the engine gives, in any time zone.
  it.each(rows)('gives %s examples that compile and read their stated result', (name) => {
    for (const { code, result } of FORMULA_HELP[name].examples) {
      const compiled = compileFormula(code, schema);

      if (!compiled.ok) throw new Error(`${code}: ${compiled.error.code}`);
      const read = (timeZone: string): string | undefined =>
        written(evaluateFormula(compiled.formula, row, { now: new Date('2026-10-30T12:00:00Z'), timeZone, schema }), timeZone);

      if (result === undefined) {
        expect(code, `${code} needs a result`).toMatch(UNWRITABLE);
        continue;
      }
      expect(['UTC', 'America/Los_Angeles', 'Asia/Tokyo'].map(read), code).toEqual([result, result, result]);
    }
  });

  // `30-formula-empty.png`: a Number property's help shows it alone, halved, and as a circle's area.
  it('gives a number property three examples that compile to a number', () => {
    const numbers: PropertyDefinition[] = [{ id: 'n', name: 'Number', type: 'number', position: 'a0' }];
    const examples = propertyExamples(numbers[0]);

    expect(examples.map((example) => example.code)).toEqual(['prop("Number")', 'prop("Number") / 2', 'pi() * prop("Number") ^ 2']);
    for (const { code } of examples) {
      const compiled = compileFormula(code, numbers);

      expect(compiled.ok && compiled.resultType.kind, code).toBe('number');
    }
  });

  it('gives any other property one example: the property itself', () => {
    expect(propertyExamples(schema[0])).toEqual([{ code: 'prop("Owner")' }]);
  });
});
