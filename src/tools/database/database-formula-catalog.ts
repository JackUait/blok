import { FUNCTIONS, paramMismatch } from '../../shared/database/formula/functions';
import type { ParamSpec } from '../../shared/database/formula/functions';
import type { FormulaType } from './formula';
import type { PropertyDefinition } from './types';

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

/**
 * notion-spec-2 §25.1 (`32-formula-typed.png`): Built-ins after an operand, # for
 * arithmetic and a checkbox for comparisons. `%` and `^` still parse; Notion lists neither.
 */
export const FORMULA_OPERATORS: ReadonlyArray<[string, 'number' | 'boolean']> = [
  ['*', 'number'], ['/', 'number'], ['+', 'number'], ['-', 'number'],
  ['>', 'boolean'], ['>=', 'boolean'], ['<', 'boolean'], ['<=', 'boolean'],
  ['==', 'boolean'], ['!=', 'boolean'],
];

/** notion-spec-2 §25.1 (`formula-empty.txt`): Built-ins of an empty formula, and what each inserts. */
export const FORMULA_VALUES: ReadonlyArray<[string, string]> = [['not', 'not '], ['true', 'true'], ['false', 'false']];

export interface FormulaExample {
  code: string;
  /** What the engine gives, as the pane writes it. None when it depends on the clock, the row or styling. */
  result?: string;
}

export interface FormulaHelp {
  /** The one-line description's i18n key. */
  key: string;
  examples: readonly FormulaExample[];
}

