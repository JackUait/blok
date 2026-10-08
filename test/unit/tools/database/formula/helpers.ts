import { compileFormula, evaluateFormula, formulaValueToText } from '../../../../../src/tools/database/formula';
import type { FormulaValue } from '../../../../../src/tools/database/formula';
import type { DatabaseRow, PropertyDefinition, PropertyType, PropertyValue } from '../../../../../src/tools/database/types';

/** 2023-08-31T00:55Z: the clock behind the help page's examples (`timestamp(now())`). */
export const DOC_NOW = 1693443300000;

/** Person and relation are not Blok property types yet; the engine maps them by name. */
const futureType = (name: string): PropertyType => name as PropertyType;

export const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'price', name: 'Price', type: 'number', position: 'a1' },
  {
    id: 'status', name: 'Status', type: 'select', position: 'a2', config: {
      options: [
        { id: 'opt-high', label: 'High', position: 'a0' },
        { id: 'opt-low', label: 'Low', position: 'a1' },
      ],
    },
  },
  {
    id: 'tags', name: 'Tags', type: 'multiSelect', position: 'a3', config: {
      options: [
        { id: 'opt-fin', label: 'Finance', position: 'a0' },
        { id: 'opt-ops', label: 'Ops', position: 'a1' },
      ],
    },
  },
  { id: 'done', name: 'Done', type: 'checkbox', position: 'a4' },
  { id: 'due', name: 'Due', type: 'date', position: 'a5' },
  { id: 'start', name: 'Start Date', type: 'date', position: 'a6' },
  { id: 'end', name: 'End Date', type: 'date', position: 'a7' },
  { id: 'range', name: 'Date Range', type: 'date', position: 'a8' },
  { id: 'notes', name: 'Notes', type: 'text', position: 'a9' },
  { id: 'site', name: 'Site', type: 'url', position: 'b0' },
  { id: 'body', name: 'Body', type: 'richText', position: 'b1' },
  { id: 'taskId', name: 'Task ID', type: 'text', position: 'b2' },
  { id: 'owner', name: 'Owner', type: futureType('person'), position: 'b3' },
  { id: 'tasks', name: 'Tasks', type: futureType('relation'), position: 'b4' },
];

export const row = (properties: Record<string, PropertyValue> = {}): DatabaseRow => ({ id: 'row-1', position: 'a0', properties });

export interface RunOptions {
  timeZone?: string;
  now?: number;
  properties?: Record<string, PropertyValue>;
  people?: (id: string) => { name?: string; email?: string } | undefined;
}

export const run = (source: string, options: RunOptions = {}): FormulaValue => {
  const compiled = compileFormula(source, schema);

  if (!compiled.ok) throw new Error(`${source}: ${compiled.error.message}`);

  return evaluateFormula(compiled.formula, row(options.properties), {
    now: new Date(options.now ?? DOC_NOW),
    timeZone: options.timeZone ?? 'UTC',
    schema,
    people: options.people,
  });
};

/** The value as `format()` would render it. */
export const text = (source: string, options: RunOptions = {}): string =>
  formulaValueToText(run(source, options), { timeZone: options.timeZone ?? 'UTC', people: options.people });

export const compileError = (source: string): string => {
  const compiled = compileFormula(source, schema);

  return compiled.ok ? 'compiled' : compiled.error.message;
};
