import { compileFormula, evaluateFormula, formulaDateToStored, formulaValueToText } from './formula';
import type { CompileResult, FormulaType, FormulaValue } from './formula';
import { propertyFormulaValue } from './formula/properties';
import { isDate, isRef } from './formula/types';
import { readPropertyValue } from './property-values';
import { relationIdsOf } from './relation-values';
import { computeRollup, rollupResultType } from './rollup';
import type { DatabaseRow, PropertyDefinition, PropertyValue } from './types';

/** A database in this document, as another database reads it. */
export interface DatabaseSource {
  schema: PropertyDefinition[];
  /** Rows with their own computed values already filled in. */
  rows: DatabaseRow[];
  /** The property a computed property of that database shows as. */
  valueProperty?: (property: PropertyDefinition) => PropertyDefinition;
}

export interface ComputeContext {
  /** This database's block id: a relation to it is a self-relation. */
  databaseId: string;
  now: Date;
  timeZone?: string;
  /** Another database block in this document, or undefined when there is none. */
  resolveDatabase?: (databaseId: string) => DatabaseSource | undefined;
}

/** H-err: "Formulas can only reference other formulas 15 layers deep". */
const MAX_FORMULA_DEPTH = 15;

const COMPUTED: ReadonlySet<string> = new Set(['formula', 'rollup', 'relation']);

