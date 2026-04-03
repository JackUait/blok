import { describe, it, expect } from 'vitest';
import { DatabaseModel } from '../../../../src/tools/database/database-model';
import type {
  DatabaseData,
  DatabaseRow,
  PropertyDefinition,
  SelectOption,
  DatabaseViewConfig,
} from '../../../../src/tools/database/types';

// ─── Factories ───

const makeSelectOption = (overrides: Partial<SelectOption> = {}): SelectOption => ({
  id: `opt-${Math.random().toString(36).slice(2, 6)}`,
  label: 'Option',
  position: 'a0',
  ...overrides,
});

const makeProperty = (overrides: Partial<PropertyDefinition> = {}): PropertyDefinition => ({
  id: `prop-${Math.random().toString(36).slice(2, 6)}`,
  name: 'Property',
  type: 'text',
  position: 'a0',
  ...overrides,
});

const makeRow = (overrides: Partial<DatabaseRow> = {}): DatabaseRow => ({
  id: `row-${Math.random().toString(36).slice(2, 6)}`,
  position: 'a0',
  properties: {},
  ...overrides,
});

const makeView = (overrides: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id: `view-${Math.random().toString(36).slice(2, 6)}`,
  name: 'Board',
  type: 'board',
  position: 'a0',
  groupBy: 'prop-status',
  sorts: [],
  filters: [],
  visibleProperties: [],
  ...overrides,
});

const makeData = (overrides: Partial<DatabaseData> = {}): DatabaseData => ({
  schema: [],
  rows: {},
  views: [],
  activeViewId: '',
  ...overrides,
});

