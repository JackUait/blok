import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseModel } from '../../../../src/tools/database/database-model';
import { ComputedProperties } from '../../../../src/tools/database/computed-properties';
import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

const NOW = new Date('2026-10-09T12:00:00Z');

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'amount', name: 'Amount', type: 'number', position: 'a1' },
  { id: 'double', name: 'Double', type: 'formula', position: 'a2', formula: { expression: '{{property:amount}} * 2' } },
  { id: 'big', name: 'Big', type: 'formula', position: 'a3', formula: { expression: '{{property:amount}} > 2' } },
];

const view = (patch: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...patch,
});

const setup = (): DatabaseModel => {
  const model = new DatabaseModel({ schema, views: [view()], activeViewId: 'v' }, { now: () => NOW });
  const engine = new ComputedProperties('db');
  const rows: DatabaseRow[] = [
    { id: 'r1', position: 'a0', properties: { title: 'One', amount: 1 } },
    { id: 'r2', position: 'a1', properties: { title: 'Three', amount: 3 } },
    { id: 'r3', position: 'a2', properties: { title: 'Two', amount: 2 } },
  ];

  model.setRows(engine.apply(schema, rows, { databaseId: 'db', now: NOW }));
  model.setValueProperty((property) => engine.valueProperty(property));

  return model;
};

const ids = (rows: DatabaseRow[]): string[] => rows.map((row) => row.id);

describe('DatabaseModel — computed properties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('filters a number formula with number operators', () => {
    const rows = setup().queryRows({ view: view({ filters: [{ propertyId: 'double', operator: 'greater_than', value: 3 }] }) }).rows;

    expect(ids(rows)).toEqual(['r2', 'r3']);
  });

  it('filters a boolean formula as a checkbox', () => {
    const rows = setup().queryRows({ view: view({ filters: [{ propertyId: 'big', operator: 'equals', value: true }] }) }).rows;

    expect(ids(rows)).toEqual(['r2']);
  });

  it('sorts by a formula result', () => {
    const rows = setup().queryRows({ view: view({ sorts: [{ propertyId: 'double', direction: 'desc' }] }) }).rows;

    expect(ids(rows)).toEqual(['r2', 'r3', 'r1']);
  });

  it('groups by a formula result type', () => {
    const groups = setup().getRowsGroupedBy('big');

    expect(ids(groups.get('true') ?? [])).toEqual(['r2']);
    expect(ids(groups.get('false') ?? [])).toEqual(['r1', 'r3']);
  });

  it('gives the schema with formulas shown as their result type, and keeps the saved schema as is', () => {
    const model = setup();

    expect(model.getValueSchema().map((p) => p.type)).toEqual(['title', 'number', 'number', 'checkbox']);
    expect(model.getSchema().map((p) => p.type)).toEqual(['title', 'number', 'formula', 'formula']);
  });
});
