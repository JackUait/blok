import { FUNCTIONS, paramMismatch } from '../../shared/database/formula/functions';
import type { ParamSpec } from '../../shared/database/formula/functions';
import type { FormulaType } from './formula';

export interface FormulaFunctionGroup {
  /** The heading's i18n key. */
  labelKey: string;
  names: readonly string[];
}

/**
 * notion-spec-2 §25.1 (`formula-empty.txt`): General, Text, Number and Date, in Notion's
 * order, keeping only what Blok's engine runs. `not` is the unary operator, written as a call.
 * The groups after Date are Blok's: Notion's are unmeasured.
 */
export const FORMULA_FUNCTION_GROUPS: readonly FormulaFunctionGroup[] = [
  {
    labelKey: 'tools.database.formulaGroupGeneral',
    names: ['if', 'ifs', 'and', 'or', 'not', 'empty', 'length', 'format', 'equal', 'unequal', 'let', 'lets'],
  },
  {
    labelKey: 'tools.database.propertyTypeText',
    names: [
      'substring', 'contains', 'test', 'match', 'replace', 'replaceAll', 'lower', 'upper', 'trim', 'repeat',
      'padStart', 'padEnd', 'link', 'style', 'unstyle', 'concat', 'join', 'split',
    ],
  },
  {
    labelKey: 'tools.database.propertyTypeNumber',
    names: [
      'formatNumber', 'add', 'subtract', 'multiply', 'mod', 'pow', 'divide', 'min', 'max', 'sum', 'median', 'mean',
      'abs', 'round', 'ceil', 'floor', 'sqrt', 'cbrt', 'exp', 'ln', 'log10', 'log2', 'sign', 'pi', 'e', 'toNumber',
    ],
  },
  {
    labelKey: 'tools.database.propertyTypeDate',
    names: [
      'now', 'today', 'minute', 'hour', 'day', 'date', 'week', 'month', 'year', 'dateAdd', 'dateSubtract',
      'dateBetween', 'dateRange', 'dateStart', 'dateEnd', 'timestamp', 'fromTimestamp', 'formatDate', 'parseDate',
    ],
  },
  {
    labelKey: 'tools.database.formulaGroupPeople',
    names: ['name', 'email', 'id'],
  },
  {
    labelKey: 'tools.database.formulaGroupLists',
    names: [
      'at', 'first', 'last', 'slice', 'sort', 'reverse', 'unique', 'includes',
      'find', 'findIndex', 'filter', 'some', 'every', 'map', 'flat',
    ],
  },
];

/** The first argument of the special forms. `if`, `ifs`, `let` and `lets` take none a value can fill. */
const SPECIAL_FIRST: Record<string, ParamSpec | undefined> = {
  and: 'any', or: 'any', not: 'any',
  find: 'list', findIndex: 'list', filter: 'list', some: 'list', every: 'list', map: 'list',
};

/**
 * notion-spec-2 §25.1 (`formula-typed.txt`): after `Number * 2` General lists only
 * and, or, not, empty, format, equal and unequal, the functions whose first
 * argument takes a number. A function with no argument never fits.
 */
export const fitsAfter = (name: string, type: FormulaType): boolean => {
  const def = FUNCTIONS[name] as typeof FUNCTIONS[string] | undefined;
  const first = def === undefined ? SPECIAL_FIRST[name] : def.params[0] ?? def.optional?.[0] ?? def.rest;

  return first !== undefined && paramMismatch(first, type, undefined) === undefined;
};
