import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { compileFormula, evaluateFormula, formatFormulaForDisplay, serializeFormula } from '../../../../../src/tools/database/formula';
import type { FormulaValue } from '../../../../../src/tools/database/formula';
import type { DatabaseRow, PropertyDefinition } from '../../../../../src/tools/database/types';

/** H-fxs: `prop("Tasks").filter(current.prop("Status") !== "Done")`. */
const tasks: PropertyDefinition[] = [
  { id: 't-title', name: 'Task', type: 'title', position: 'a0' },
  {
    id: 't-status', name: 'Status', type: 'select', position: 'a1',
    config: { options: [{ id: 'done', label: 'Done', position: 'a0' }, { id: 'open', label: 'Open', position: 'a1' }] },
  },
  { id: 't-hours', name: 'Hours', type: 'number', position: 'a2' },
];

const projects: PropertyDefinition[] = [
  { id: 'p-title', name: 'Project', type: 'title', position: 'a0' },
  { id: 'p-tasks', name: 'Tasks', type: 'relation', position: 'a1', relation: { targetDatabaseId: 'db-tasks' } },
];

const taskRows: DatabaseRow[] = [
  { id: 'task-1', position: 'a0', properties: { 't-title': 'Write', 't-status': 'done', 't-hours': 2 } },
  { id: 'task-2', position: 'a1', properties: { 't-title': 'Ship', 't-status': 'open', 't-hours': 3 } },
];

const project: DatabaseRow = { id: 'project-1', position: 'a0', properties: { 'p-title': 'Launch', 'p-tasks': [{ id: 'task-1' }, { id: 'task-2' }] } };

const related = (databaseId: string): PropertyDefinition[] | undefined => (databaseId === 'db-tasks' ? tasks : undefined);

const relatedValue = (databaseId: string, rowId: string, property: PropertyDefinition): DatabaseRow['properties'][string] | undefined =>
  databaseId === 'db-tasks' ? taskRows.find((r) => r.id === rowId)?.properties[property.id] : undefined;

const run = (source: string): FormulaValue => {
  const compiled = compileFormula(source, projects, { related });

  if (!compiled.ok) throw new Error(compiled.error.message);

  return evaluateFormula(compiled.formula, project, { now: new Date(0), timeZone: 'UTC', schema: projects, related, relatedValue });
};

describe('formula — properties of related pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('filters related pages by a property of each one (help page example)', () => {
    const result = run('prop("Tasks").filter(current.prop("Status") !== "Done")');

    expect(result).toEqual([{ kind: 'page', id: 'task-2', databaseId: 'db-tasks' }]);
  });

  it('reads a number property of each related page', () => {
    expect(run('prop("Tasks").map(current.prop("Hours")).sum()')).toBe(5);
  });

  it('types the related property, so a wrong use fails to compile', () => {
    const compiled = compileFormula('prop("Tasks").map(current.prop("Hours") + true)', projects, { related });

    expect(compiled).toMatchObject({ ok: false, error: { code: 'cannotAdd' } });
  });

  it('fails with a code when the related database has no such property', () => {
    const compiled = compileFormula('prop("Tasks").map(current.prop("Nope"))', projects, { related });

    expect(compiled).toMatchObject({ ok: false, error: { code: 'unknownRelatedProperty', params: { name: 'Nope' } } });
  });

  it('stores the related property by id and shows it by its current name', () => {
    const compiled = compileFormula('prop("Tasks").map(current.prop("Hours"))', projects, { related });

    if (!compiled.ok) throw new Error(compiled.error.message);
    const stored = serializeFormula(compiled.formula);

    expect(stored).toBe('{{property:p-tasks}}.map(current.prop({{property:t-hours}}))');

    const renamed = tasks.map((p) => (p.id === 't-hours' ? { ...p, name: 'Effort' } : p));

    expect(formatFormulaForDisplay(stored, projects, renamed)).toBe('prop("Tasks").map(current.prop("Effort"))');
  });

  it('compiles the stored form again', () => {
    const compiled = compileFormula('{{property:p-tasks}}.map(current.prop({{property:t-hours}}))', projects, { related });

    expect(compiled.ok).toBe(true);
  });
});
