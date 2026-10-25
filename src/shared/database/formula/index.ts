import { Checker, SPECIAL_FORMS, resolveProps } from './checker';
import { FormulaFailure } from './errors';
import type { CheckOptions, PropSpan } from './checker';
import { evaluate } from './evaluate';
import { FUNCTIONS } from './functions';
import { parse } from './parser';
import type { FormulaNode } from './parser';
import { tokenize } from './tokenizer';
import type { FormulaError } from './tokenizer';
import type { FormulaType, FormulaValue } from './types';
import type { DatabaseRow, PropertyDefinition, PropertyValue } from '../types';

export type { FormulaError, FormulaErrorCode, FormulaErrorParams } from './errors';
export { FORMULA_ERROR_CODES, formulaErrorKey } from './errors';
export type { FormulaDate, FormulaRef, FormulaRichText, FormulaType, FormulaValue, StyledRun } from './types';
export { formulaValueToText } from './values';
export { formulaDateToStored } from './dates';

export interface CompiledFormula {
  readonly source: string;
  readonly node: FormulaNode;
  readonly propSpans: readonly PropSpan[];
  readonly resultType: FormulaType;
}

export type CompileResult =
  | { ok: true; formula: CompiledFormula; resultType: FormulaType }
  | { ok: false; error: FormulaError };

export interface CompileOptions extends CheckOptions {}

export interface FormulaContext {
  /** `now()` and `today()` read this, never the system clock. */
  now: Date;
  /** IANA zone for dates without an explicit offset. Defaults to the runtime's zone. */
  timeZone?: string;
  schema: PropertyDefinition[];
  /** Names and emails for `name()`, `email()` and `format()` of a person. */
  people?: (id: string) => { name?: string; email?: string } | undefined;
  /** A formula or rollup of the row, as the formula sees it. `undefined` reads the stored value. */
  propValue?: (property: PropertyDefinition) => FormulaValue | undefined;
  /** The schema of a related database, for `current.prop()`. */
  related?: (databaseId: string) => PropertyDefinition[] | undefined;
  /** A property value of a row of a related database. */
  relatedValue?: (databaseId: string, rowId: string, property: PropertyDefinition) => PropertyValue | undefined;
}

/** Every name a formula can call, for the README drift test and an editor's autocomplete. */
export const FORMULA_FUNCTION_NAMES: readonly string[] = [...Object.keys(FUNCTIONS), ...SPECIAL_FORMS];

const byId = (schema: PropertyDefinition[]): Map<string, PropertyDefinition> => new Map(schema.map((p) => [p.id, p]));

/** Compiles a formula written with `prop("Name")` or with stored `{{property:id}}` references. */
export const compileFormula = (source: string, schema: PropertyDefinition[], options: CompileOptions = {}): CompileResult => {
  const parsed = parse(source);

  if (!parsed.ok) return parsed;

  try {
    const propSpans: PropSpan[] = [];
    const node = resolveProps(parsed.node, schema, propSpans);
    const resultType = new Checker(byId(schema), options, propSpans).check(node, { vars: new Map() });

    return { ok: true, formula: { source, node, propSpans, resultType }, resultType };
  } catch (error) {
    if (error instanceof FormulaFailure) return { ok: false, error: error.toError() };
    throw error;
  }
};

export const evaluateFormula = (compiled: CompiledFormula, row: DatabaseRow, ctx: FormulaContext): FormulaValue =>
  evaluate(compiled.node, {
    row,
    properties: byId(ctx.schema),
    now: ctx.now.getTime(),
    timeZone: ctx.timeZone,
    rowId: row.id,
    people: ctx.people,
    propValue: ctx.propValue,
    related: ctx.related,
    relatedValue: ctx.relatedValue,
  }, { vars: new Map() });

/** The form to store: the source with every property named by id, so a rename keeps working. */
export const serializeFormula = (compiled: CompiledFormula): string =>
  [...compiled.propSpans]
    .sort((a, b) => b.start - a.start)
    .reduce((text, span) => `${text.slice(0, span.start)}{{property:${span.id}}}${text.slice(span.end)}`, compiled.source);

const quote = (name: string): string => `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * The stored form with current property names, for the editor. Unknown ids
 * stay as they are. `related` holds the schemas of related databases, for
 * `current.prop({{property:id}})`.
 */
export const formatFormulaForDisplay = (stored: string, schema: PropertyDefinition[], related: PropertyDefinition[] = []): string => {
  const tokens = tokenize(stored);

  if (!tokens.ok) return stored;
  const properties = byId(schema);
  const relatedProperties = byId(related);

  return tokens.tokens.reduceRight((text, token, index) => {
    if (token.type !== 'propRef') return text;
    const before = tokens.tokens.slice(Math.max(0, index - 3), index).map((t) => t.value).join('');
    const inRelatedProp = before === '.prop(';
    const property = inRelatedProp ? relatedProperties.get(token.value) ?? properties.get(token.value) : properties.get(token.value);

    if (property === undefined) return text;

    return `${text.slice(0, token.start)}${inRelatedProp ? quote(property.name) : `prop(${quote(property.name)})`}${text.slice(token.end)}`;
  }, stored);
};