const CLOCK = /\b(?:now|today)\s*\(/;

const failure = (code: 'circularReference' | 'tooDeep', name: string): CompileResult => ({
  ok: false,
  error: {
    code,
    params: { name },
    message: code === 'tooDeep' ? 'Formulas can reference other formulas only 15 levels deep' : `"${name}" refers back to itself`,
    start: 0,
    end: 0,
  },
});

/** The property type that holds a formula result of this type. */
const shapeOfFormula = (type: FormulaType, property: PropertyDefinition): PropertyDefinition => {
  const base = { id: property.id, name: property.name, position: property.position };
  const element = type.kind === 'list' ? type.of : type;

  if (type.kind === 'number') return { ...base, type: 'number', ...(property.number !== undefined ? { number: property.number } : {}) };
  if (type.kind === 'boolean') return { ...base, type: 'checkbox' };
  if (type.kind === 'date') return { ...base, type: 'date', ...(property.date !== undefined ? { date: property.date } : {}) };
  if (element.kind === 'person') return { ...base, type: 'person' };
  if (element.kind === 'page') {
    return { ...base, type: 'relation', ...(element.databaseId !== undefined ? { relation: { targetDatabaseId: element.databaseId } } : {}) };
  }

  return { ...base, type: 'text' };
};

/** A formula result in the stored shape of the property type that shows it. */
const storeFormulaValue = (value: FormulaValue, shape: PropertyDefinition, timeZone: string | undefined): PropertyValue => {
  if (shape.type === 'number') return typeof value === 'number' ? value : null;
  if (shape.type === 'checkbox') return value === true;
  if (shape.type === 'date') return isDate(value) ? formulaDateToStored(value, timeZone) : null;
  if (shape.type === 'person' || shape.type === 'relation') {
    const items = Array.isArray(value) ? value : [value];

    return items.filter(isRef).map((ref) => ({ id: ref.id }));
  }

  return formulaValueToText(value, { timeZone });
};

const signatureOf = (schema: PropertyDefinition[]): string =>
  JSON.stringify(schema.map((p) => [p.id, p.name, p.type, p.formula, p.relation, p.rollup]));

/**
 * Formula, rollup and relation values, worked out from the row blocks on
 * every sync. Nothing here is written to a row: the values live in
 * `row.computed`, which `readPropertyValue` prefers. A row whose inputs did
 * not change keeps its computed record, so its formulas are not run again.
 */
export class ComputedProperties {
  private schema: PropertyDefinition[] = [];
  private ctx: ComputeContext;
  private readonly compiled = new Map<string, CompileResult>();
  /** Per row: the inputs signature and the computed record it gave. */
  private readonly memo = new Map<string, { key: string; computed: Record<string, PropertyValue> }>();
  /** Per apply: values worked out so far, and the ones being worked out (cycle guard). */
  private values = new Map<string, PropertyValue>();
  private raw = new Map<string, FormulaValue>();
  private readonly busy = new Set<string>();
  private rows = new Map<string, DatabaseRow>();
  private reverse = new Map<string, Map<string, string[]>>();

  constructor(databaseId: string) {
    this.ctx = { databaseId, now: new Date(0) };
  }

  /** Rows with `computed` filled. The schema has no computed property: rows come back as they are. */
  apply(schema: PropertyDefinition[], rows: DatabaseRow[], ctx: ComputeContext): DatabaseRow[] {
    this.schema = schema;
    this.ctx = ctx;
    const computedProps = schema.filter((p) => COMPUTED.has(p.type));

    if (computedProps.length === 0) {
      this.memo.clear();

      return rows;
    }
    this.values = new Map();
    this.raw = new Map();
    this.rows = new Map(rows.map((r) => [r.id, r]));
    this.reverse = this.buildReverse(schema, rows);
    const schemaKey = signatureOf(schema);
    const clock = computedProps.some((p) => p.type === 'formula' && CLOCK.test(p.formula?.expression ?? '')) ? String(ctx.now.getTime()) : '';
    const external = JSON.stringify(computedProps
      .filter((p) => p.type !== 'formula')
      .map((p) => this.externalSignature(p)));

    return rows.map((row) => {
      const key = JSON.stringify([schemaKey, clock, external, row.properties, row.meta ?? null, this.relatedSignature(row, computedProps)]);
      const hit = this.memo.get(row.id);

      if (hit !== undefined && hit.key === key) return { ...row, computed: hit.computed };
      const computed = Object.fromEntries(computedProps.map((p) => [p.id, this.valueFor(row.id, p)]));

      this.memo.set(row.id, { key, computed });

      return { ...row, computed };
    });
  }

  /**
   * The property a computed one displays, filters, sorts, groups and
   * calculates as: its result type. Any other property is itself.
   */
  valueProperty(property: PropertyDefinition): PropertyDefinition {
    if (property.type === 'formula') {
      const compiled = this.compile(property, this.schema);

      return compiled.ok ? shapeOfFormula(compiled.resultType, property) : { ...property, type: 'text' };
    }
    if (property.type === 'rollup') {
      const target = this.rollupTarget(property);
      const settings = property.rollup;

      if (target === undefined || settings === undefined || target.type === 'rollup') return { ...property, type: 'text' };
      const shape = rollupResultType(settings.function, target);
      const number = property.number ?? shape.number;

      return { ...property, ...shape, ...(number !== undefined ? { number } : {}), config: shape.config ?? property.config };
    }

    return property;
  }

  /** Compiles a formula property against a schema, refusing cycles and chains deeper than 15. */
  compile(property: PropertyDefinition, schema: PropertyDefinition[], stack: string[] = []): CompileResult {
    const expression = property.formula?.expression ?? '';

    if (stack.includes(property.id)) return failure('circularReference', property.name);
    if (stack.length > MAX_FORMULA_DEPTH) return failure('tooDeep', property.name);
    const key = `${property.id}\u0000${expression}\u0000${signatureOf(schema)}\u0000${stack.length}`;
    const cached = stack.length === 0 ? this.compiled.get(key) : undefined;

    if (cached !== undefined) return cached;
    const inner = [...stack, property.id];
    const result = compileFormula(expression, schema, {
      related: (databaseId) => this.source(databaseId)?.schema,
      typeOf: (ref) => this.formulaTypeOf(ref, schema, inner),
    });

    if (stack.length === 0) this.compiled.set(key, result);

    return result;
  }

  private formulaTypeOf(ref: PropertyDefinition, schema: PropertyDefinition[], stack: string[]): FormulaType | { error: { code: 'circularReference' | 'tooDeep'; params: { name: string }; message: string } } | undefined {
    if (ref.type === 'formula') {
      const result = this.compile(ref, schema, stack);

      if (result.ok) return result.resultType;

      return result.error.code === 'circularReference' || result.error.code === 'tooDeep'
        ? { error: { code: result.error.code, params: { name: ref.name }, message: result.error.message } }
        : undefined;
    }
    if (ref.type === 'rollup') {
      const shown = this.valueProperty(ref);

      return propertyFormulaValueType(shown);
    }

    return undefined;
  }

  private source(databaseId: string): DatabaseSource | undefined {
    if (databaseId === this.ctx.databaseId) {
      return { schema: this.schema, rows: [...this.rows.values()], valueProperty: (p) => this.valueProperty(p) };
    }

    return this.ctx.resolveDatabase?.(databaseId);
  }

  private rollupTarget(property: PropertyDefinition): PropertyDefinition | undefined {
    const settings = property.rollup;
    const relation = this.schema.find((p) => p.id === settings?.relationPropertyId);
    const databaseId = relation?.relation?.targetDatabaseId;
    const source = databaseId === undefined ? undefined : this.source(databaseId);
    const target = source?.schema.find((p) => p.id === settings?.targetPropertyId);

    if (target === undefined) return undefined;

    return target.type === 'formula' ? source?.valueProperty?.(target) ?? target : target;
  }

  /** Self-relations without a synced property show both ways: who points at each row. */
  private buildReverse(schema: PropertyDefinition[], rows: DatabaseRow[]): Map<string, Map<string, string[]>> {
    const reverse = new Map<string, Map<string, string[]>>();

    for (const property of schema) {
      const settings = property.relation;

      if (property.type !== 'relation' || settings?.targetDatabaseId !== this.ctx.databaseId || settings.twoWay === true) continue;
      const pointers = new Map<string, string[]>();

      rows.forEach((row) => relationIdsOf(row.properties[property.id]).forEach((id) => {
        pointers.set(id, [...(pointers.get(id) ?? []), row.id]);
      }));
      reverse.set(property.id, pointers);
    }

    return reverse;
  }

  /** Related row ids that exist, in stored order, then the rows pointing back on a one-way self-relation. */
  private relatedIds(rowId: string, property: PropertyDefinition): string[] {
    const row = this.rows.get(rowId);
    const databaseId = property.relation?.targetDatabaseId;
    const stored = relationIdsOf(row?.properties[property.id]);
    const back = this.reverse.get(property.id)?.get(rowId) ?? [];
    const ids = [...new Set([...stored, ...back])];

    if (property.relation?.targetDocumentId !== undefined || databaseId === undefined) return ids;
    const source = this.source(databaseId);

    if (source === undefined) return ids;
    const existing = new Set(source.rows.map((r) => r.id));

    return ids.filter((id) => existing.has(id));
  }

  private relatedSignature(row: DatabaseRow, computedProps: PropertyDefinition[]): unknown {
    return computedProps
      .filter((p) => p.type === 'relation')
      .map((p) => {
        const ids = this.relatedIds(row.id, p);
        const source = p.relation === undefined ? undefined : this.source(p.relation.targetDatabaseId);

        return ids.map((id) => {
          const target = source?.rows.find((r) => r.id === id);

          return [id, target?.properties ?? null, target?.computed ?? null];
        });
      });
  }

  /** What a rollup or relation reads outside its own row: the target database's schema. */
  private externalSignature(property: PropertyDefinition): unknown {
    const relation = property.type === 'relation' ? property : this.schema.find((p) => p.id === property.rollup?.relationPropertyId);
    const databaseId = relation?.relation?.targetDatabaseId;

    if (databaseId === undefined || databaseId === this.ctx.databaseId) return null;

    return signatureOf(this.source(databaseId)?.schema ?? []);
  }

  private valueFor(rowId: string, property: PropertyDefinition): PropertyValue {
    const key = `${rowId}\u0000${property.id}`;

    if (this.values.has(key)) return this.values.get(key) ?? null;
    if (this.busy.has(key)) return null;
    this.busy.add(key);
    try {
      const value = this.compute(rowId, property);

      this.values.set(key, value);

      return value;
    } finally {
      this.busy.delete(key);
    }
  }

  private compute(rowId: string, property: PropertyDefinition): PropertyValue {
    if (property.type === 'relation') return this.relatedIds(rowId, property).map((id) => ({ id }));
    if (property.type === 'rollup') return this.rollup(rowId, property);
    const value = this.formulaRaw(rowId, property);

    return value === undefined ? null : storeFormulaValue(value, this.valueProperty(property), this.ctx.timeZone);
  }

  private rollup(rowId: string, property: PropertyDefinition): PropertyValue {
    const settings = property.rollup;
    const relation = this.schema.find((p) => p.id === settings?.relationPropertyId);
    const databaseId = relation?.relation?.targetDatabaseId;
    const source = databaseId === undefined ? undefined : this.source(databaseId);
    const target = source?.schema.find((p) => p.id === settings?.targetPropertyId);

    // Rollup of a rollup: H-rr says no, "this could create unintended loops".
    if (settings === undefined || relation === undefined || source === undefined || target === undefined || target.type === 'rollup') return null;
    const self = databaseId === this.ctx.databaseId;
    const values = this.relatedIds(rowId, relation).map((id) => {
      if (self && COMPUTED.has(target.type)) return this.valueFor(id, target);
      const row = source.rows.find((r) => r.id === id);

      return row === undefined ? undefined : readPropertyValue(row, target);
    });
    const shown = target.type === 'formula' ? source.valueProperty?.(target) ?? target : target;

    return computeRollup(settings.function, values, shown);
  }

  private formulaRaw(rowId: string, property: PropertyDefinition): FormulaValue | undefined {
    const key = `${rowId}\u0000${property.id}`;

    if (this.raw.has(key)) return this.raw.get(key);
    const compiled = this.compile(property, this.schema);
    const row = this.rows.get(rowId);

    if (!compiled.ok || row === undefined) return undefined;
    const tz = this.ctx.timeZone;
    const value = evaluateFormula(compiled.formula, row, {
      now: this.ctx.now,
      timeZone: tz,
      schema: this.schema,
      propValue: (ref) => {
        if (ref.type === 'formula') return this.busy.has(`${rowId}\u0000${ref.id}`) ? null : this.formulaRawGuarded(rowId, ref);
        if (ref.type === 'rollup' || ref.type === 'relation') return propertyFormulaValue(this.valueProperty(ref), this.valueFor(rowId, ref), tz);

        return undefined;
      },
      related: (databaseId) => this.source(databaseId)?.schema,
      relatedValue: (databaseId, relatedRowId, ref) => {
        const source = this.source(databaseId);

        if (databaseId === this.ctx.databaseId && COMPUTED.has(ref.type)) return this.valueFor(relatedRowId, ref);
        const relatedRow = source?.rows.find((r) => r.id === relatedRowId);

        return relatedRow === undefined ? undefined : readPropertyValue(relatedRow, ref);
      },
    });

    this.raw.set(key, value);

    return value;
  }

  private formulaRawGuarded(rowId: string, property: PropertyDefinition): FormulaValue {
    const key = `${rowId}\u0000${property.id}`;

    this.busy.add(key);
    try {
      return this.formulaRaw(rowId, property) ?? null;
    } finally {
      this.busy.delete(key);
    }
  }
}

/** The formula type a computed property's shown value reads as. */
const propertyFormulaValueType = (shown: PropertyDefinition): FormulaType | undefined => {
  const listed: Record<string, FormulaType> = {
    number: { kind: 'number' },
    date: { kind: 'date' },
    checkbox: { kind: 'boolean' },
    text: { kind: 'text' },
    multiSelect: { kind: 'list', of: { kind: 'text' } },
    person: { kind: 'list', of: { kind: 'person' } },
    files: { kind: 'list', of: { kind: 'text' } },
  };

  if (shown.type === 'relation') {
    const databaseId = shown.relation?.targetDatabaseId;

    return { kind: 'list', of: databaseId === undefined ? { kind: 'page' } : { kind: 'page', databaseId } };
  }

  return listed[shown.type];
};