/** A property name as a formula string literal. */
export const quote = (name: string): string => `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * The help pane's examples for a property row. `30-formula-empty.png`: a Number property
 * shows itself, itself / 2 and pi() * itself ^ 2. Other types show only themselves: theirs are unmeasured.
 */
export const propertyExamples = (property: PropertyDefinition): FormulaExample[] => {
  const ref = `prop(${quote(property.name)})`;

  return property.type === 'number' ? [{ code: ref }, { code: `${ref} / 2` }, { code: `pi() * ${ref} ^ 2` }] : [{ code: ref }];
};

const help = (key: string, ...examples: Array<[string, string?]>): FormulaHelp => ({
  key,
  examples: examples.map(([code, result]) => (result === undefined ? { code } : { code, result })),
});

/**
 * notion-spec-2 §25.1 (`32-formula-typed.png`): the help pane gives a row a one-line
 * description and two examples, each with its result. The wording and the examples are
 * Blok's own; `database-formula-catalog.test.ts` checks every result against the engine.
 */
export const FORMULA_HELP: Readonly<Record<string, FormulaHelp>> = {
  '*': help('tools.database.formulaHelp.opMultiply', ['4 * 5', '20'], ['1.5 * 4', '6']),
  '/': help('tools.database.formulaHelp.opDivide', ['12 / 4', '3'], ['7 / 2', '3.5']),
  '+': help('tools.database.formulaHelp.opAdd', ['8 + 5', '13'], ['"Hello, " + "world"', '"Hello, world"']),
  '-': help('tools.database.formulaHelp.opSubtract', ['10 - 4', '6'], ['2 - 7', '-5']),
  '>': help('tools.database.formulaHelp.opGreater', ['9 > 4', 'true'], ['2 > 2', 'false']),
  '>=': help('tools.database.formulaHelp.opGreaterEqual', ['5 >= 5', 'true'], ['3 >= 8', 'false']),
  '<': help('tools.database.formulaHelp.opLess', ['1 < 2', 'true'], ['"b" < "a"', 'false']),
  '<=': help('tools.database.formulaHelp.opLessEqual', ['4 <= 4', 'true'], ['6 <= 1', 'false']),
  '==': help('tools.database.formulaHelp.opEqual', ['2 + 2 == 4', 'true'], ['"a" == "A"', 'false']),
  '!=': help('tools.database.formulaHelp.opNotEqual', ['3 != 4', 'true'], ['"x" != "x"', 'false']),
  'not': help('tools.database.formulaHelp.not', ['not true', 'false'], ['not (3 > 5)', 'true']),
  'true': help('tools.database.formulaHelp.valueTrue', ['true', 'true'], ['if(true, "on", "off")', '"on"']),
  'false': help('tools.database.formulaHelp.valueFalse', ['false', 'false'], ['false or true', 'true']),
  'if()': help('tools.database.formulaHelp.if', ['if(5 > 3, "big", "small")', '"big"'], ['if(empty(""), 0, 1)', '0']),
  'ifs()': help('tools.database.formulaHelp.ifs', ['ifs(1 > 2, "a", 2 > 1, "b", "c")', '"b"'], ['ifs(false, 1, 9)', '9']),
  'and()': help('tools.database.formulaHelp.and', ['and(1 < 2, 3 < 4)', 'true'], ['and(true, false)', 'false']),
  'or()': help('tools.database.formulaHelp.or', ['or(1 > 2, 3 > 2)', 'true'], ['or(false, false)', 'false']),
  'empty()': help('tools.database.formulaHelp.empty', ['empty("")', 'true'], ['empty([1, 2])', 'false']),
  'length()': help('tools.database.formulaHelp.length', ['length("Blok")', '4'], ['length([4, 5, 6])', '3']),
  'format()': help('tools.database.formulaHelp.format', ['format(42)', '"42"'], ['format(true)', '"true"']),
  'equal()': help('tools.database.formulaHelp.equal', ['equal(10, 5 * 2)', 'true'], ['equal("a", "b")', 'false']),
  'unequal()': help('tools.database.formulaHelp.unequal', ['unequal(1, 2)', 'true'], ['unequal("hi", "hi")', 'false']),
  'let()': help('tools.database.formulaHelp.let', ['let(x, 4, x * x)', '16'], ['let(word, "hey", upper(word))', '"HEY"']),
  'lets()': help('tools.database.formulaHelp.lets', ['lets(a, 2, b, 3, a + b)', '5'], ['lets(first, "Ada", last, "L", first + " " + last)', '"Ada L"']),
  'substring()': help('tools.database.formulaHelp.substring', ['substring("database", 0, 4)', '"data"'], ['substring("Blok", 1)', '"lok"']),
  'contains()': help('tools.database.formulaHelp.contains', ['contains("rich text", "text")', 'true'], ['contains("Blok", "z")', 'false']),
  'test()': help('tools.database.formulaHelp.test', ['test("Order 42", "[0-9]+")', 'true'], ['test("abc", "^b")', 'false']),
  'match()': help('tools.database.formulaHelp.match', ['match("a1b22c333", "[0-9]+")', '["1", "22", "333"]'], ['match("cat hat", "[ch]at")', '["cat", "hat"]']),
  'replace()': help('tools.database.formulaHelp.replace', ['replace("one two two", "two", "three")', '"one three two"'], ['replace("2026-10-30", "-", "/")', '"2026/10-30"']),
  'replaceAll()': help('tools.database.formulaHelp.replaceAll', ['replaceAll("2026-10-30", "-", "/")', '"2026/10/30"'], ['replaceAll("a b   c", " +", " ")', '"a b c"']),
  'lower()': help('tools.database.formulaHelp.lower', ['lower("HELLO")', '"hello"'], ['lower("Blok Editor")', '"blok editor"']),
  'upper()': help('tools.database.formulaHelp.upper', ['upper("hello")', '"HELLO"'], ['upper("Blok")', '"BLOK"']),
  'trim()': help('tools.database.formulaHelp.trim', ['trim("  tidy  ")', '"tidy"'], ['trim(" a b ")', '"a b"']),
  'repeat()': help('tools.database.formulaHelp.repeat', ['repeat("ab", 3)', '"ababab"'], ['repeat("-", 5)', '"-----"']),
  'padStart()': help('tools.database.formulaHelp.padStart', ['padStart("7", 3, "0")', '"007"'], ['padStart("abc", 5)', '"  abc"']),
  'padEnd()': help('tools.database.formulaHelp.padEnd', ['padEnd("7", 3, "0")', '"700"'], ['padEnd("ab", 4, ".")', '"ab.."']),
  'link()': help('tools.database.formulaHelp.link', ['link("Blok", "https://example.com")'], ['link("Mail us", "mailto:hi@example.com")']),
  'style()': help('tools.database.formulaHelp.style', ['style("Done", "b", "green")'], ['style("Note", "i")']),
  'unstyle()': help('tools.database.formulaHelp.unstyle', ['unstyle(style("Hi", "b"))', '"Hi"'], ['unstyle(style("Hi", "b", "red"), "b")']),
  'concat()': help('tools.database.formulaHelp.concat', ['concat([1, 2], [3])', '[1, 2, 3]'], ['concat(["a"], ["b"], ["c"])', '["a", "b", "c"]']),
  'join()': help('tools.database.formulaHelp.join', ['join(["a", "b", "c"], "-")', '"a-b-c"'], ['join([1, 2], ", ")', '"1, 2"']),
  'split()': help('tools.database.formulaHelp.split', ['split("red,green,blue", ",")', '["red", "green", "blue"]'], ['split("a b", " ")', '["a", "b"]']),
  'formatNumber()': help('tools.database.formulaHelp.formatNumber', ['formatNumber(0.25, "percent")', '"25%"'], ['formatNumber(9876543, "number_with_commas")', '"9,876,543"']),
  'add()': help('tools.database.formulaHelp.add', ['add(7, 8)', '15'], ['add(-2, 0.5)', '-1.5']),
  'subtract()': help('tools.database.formulaHelp.subtract', ['subtract(9, 4)', '5'], ['subtract(1, 3)', '-2']),
  'multiply()': help('tools.database.formulaHelp.multiply', ['multiply(6, 7)', '42'], ['multiply(0.5, 10)', '5']),
  'mod()': help('tools.database.formulaHelp.mod', ['mod(10, 3)', '1'], ['mod(8, 2)', '0']),
  'pow()': help('tools.database.formulaHelp.pow', ['pow(2, 5)', '32'], ['pow(9, 0.5)', '3']),
  'divide()': help('tools.database.formulaHelp.divide', ['divide(9, 3)', '3'], ['divide(1, 4)', '0.25']),
  'min()': help('tools.database.formulaHelp.min', ['min(4, 1, 7)', '1'], ['min([10, 3, 8])', '3']),
  'max()': help('tools.database.formulaHelp.max', ['max(4, 1, 7)', '7'], ['max([10, 3, 8])', '10']),
  'sum()': help('tools.database.formulaHelp.sum', ['sum(1, 2, 3)', '6'], ['sum([5, 5, 10])', '20']),
  'median()': help('tools.database.formulaHelp.median', ['median(3, 1, 2)', '2'], ['median([1, 2, 3, 4])', '2.5']),
  'mean()': help('tools.database.formulaHelp.mean', ['mean(2, 4, 6)', '4'], ['mean([1, 2])', '1.5']),
  'abs()': help('tools.database.formulaHelp.abs', ['abs(-8)', '8'], ['abs(3)', '3']),
  'round()': help('tools.database.formulaHelp.round', ['round(2.5)', '3'], ['round(3.14159, 2)', '3.14']),
  'ceil()': help('tools.database.formulaHelp.ceil', ['ceil(4.1)', '5'], ['ceil(-4.1)', '-4']),
  'floor()': help('tools.database.formulaHelp.floor', ['floor(4.9)', '4'], ['floor(-4.1)', '-5']),
  'sqrt()': help('tools.database.formulaHelp.sqrt', ['sqrt(81)', '9'], ['sqrt(0.25)', '0.5']),
  'cbrt()': help('tools.database.formulaHelp.cbrt', ['cbrt(27)', '3'], ['cbrt(-8)', '-2']),
  'exp()': help('tools.database.formulaHelp.exp', ['exp(0)', '1'], ['exp(1)', '2.718281828459045']),
  'ln()': help('tools.database.formulaHelp.ln', ['ln(1)', '0'], ['ln(e())', '1']),
  'log10()': help('tools.database.formulaHelp.log10', ['log10(1000)', '3'], ['log10(0.01)', '-2']),
  'log2()': help('tools.database.formulaHelp.log2', ['log2(8)', '3'], ['log2(1024)', '10']),
  'sign()': help('tools.database.formulaHelp.sign', ['sign(-12)', '-1'], ['sign(0)', '0']),
  'pi()': help('tools.database.formulaHelp.pi', ['pi()', '3.141592653589793'], ['round(pi(), 2)', '3.14']),
  'e()': help('tools.database.formulaHelp.e', ['e()', '2.718281828459045'], ['round(e(), 3)', '2.718']),
  'toNumber()': help('tools.database.formulaHelp.toNumber', ['toNumber("42")', '42'], ['toNumber(true)', '1']),
  'now()': help('tools.database.formulaHelp.now', ['now()'], ['formatDate(now(), "HH:mm")']),
  'today()': help('tools.database.formulaHelp.today', ['today()'], ['dateAdd(today(), 1, "days")']),
  'minute()': help('tools.database.formulaHelp.minute', ['minute(parseDate("2026-03-14T09:45"))', '45'], ['minute(parseDate("2026-03-14T10:00"))', '0']),
  'hour()': help('tools.database.formulaHelp.hour', ['hour(parseDate("2026-03-14T18:30"))', '18'], ['hour(parseDate("2026-03-14"))', '0']),
  'day()': help('tools.database.formulaHelp.day', ['day(parseDate("2026-03-14"))', '6'], ['day(parseDate("2026-03-16"))', '1']),
  'date()': help('tools.database.formulaHelp.date', ['date(parseDate("2026-03-14"))', '14'], ['date(parseDate("2026-12-31"))', '31']),
  'week()': help('tools.database.formulaHelp.week', ['week(parseDate("2026-03-14"))', '11'], ['week(parseDate("2026-01-01"))', '1']),
  'month()': help('tools.database.formulaHelp.month', ['month(parseDate("2026-03-14"))', '3'], ['month(parseDate("2026-12-31"))', '12']),
  'year()': help('tools.database.formulaHelp.year', ['year(parseDate("2026-03-14"))', '2026'], ['year(parseDate("1999-12-31"))', '1999']),
  'dateAdd()': help('tools.database.formulaHelp.dateAdd', ['dateAdd(parseDate("2026-03-14"), 2, "weeks")', 'March 28, 2026'], ['dateAdd(parseDate("2026-01-31"), 1, "months")', 'February 28, 2026']),
  'dateSubtract()': help('tools.database.formulaHelp.dateSubtract', ['dateSubtract(parseDate("2026-03-14"), 3, "days")', 'March 11, 2026'], ['dateSubtract(parseDate("2026-03-14"), 1, "years")', 'March 14, 2025']),
  'dateBetween()': help('tools.database.formulaHelp.dateBetween', ['dateBetween(parseDate("2026-03-14"), parseDate("2026-03-01"), "days")', '13'], ['dateBetween(parseDate("2027-01-01"), parseDate("2026-03-14"), "months")', '9']),
  'dateRange()': help('tools.database.formulaHelp.dateRange', ['dateRange(parseDate("2026-03-01"), parseDate("2026-03-05"))', 'March 1, 2026 → March 5, 2026'], ['dateRange(today(), dateAdd(today(), 7, "days"))']),
  'dateStart()': help('tools.database.formulaHelp.dateStart', ['dateStart(dateRange(parseDate("2026-03-01"), parseDate("2026-03-05")))', 'March 1, 2026'], ['dateStart(parseDate("2026-03-14"))', 'March 14, 2026']),
  'dateEnd()': help('tools.database.formulaHelp.dateEnd', ['dateEnd(dateRange(parseDate("2026-03-01"), parseDate("2026-03-05")))', 'March 5, 2026'], ['dateEnd(parseDate("2026-03-14"))', 'March 14, 2026']),
  'timestamp()': help('tools.database.formulaHelp.timestamp', ['timestamp(parseDate("1970-01-02T00:00Z"))', '86400000'], ['timestamp(parseDate("2026-03-14T00:00Z"))', '1773446400000']),
  'fromTimestamp()': help('tools.database.formulaHelp.fromTimestamp', ['year(fromTimestamp(1781568000000))', '2026'], ['dateBetween(fromTimestamp(86400000), fromTimestamp(0), "days")', '1']),
  'formatDate()': help('tools.database.formulaHelp.formatDate', ['formatDate(parseDate("2026-03-14"), "D MMMM YYYY")', '"14 March 2026"'], ['formatDate(parseDate("2026-03-14"), "YYYY/MM/DD")', '"2026/03/14"']),
  'parseDate()': help('tools.database.formulaHelp.parseDate', ['parseDate("2026-03-14")', 'March 14, 2026'], ['parseDate("2026-03-14T09:30")', 'March 14, 2026 09:30']),
  'name()': help('tools.database.formulaHelp.name', ['name(first(prop("Owner")))'], ['map(prop("Owner"), name(current))']),
  'email()': help('tools.database.formulaHelp.email', ['email(first(prop("Owner")))'], ['map(prop("Owner"), email(current))']),
  'id()': help('tools.database.formulaHelp.id', ['id()'], ['"Row " + id()']),
  'at()': help('tools.database.formulaHelp.at', ['at([10, 20, 30], 1)', '20'], ['at(["a", "b", "c"], -1)', '"c"']),
  'first()': help('tools.database.formulaHelp.first', ['first([3, 1, 2])', '3'], ['first(["x", "y"])', '"x"']),
  'last()': help('tools.database.formulaHelp.last', ['last([3, 1, 2])', '2'], ['last(["x", "y"])', '"y"']),
  'slice()': help('tools.database.formulaHelp.slice', ['slice([1, 2, 3, 4], 1, 3)', '[2, 3]'], ['slice(["a", "b", "c"], 1)', '["b", "c"]']),
  'sort()': help('tools.database.formulaHelp.sort', ['sort([3, 1, 2])', '[1, 2, 3]'], ['sort(["pear", "apple"])', '["apple", "pear"]']),
  'reverse()': help('tools.database.formulaHelp.reverse', ['reverse([1, 2, 3])', '[3, 2, 1]'], ['reverse(["a", "b"])', '["b", "a"]']),
  'unique()': help('tools.database.formulaHelp.unique', ['unique([1, 1, 2, 3, 3])', '[1, 2, 3]'], ['unique(["a", "b", "a"])', '["a", "b"]']),
  'includes()': help('tools.database.formulaHelp.includes', ['includes([1, 2, 3], 2)', 'true'], ['includes(["a", "b"], "c")', 'false']),
  'find()': help('tools.database.formulaHelp.find', ['find([4, 9, 12], current > 5)', '9'], ['find(["ant", "bee", "wasp"], length(current) > 3)', '"wasp"']),
  'findIndex()': help('tools.database.formulaHelp.findIndex', ['findIndex([4, 9, 12], current > 5)', '1'], ['findIndex(["a", "b"], current == "z")', '-1']),
  'filter()': help('tools.database.formulaHelp.filter', ['filter([1, 2, 3, 4], mod(current, 2) == 0)', '[2, 4]'], ['filter(["apple", "kiwi"], length(current) > 4)', '["apple"]']),
  'some()': help('tools.database.formulaHelp.some', ['some([1, 5, 9], current > 8)', 'true'], ['some([2, 4], current > 8)', 'false']),
  'every()': help('tools.database.formulaHelp.every', ['every([2, 4, 6], mod(current, 2) == 0)', 'true'], ['every([1, 2], current > 1)', 'false']),
  'map()': help('tools.database.formulaHelp.map', ['map([1, 2, 3], current * 10)', '[10, 20, 30]'], ['map(["a", "b"], upper(current))', '["A", "B"]']),
  'flat()': help('tools.database.formulaHelp.flat', ['flat([[1, 2], [3]])', '[1, 2, 3]'], ['flat([["a"], ["b", "c"]])', '["a", "b", "c"]']),
  'not()': help('tools.database.formulaHelp.not', ['not(empty("a"))', 'true'], ['not(1 == 1)', 'false']),
};