describe('DatabaseModel', () => {
  describe('constructor', () => {
    it('creates default schema with title and status properties when no data provided', () => {
      const model = new DatabaseModel();
      const schema = model.getSchema();
      expect(schema).toHaveLength(2);
      expect(schema[0].type).toBe('title');
      expect(schema[0].name).toBe('Title');
      expect(schema[1].type).toBe('select');
      expect(schema[1].name).toBe('Status');
    });

    it('creates default status property with three options', () => {
      const model = new DatabaseModel();
      const statusProp = model.getSchema().find(p => p.type === 'select');
      const options = statusProp?.config?.options ?? [];
      expect(options).toHaveLength(3);
      expect(options.map(o => o.label)).toEqual(['Not started', 'In progress', 'Done']);
      expect(options.map(o => o.color)).toEqual(['gray', 'blue', 'green']);
    });

    it('creates default board view grouped by status when no data provided', () => {
      const model = new DatabaseModel();
      const views = model.getViews();
      expect(views).toHaveLength(1);
      expect(views[0].type).toBe('board');
      expect(views[0].name).toBe('Board');
      const statusProp = model.getSchema().find(p => p.type === 'select');
      expect(views[0].groupBy).toBe(statusProp?.id);
    });

    it('uses provided data when given', () => {
      const prop = makeProperty({ id: 'p1', name: 'Title', type: 'title' });
      const row = makeRow({ id: 'r1', properties: { p1: 'Hello' } });
      const view = makeView({ id: 'v1' });
      const model = new DatabaseModel(makeData({
        schema: [prop],
        rows: { r1: row },
        views: [view],
        activeViewId: 'v1',
      }));
      expect(model.getSchema()).toHaveLength(1);
      expect(model.getRow('r1')).toBeDefined();
      expect(model.getViews()).toHaveLength(1);
    });
  });

  describe('schema operations', () => {
    it('getProperty returns property by ID', () => {
      const prop = makeProperty({ id: 'p1' });
      const model = new DatabaseModel(makeData({ schema: [prop] }));
      expect(model.getProperty('p1')).toEqual(prop);
      expect(model.getProperty('nonexistent')).toBeUndefined();
    });

    it('addProperty appends a new property with auto-generated ID and position', () => {
      const model = new DatabaseModel();
      const schemaBefore = model.getSchema().length;
      const added = model.addProperty('Priority', 'select', {
        options: [makeSelectOption({ label: 'Low' }), makeSelectOption({ label: 'High' })],
      });
      expect(added.name).toBe('Priority');
      expect(added.type).toBe('select');
      expect(added.id).toBeTruthy();
      expect(added.position).toBeTruthy();
      expect(added.config?.options).toHaveLength(2);
      expect(model.getSchema()).toHaveLength(schemaBefore + 1);
    });

    it('updateProperty merges partial changes', () => {
      const opt1 = makeSelectOption({ id: 'o1', label: 'A', position: 'a0' });
      const prop = makeProperty({
        id: 'p1', name: 'Status', type: 'select',
        config: { options: [opt1] },
      });
      const model = new DatabaseModel(makeData({ schema: [prop] }));
      model.updateProperty('p1', { name: 'Phase' });
      expect(model.getProperty('p1')?.name).toBe('Phase');
      expect(model.getProperty('p1')?.config?.options).toHaveLength(1);
    });

    it('deleteProperty removes from schema and strips values from all rows', () => {
      const prop = makeProperty({ id: 'p1', name: 'Notes', type: 'text' });
      const titleProp = makeProperty({ id: 'pt', name: 'Title', type: 'title', position: 'a0' });
      const row = makeRow({ id: 'r1', properties: { pt: 'Hello', p1: 'some notes' } });
      const model = new DatabaseModel(makeData({
        schema: [titleProp, prop],
        rows: { r1: row },
      }));
      model.deleteProperty('p1');
      expect(model.getProperty('p1')).toBeUndefined();
      expect(model.getSchema()).toHaveLength(1);
      expect(model.getRow('r1')?.properties.p1).toBeUndefined();
      expect(model.getRow('r1')?.properties.pt).toBe('Hello');
    });
  });

  describe('row operations', () => {
    it('getOrderedRows returns rows sorted by position', () => {
      const r1 = makeRow({ id: 'r1', position: 'a1' });
      const r2 = makeRow({ id: 'r2', position: 'a0' });
      const model = new DatabaseModel(makeData({ rows: { r1, r2 } }));
      const ordered = model.getOrderedRows();
      expect(ordered[0].id).toBe('r2');
      expect(ordered[1].id).toBe('r1');
    });

    it('addRow creates row with auto ID and position at end', () => {
      const model = new DatabaseModel();
      const row = model.addRow({ 'prop-title': 'New task' });
      expect(row.id).toBeTruthy();
      expect(row.position).toBeTruthy();
      expect(row.properties['prop-title']).toBe('New task');
      expect(model.getRow(row.id)).toBeDefined();
    });

    it('updateRow merges partial property changes', () => {
      const row = makeRow({ id: 'r1', properties: { a: 'old', b: 'keep' } });
      const model = new DatabaseModel(makeData({ rows: { r1: row } }));
      model.updateRow('r1', { a: 'new' });
      expect(model.getRow('r1')?.properties.a).toBe('new');
      expect(model.getRow('r1')?.properties.b).toBe('keep');
    });

    it('moveRow updates position', () => {
      const row = makeRow({ id: 'r1', position: 'a0' });
      const model = new DatabaseModel(makeData({ rows: { r1: row } }));
      model.moveRow('r1', 'a5');
      expect(model.getRow('r1')?.position).toBe('a5');
    });

    it('deleteRow removes the row', () => {
      const row = makeRow({ id: 'r1' });
      const model = new DatabaseModel(makeData({ rows: { r1: row } }));
      model.deleteRow('r1');
      expect(model.getRow('r1')).toBeUndefined();
      expect(model.getOrderedRows()).toHaveLength(0);
    });
  });

  describe('getRowsGroupedBy', () => {
    it('groups rows by select property value', () => {
      const optA = makeSelectOption({ id: 'optA', label: 'A', position: 'a0' });
      const optB = makeSelectOption({ id: 'optB', label: 'B', position: 'a1' });
      const prop = makeProperty({ id: 'status', type: 'select', config: { options: [optA, optB] } });
      const r1 = makeRow({ id: 'r1', position: 'a0', properties: { status: 'optA' } });
      const r2 = makeRow({ id: 'r2', position: 'a1', properties: { status: 'optB' } });
      const r3 = makeRow({ id: 'r3', position: 'a2', properties: { status: 'optA' } });
      const model = new DatabaseModel(makeData({ schema: [prop], rows: { r1, r2, r3 } }));
      const groups = model.getRowsGroupedBy('status');
      expect(groups.get('optA')).toHaveLength(2);
      expect(groups.get('optA')![0].id).toBe('r1');
      expect(groups.get('optA')![1].id).toBe('r3');
      expect(groups.get('optB')).toHaveLength(1);
    });

    it('puts rows with no value under empty string key', () => {
      const opt = makeSelectOption({ id: 'optA', label: 'A', position: 'a0' });
      const prop = makeProperty({ id: 'status', type: 'select', config: { options: [opt] } });
      const r1 = makeRow({ id: 'r1', position: 'a0', properties: { status: 'optA' } });
      const r2 = makeRow({ id: 'r2', position: 'a1', properties: {} });
      const model = new DatabaseModel(makeData({ schema: [prop], rows: { r1, r2 } }));
      const groups = model.getRowsGroupedBy('status');
      expect(groups.get('optA')).toHaveLength(1);
      expect(groups.get('')).toHaveLength(1);
      expect(groups.get('')![0].id).toBe('r2');
    });

    it('sorts rows within each group by position', () => {
      const opt = makeSelectOption({ id: 'optA', label: 'A', position: 'a0' });
      const prop = makeProperty({ id: 'status', type: 'select', config: { options: [opt] } });
      const r1 = makeRow({ id: 'r1', position: 'a2', properties: { status: 'optA' } });
      const r2 = makeRow({ id: 'r2', position: 'a0', properties: { status: 'optA' } });
      const r3 = makeRow({ id: 'r3', position: 'a1', properties: { status: 'optA' } });
      const model = new DatabaseModel(makeData({ schema: [prop], rows: { r1, r2, r3 } }));
      const group = model.getRowsGroupedBy('status').get('optA')!;
      expect(group.map(r => r.id)).toEqual(['r2', 'r3', 'r1']);
    });

    it('groups by checkbox property using true/false keys', () => {
      const prop = makeProperty({ id: 'done', type: 'checkbox' });
      const r1 = makeRow({ id: 'r1', position: 'a0', properties: { done: true } });
      const r2 = makeRow({ id: 'r2', position: 'a1', properties: { done: false } });
      const r3 = makeRow({ id: 'r3', position: 'a2', properties: {} });
      const model = new DatabaseModel(makeData({ schema: [prop], rows: { r1, r2, r3 } }));
      const groups = model.getRowsGroupedBy('done');
      expect(groups.get('true')).toHaveLength(1);
      expect(groups.get('false')).toHaveLength(1);
      expect(groups.get('')).toHaveLength(1);
    });
  });

  describe('getSelectOptions', () => {
    it('returns options sorted by position', () => {
      const optB = makeSelectOption({ id: 'b', label: 'B', position: 'a1' });
      const optA = makeSelectOption({ id: 'a', label: 'A', position: 'a0' });
      const prop = makeProperty({ id: 'p1', type: 'select', config: { options: [optB, optA] } });
      const model = new DatabaseModel(makeData({ schema: [prop] }));
      const options = model.getSelectOptions('p1');
      expect(options[0].id).toBe('a');
      expect(options[1].id).toBe('b');
    });

    it('returns empty array for non-select property', () => {
      const prop = makeProperty({ id: 'p1', type: 'text' });
      const model = new DatabaseModel(makeData({ schema: [prop] }));
      expect(model.getSelectOptions('p1')).toEqual([]);
    });

    it('returns empty array for unknown property', () => {
      const model = new DatabaseModel(makeData({ schema: [] }));
      expect(model.getSelectOptions('nonexistent')).toEqual([]);
    });
  });

  describe('view operations', () => {
    it('getViews returns all views', () => {
      const v1 = makeView({ id: 'v1', position: 'a0' });
      const v2 = makeView({ id: 'v2', position: 'a1' });
      const model = new DatabaseModel(makeData({ views: [v1, v2] }));
      expect(model.getViews()).toHaveLength(2);
    });

    it('getView returns view by ID', () => {
      const v1 = makeView({ id: 'v1' });
      const model = new DatabaseModel(makeData({ views: [v1] }));
      expect(model.getView('v1')?.id).toBe('v1');
      expect(model.getView('nonexistent')).toBeUndefined();
    });

    it('addView creates view with auto ID and position', () => {
      const model = new DatabaseModel();
      const view = model.addView('Table', 'table', {});
      expect(view.id).toBeTruthy();
      expect(view.name).toBe('Table');
      expect(view.type).toBe('table');
      expect(view.position).toBeTruthy();
      expect(model.getViews().length).toBeGreaterThanOrEqual(2);
    });

    it('addView accepts groupBy for board views', () => {
      const model = new DatabaseModel();
      const view = model.addView('Board 2', 'board', { groupBy: 'prop-status' });
      expect(view.groupBy).toBe('prop-status');
    });

    it('updateView merges partial changes', () => {
      const v1 = makeView({ id: 'v1', name: 'Old name' });
      const model = new DatabaseModel(makeData({ views: [v1] }));
      model.updateView('v1', { name: 'New name' });
      expect(model.getView('v1')?.name).toBe('New name');
      expect(model.getView('v1')?.type).toBe('board');
    });

    it('deleteView removes the view', () => {
      const v1 = makeView({ id: 'v1', position: 'a0' });
      const v2 = makeView({ id: 'v2', position: 'a1' });
      const model = new DatabaseModel(makeData({ views: [v1, v2] }));
      model.deleteView('v1');
      expect(model.getView('v1')).toBeUndefined();
      expect(model.getViews()).toHaveLength(1);
    });
  });

  describe('snapshot', () => {
    it('returns deep copy of schema, rows, and views', () => {
      const model = new DatabaseModel();
      model.addRow({ title: 'Test' });
      const snap = model.snapshot();
      expect(snap.schema).toEqual(model.getSchema());
      expect(Object.keys(snap.rows)).toHaveLength(1);
      expect(snap.views).toEqual(model.getViews());
    });

    it('mutations to snapshot do not affect model', () => {
      const model = new DatabaseModel();
      const snap = model.snapshot();
      snap.schema.push({ id: 'injected', name: 'Injected', type: 'text', position: 'z0' });
      expect(model.getSchema().find(p => p.id === 'injected')).toBeUndefined();
    });
  });

  describe('positionBetween', () => {
    it('generates a position between two values', () => {
      const pos = DatabaseModel.positionBetween('a0', 'a2');
      expect(pos > 'a0').toBe(true);
      expect(pos < 'a2').toBe(true);
    });

    it('generates a position after a value when before is null', () => {
      const pos = DatabaseModel.positionBetween('a0', null);
      expect(pos > 'a0').toBe(true);
    });

    it('generates a position before a value when after is null', () => {
      const pos = DatabaseModel.positionBetween(null, 'a2');
      expect(pos < 'a2').toBe(true);
    });
  });
});
