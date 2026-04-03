# Database Property Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the kanban-specific data model (columns/cards/KanbanAdapter) with a shared property-based model (schema/rows/views/DatabaseAdapter) so all view types operate on the same data.

**Architecture:** Single `DatabaseModel` holds a property schema, rows (keyed by ID), and view configs. Board columns are derived from a select property's options. The `DatabaseAdapter` interface replaces `KanbanAdapter` with row/property/view operations. Existing board view code adapts by querying the model differently.

**Tech Stack:** TypeScript, Vitest, fractional-indexing, nanoid

**Spec:** `docs/superpowers/specs/2026-04-03-database-property-model-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/tools/database/types.ts` | Rewrite | All type definitions: PropertyDefinition, DatabaseRow, DatabaseViewConfig, DatabaseData, DatabaseAdapter, etc. |
| `src/tools/database/database-model.ts` | Rewrite | Pure data layer: schema CRUD, row CRUD, view CRUD, getRowsGroupedBy, getSelectOptions, snapshot |
| `src/tools/database/database-backend-sync.ts` | Rewrite | Adapter sync: row/property/view methods, debounced updateRow, no-adapter no-op |
| `src/tools/database/index.ts` | Significant update | Orchestrator: single model, board actions → row/property ops, view switching |
| `src/tools/database/database-view.ts` | Moderate update | createBoard() accepts grouped rows + select options instead of columns + cards |
| `src/tools/database/database-card-drawer.ts` | Moderate update | Opens with DatabaseRow, status pill from property value |
| `src/tools/database/database-tab-bar.ts` | Minor update | Uses DatabaseViewConfig instead of DatabaseViewData |
| `src/tools/database/database-card-drag.ts` | Rename only | CardDragResult.cardId → rowId |
| `src/tools/database/database-column-drag.ts` | Rename only | ColumnDragResult → GroupDragResult, column → group |
| `src/tools/database/database-column-controls.ts` | Minor update | Callbacks reference select option ID instead of column ID |
| `src/tools/database/database-view-popover.ts` | No change | Already works with type strings |
| `src/tools/database/database-keyboard.ts` | No change | No data model dependency |
| `test/unit/tools/database/database-model.test.ts` | Rewrite | Model tests |
| `test/unit/tools/database/database-backend-sync.test.ts` | Rewrite | Sync tests |
| `test/unit/tools/database/database.test.ts` | Rewrite | Integration tests |
| `test/unit/tools/database/database-view.test.ts` | Update | New factory fixtures, same DOM assertions |
| `test/unit/tools/database/database-card-drawer.test.ts` | Update | DatabaseRow fixtures, property-based status |
| `test/unit/tools/database/database-tab-bar.test.ts` | Update | DatabaseViewConfig fixtures |
| `test/unit/tools/database/database-card-drag.test.ts` | Update | Result type rename |
| `test/unit/tools/database/database-column-drag.test.ts` | Update | Result type rename |
| `test/unit/tools/database/database-column-controls.test.ts` | Update | Option-based callbacks |
| `index.html` | Update | Playground fixture data in new format |

---

### Task 1: Rewrite types.ts

**Files:**
- Rewrite: `src/tools/database/types.ts`

This is the foundation — all other tasks import from here.

- [ ] **Step 1: Replace types.ts with the new type definitions**

```typescript
import type { BlockToolData, OutputData } from '../../../types';

// ─── Property types ───

export type PropertyType = 'title' | 'text' | 'number' | 'select' | 'multiSelect' | 'date' | 'checkbox' | 'url' | 'richText';

export interface SelectOption {
  id: string;
  label: string;
  color?: string;
  position: string;
}

export interface SelectPropertyConfig {
  options: SelectOption[];
}

export type PropertyConfig = SelectPropertyConfig;

export interface PropertyDefinition {
  id: string;
  name: string;
  type: PropertyType;
  position: string;
  config?: PropertyConfig;
}

export type PropertyValue = string | number | boolean | string[] | OutputData | null;

// ─── Rows ───

export interface DatabaseRow {
  id: string;
  position: string;
  properties: Record<string, PropertyValue>;
}

// ─── View config ───

export type ViewType = 'board' | 'table' | 'gallery' | 'list';

export interface SortConfig {
  propertyId: string;
  direction: 'asc' | 'desc';
}

export interface FilterConfig {
  propertyId: string;
  operator: string;
  value: PropertyValue;
}

export interface DatabaseViewConfig {
  id: string;
  name: string;
  type: ViewType;
  position: string;
  groupBy?: string;
  sorts: SortConfig[];
  filters: FilterConfig[];
  visibleProperties: string[];
}

// ─── Top-level saved data ───

export interface DatabaseData extends BlockToolData {
  schema: PropertyDefinition[];
  rows: Record<string, DatabaseRow>;
  views: DatabaseViewConfig[];
  activeViewId: string;
}

// ─── Adapter ───

export interface DatabaseAdapter {
  loadDatabase(): Promise<{
    schema: PropertyDefinition[];
    rows: DatabaseRow[];
    views: DatabaseViewConfig[];
  }>;

  createRow(params: {
    id: string;
    properties: Record<string, PropertyValue>;
    position: string;
  }): Promise<DatabaseRow>;

  updateRow(params: {
    rowId: string;
    properties: Record<string, PropertyValue>;
  }): Promise<DatabaseRow>;

  moveRow(params: {
    rowId: string;
    position: string;
  }): Promise<DatabaseRow>;

  deleteRow(params: {
    rowId: string;
  }): Promise<void>;

  createProperty(params: {
    id: string;
    name: string;
    type: PropertyType;
    position: string;
    config?: PropertyConfig;
  }): Promise<PropertyDefinition>;

  updateProperty(params: {
    propertyId: string;
    changes: Partial<Pick<PropertyDefinition, 'name' | 'config'>>;
  }): Promise<PropertyDefinition>;

  deleteProperty(params: {
    propertyId: string;
  }): Promise<void>;

  createView(params: {
    id: string;
    name: string;
    type: ViewType;
    position: string;
    groupBy?: string;
    sorts?: SortConfig[];
    filters?: FilterConfig[];
    visibleProperties?: string[];
  }): Promise<DatabaseViewConfig>;

  updateView(params: {
    viewId: string;
    changes: Partial<Pick<DatabaseViewConfig,
      'name' | 'type' | 'position' | 'groupBy' | 'sorts' | 'filters' | 'visibleProperties'
    >>;
  }): Promise<DatabaseViewConfig>;

  deleteView(params: {
    viewId: string;
  }): Promise<void>;
}

export interface DatabaseConfig {
  adapter?: DatabaseAdapter;
}
```

- [ ] **Step 2: Verify no TypeScript errors in the types file**

Run: `npx tsc --noEmit src/tools/database/types.ts`

Note: Other files will now have type errors since they import the old types. That's expected — we fix them in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add src/tools/database/types.ts
git commit -m "feat(database): rewrite types for property-based data model"
```

---

### Task 2: Write DatabaseModel tests

**Files:**
- Rewrite: `test/unit/tools/database/database-model.test.ts`

Write the full test suite first. All tests will fail because the implementation doesn't exist yet.

- [ ] **Step 1: Write the test file**

```typescript
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
        id: 'p1',
        name: 'Status',
        type: 'select',
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
      const prop = makeProperty({
        id: 'status',
        type: 'select',
        config: { options: [optA, optB] },
      });
      const r1 = makeRow({ id: 'r1', position: 'a0', properties: { status: 'optA' } });
      const r2 = makeRow({ id: 'r2', position: 'a1', properties: { status: 'optB' } });
      const r3 = makeRow({ id: 'r3', position: 'a2', properties: { status: 'optA' } });

      const model = new DatabaseModel(makeData({
        schema: [prop],
        rows: { r1, r2, r3 },
      }));

      const groups = model.getRowsGroupedBy('status');

      expect(groups.get('optA')).toHaveLength(2);
      expect(groups.get('optA')![0].id).toBe('r1');
      expect(groups.get('optA')![1].id).toBe('r3');
      expect(groups.get('optB')).toHaveLength(1);
      expect(groups.get('optB')![0].id).toBe('r2');
    });

    it('puts rows with no value under empty string key', () => {
      const opt = makeSelectOption({ id: 'optA', label: 'A', position: 'a0' });
      const prop = makeProperty({
        id: 'status',
        type: 'select',
        config: { options: [opt] },
      });
      const r1 = makeRow({ id: 'r1', position: 'a0', properties: { status: 'optA' } });
      const r2 = makeRow({ id: 'r2', position: 'a1', properties: {} });

      const model = new DatabaseModel(makeData({
        schema: [prop],
        rows: { r1, r2 },
      }));

      const groups = model.getRowsGroupedBy('status');

      expect(groups.get('optA')).toHaveLength(1);
      expect(groups.get('')).toHaveLength(1);
      expect(groups.get('')![0].id).toBe('r2');
    });

    it('sorts rows within each group by position', () => {
      const opt = makeSelectOption({ id: 'optA', label: 'A', position: 'a0' });
      const prop = makeProperty({
        id: 'status',
        type: 'select',
        config: { options: [opt] },
      });
      const r1 = makeRow({ id: 'r1', position: 'a2', properties: { status: 'optA' } });
      const r2 = makeRow({ id: 'r2', position: 'a0', properties: { status: 'optA' } });
      const r3 = makeRow({ id: 'r3', position: 'a1', properties: { status: 'optA' } });

      const model = new DatabaseModel(makeData({
        schema: [prop],
        rows: { r1, r2, r3 },
      }));

      const group = model.getRowsGroupedBy('status').get('optA')!;
      expect(group.map(r => r.id)).toEqual(['r2', 'r3', 'r1']);
    });

    it('groups by checkbox property using true/false keys', () => {
      const prop = makeProperty({ id: 'done', type: 'checkbox' });
      const r1 = makeRow({ id: 'r1', position: 'a0', properties: { done: true } });
      const r2 = makeRow({ id: 'r2', position: 'a1', properties: { done: false } });
      const r3 = makeRow({ id: 'r3', position: 'a2', properties: {} });

      const model = new DatabaseModel(makeData({
        schema: [prop],
        rows: { r1, r2, r3 },
      }));

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
      const prop = makeProperty({
        id: 'p1',
        type: 'select',
        config: { options: [optB, optA] },
      });
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
      expect(model.getViews().length).toBeGreaterThanOrEqual(2); // default + new
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

      snap.schema.push({
        id: 'injected',
        name: 'Injected',
        type: 'text',
        position: 'z0',
      });

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test test/unit/tools/database/database-model.test.ts`
Expected: All tests FAIL (DatabaseModel doesn't implement the new interface yet)

- [ ] **Step 3: Commit failing tests**

```bash
git add test/unit/tools/database/database-model.test.ts
git commit -m "test(database): write failing model tests for property-based data model"
```

---

### Task 3: Implement DatabaseModel

**Files:**
- Rewrite: `src/tools/database/database-model.ts`

Implement the model to make all Task 2 tests pass.

- [ ] **Step 1: Write the implementation**

```typescript
import { generateKeyBetween } from 'fractional-indexing';
import { nanoid } from 'nanoid';
import type {
  DatabaseData,
  DatabaseRow,
  DatabaseViewConfig,
  PropertyConfig,
  PropertyDefinition,
  PropertyType,
  PropertyValue,
  SelectOption,
  ViewType,
} from './types';

/**
 * Pure data layer for a database block.
 *
 * Holds the property schema, rows, and view configs.
 * No DOM side effects — only data mutations and queries.
 */
export class DatabaseModel {
  private schema: PropertyDefinition[];
  private rows: Record<string, DatabaseRow>;
  private views: DatabaseViewConfig[];

  constructor(data?: Partial<DatabaseData>) {
    if (data?.schema !== undefined && data.schema.length > 0) {
      this.schema = data.schema.map((p) => ({ ...p }));
    } else {
      this.schema = DatabaseModel.createDefaultSchema();
    }

    this.rows = {};

    if (data?.rows !== undefined) {
      for (const [id, row] of Object.entries(data.rows)) {
        this.rows[id] = { ...row, properties: { ...row.properties } };
      }
    }

    if (data?.views !== undefined && data.views.length > 0) {
      this.views = data.views.map((v) => ({ ...v, sorts: [...v.sorts], filters: [...v.filters], visibleProperties: [...v.visibleProperties] }));
    } else {
      const statusProp = this.schema.find((p) => p.type === 'select');

      this.views = [DatabaseModel.createDefaultView(statusProp?.id)];
    }
  }

  // ─── Schema ───

  getSchema(): PropertyDefinition[] {
    return [...this.schema];
  }

  getProperty(propertyId: string): PropertyDefinition | undefined {
    return this.schema.find((p) => p.id === propertyId);
  }

  addProperty(name: string, type: PropertyType, config?: PropertyConfig): PropertyDefinition {
    const lastPosition = this.schema.length > 0
      ? this.schema[this.schema.length - 1].position
      : null;

    const prop: PropertyDefinition = {
      id: nanoid(),
      name,
      type,
      position: generateKeyBetween(lastPosition, null),
      ...(config !== undefined ? { config } : {}),
    };

    this.schema.push(prop);

    return prop;
  }

  updateProperty(propertyId: string, changes: Partial<Pick<PropertyDefinition, 'name' | 'config'>>): void {
    const prop = this.schema.find((p) => p.id === propertyId);

    if (prop === undefined) {
      return;
    }

    if (changes.name !== undefined) {
      prop.name = changes.name;
    }

    if (changes.config !== undefined) {
      prop.config = changes.config;
    }
  }

  deleteProperty(propertyId: string): void {
    this.schema = this.schema.filter((p) => p.id !== propertyId);

    for (const row of Object.values(this.rows)) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete row.properties[propertyId];
    }
  }

  // ─── Rows ───

  getOrderedRows(): DatabaseRow[] {
    return Object.values(this.rows).sort((a, b) => (a.position < b.position ? -1 : 1));
  }

  getRow(rowId: string): DatabaseRow | undefined {
    return this.rows[rowId];
  }

  addRow(properties: Record<string, PropertyValue> = {}): DatabaseRow {
    const orderedRows = this.getOrderedRows();
    const lastPosition = orderedRows.length > 0
      ? orderedRows[orderedRows.length - 1].position
      : null;

    const row: DatabaseRow = {
      id: nanoid(),
      position: generateKeyBetween(lastPosition, null),
      properties: { ...properties },
    };

    this.rows[row.id] = row;

    return row;
  }

  updateRow(rowId: string, properties: Record<string, PropertyValue>): void {
    const row = this.rows[rowId];

    if (row === undefined) {
      return;
    }

    Object.assign(row.properties, properties);
  }

  moveRow(rowId: string, position: string): void {
    const row = this.rows[rowId];

    if (row === undefined) {
      return;
    }

    row.position = position;
  }

  deleteRow(rowId: string): void {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete this.rows[rowId];
  }

  // ─── View-oriented queries ───

  getRowsGroupedBy(propertyId: string): Map<string, DatabaseRow[]> {
    const groups = new Map<string, DatabaseRow[]>();
    const ordered = this.getOrderedRows();

    for (const row of ordered) {
      const rawValue = row.properties[propertyId];
      let key: string;

      if (rawValue === undefined || rawValue === null) {
        key = '';
      } else if (typeof rawValue === 'boolean') {
        key = String(rawValue);
      } else {
        key = String(rawValue);
      }

      const existing = groups.get(key);

      if (existing !== undefined) {
        existing.push(row);
      } else {
        groups.set(key, [row]);
      }
    }

    return groups;
  }

  getSelectOptions(propertyId: string): SelectOption[] {
    const prop = this.getProperty(propertyId);

    if (prop === undefined || (prop.type !== 'select' && prop.type !== 'multiSelect')) {
      return [];
    }

    const options = prop.config?.options ?? [];

    return [...options].sort((a, b) => (a.position < b.position ? -1 : 1));
  }

  // ─── Views ───

  getViews(): DatabaseViewConfig[] {
    return [...this.views];
  }

  getView(viewId: string): DatabaseViewConfig | undefined {
    return this.views.find((v) => v.id === viewId);
  }

  addView(name: string, type: ViewType, config: Partial<Pick<DatabaseViewConfig, 'groupBy' | 'sorts' | 'filters' | 'visibleProperties'>> = {}): DatabaseViewConfig {
    const sorted = [...this.views].sort((a, b) => (a.position < b.position ? -1 : 1));
    const lastPosition = sorted.length > 0 ? sorted[sorted.length - 1].position : null;

    const view: DatabaseViewConfig = {
      id: nanoid(),
      name,
      type,
      position: generateKeyBetween(lastPosition, null),
      groupBy: config.groupBy,
      sorts: config.sorts ?? [],
      filters: config.filters ?? [],
      visibleProperties: config.visibleProperties ?? [],
    };

    this.views.push(view);

    return view;
  }

  updateView(viewId: string, changes: Partial<Pick<DatabaseViewConfig, 'name' | 'type' | 'position' | 'groupBy' | 'sorts' | 'filters' | 'visibleProperties'>>): void {
    const view = this.views.find((v) => v.id === viewId);

    if (view === undefined) {
      return;
    }

    Object.assign(view, changes);
  }

  deleteView(viewId: string): void {
    this.views = this.views.filter((v) => v.id !== viewId);
  }

  // ─── Snapshot ───

  snapshot(): DatabaseData {
    const rowsCopy: Record<string, DatabaseRow> = {};

    for (const [id, row] of Object.entries(this.rows)) {
      rowsCopy[id] = {
        id: row.id,
        position: row.position,
        properties: JSON.parse(JSON.stringify(row.properties)) as Record<string, PropertyValue>,
      };
    }

    return {
      schema: JSON.parse(JSON.stringify(this.schema)) as PropertyDefinition[],
      rows: rowsCopy,
      views: JSON.parse(JSON.stringify(this.views)) as DatabaseViewConfig[],
      activeViewId: this.views.length > 0 ? this.views[0].id : '',
    };
  }

  // ─── Static helpers ───

  static positionBetween(after: string | null, before: string | null): string {
    return generateKeyBetween(after, before);
  }

  private static createDefaultSchema(): PropertyDefinition[] {
    const titleId = nanoid();
    const statusId = nanoid();

    return [
      {
        id: titleId,
        name: 'Title',
        type: 'title',
        position: 'a0',
      },
      {
        id: statusId,
        name: 'Status',
        type: 'select',
        position: 'a1',
        config: {
          options: [
            { id: nanoid(), label: 'Not started', color: 'gray', position: 'a0' },
            { id: nanoid(), label: 'In progress', color: 'blue', position: 'a1' },
            { id: nanoid(), label: 'Done', color: 'green', position: 'a2' },
          ],
        },
      },
    ];
  }

  private static createDefaultView(groupByPropertyId?: string): DatabaseViewConfig {
    return {
      id: nanoid(),
      name: 'Board',
      type: 'board',
      position: 'a0',
      groupBy: groupByPropertyId,
      sorts: [],
      filters: [],
      visibleProperties: [],
    };
  }
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `yarn test test/unit/tools/database/database-model.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/tools/database/database-model.ts test/unit/tools/database/database-model.test.ts
git commit -m "feat(database): implement property-based DatabaseModel"
```

---

### Task 4: Write DatabaseBackendSync tests

**Files:**
- Rewrite: `test/unit/tools/database/database-backend-sync.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseBackendSync } from '../../../../src/tools/database/database-backend-sync';
import type { DatabaseAdapter } from '../../../../src/tools/database/types';

const createMockAdapter = (): DatabaseAdapter => ({
  loadDatabase: vi.fn().mockResolvedValue({ schema: [], rows: [], views: [] }),
  createRow: vi.fn().mockResolvedValue({ id: 'r1', position: 'a0', properties: {} }),
  updateRow: vi.fn().mockResolvedValue({ id: 'r1', position: 'a0', properties: {} }),
  moveRow: vi.fn().mockResolvedValue({ id: 'r1', position: 'a0', properties: {} }),
  deleteRow: vi.fn().mockResolvedValue(undefined),
  createProperty: vi.fn().mockResolvedValue({ id: 'p1', name: 'P', type: 'text', position: 'a0' }),
  updateProperty: vi.fn().mockResolvedValue({ id: 'p1', name: 'P', type: 'text', position: 'a0' }),
  deleteProperty: vi.fn().mockResolvedValue(undefined),
  createView: vi.fn().mockResolvedValue({ id: 'v1', name: 'V', type: 'board', position: 'a0', sorts: [], filters: [], visibleProperties: [] }),
  updateView: vi.fn().mockResolvedValue({ id: 'v1', name: 'V', type: 'board', position: 'a0', sorts: [], filters: [], visibleProperties: [] }),
  deleteView: vi.fn().mockResolvedValue(undefined),
});

describe('DatabaseBackendSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('no adapter', () => {
    it('all sync methods are silent no-ops', async () => {
      const sync = new DatabaseBackendSync();

      await expect(sync.syncCreateRow({ id: 'r1', properties: {}, position: 'a0' })).resolves.toBeUndefined();
      await expect(sync.syncMoveRow({ rowId: 'r1', position: 'a1' })).resolves.toBeUndefined();
      await expect(sync.syncDeleteRow({ rowId: 'r1' })).resolves.toBeUndefined();
      await expect(sync.syncCreateProperty({ id: 'p1', name: 'P', type: 'text', position: 'a0' })).resolves.toBeUndefined();
      await expect(sync.syncUpdateProperty({ propertyId: 'p1', changes: { name: 'Q' } })).resolves.toBeUndefined();
      await expect(sync.syncDeleteProperty({ propertyId: 'p1' })).resolves.toBeUndefined();
      await expect(sync.syncCreateView({ id: 'v1', name: 'V', type: 'board', position: 'a0' })).resolves.toBeUndefined();
      await expect(sync.syncUpdateView({ viewId: 'v1', changes: { name: 'W' } })).resolves.toBeUndefined();
      await expect(sync.syncDeleteView({ viewId: 'v1' })).resolves.toBeUndefined();

      // syncUpdateRow is void (debounced), so just call it without error
      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'Test' } });
    });
  });

  describe('row operations', () => {
    it('syncCreateRow calls adapter.createRow', async () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);

      await sync.syncCreateRow({ id: 'r1', properties: { title: 'Hi' }, position: 'a0' });
      expect(adapter.createRow).toHaveBeenCalledWith({ id: 'r1', properties: { title: 'Hi' }, position: 'a0' });
    });

    it('syncMoveRow calls adapter.moveRow', async () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);

      await sync.syncMoveRow({ rowId: 'r1', position: 'a5' });
      expect(adapter.moveRow).toHaveBeenCalledWith({ rowId: 'r1', position: 'a5' });
    });

    it('syncDeleteRow calls adapter.deleteRow', async () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);

      await sync.syncDeleteRow({ rowId: 'r1' });
      expect(adapter.deleteRow).toHaveBeenCalledWith({ rowId: 'r1' });
    });

    it('syncUpdateRow debounces at 500ms', () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);

      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'First' } });
      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'Second' } });

      expect(adapter.updateRow).not.toHaveBeenCalled();

      vi.advanceTimersByTime(500);

      expect(adapter.updateRow).toHaveBeenCalledTimes(1);
      expect(adapter.updateRow).toHaveBeenCalledWith({ rowId: 'r1', properties: { title: 'Second' } });
    });
  });

  describe('property operations', () => {
    it('syncCreateProperty calls adapter.createProperty', async () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);

      await sync.syncCreateProperty({ id: 'p1', name: 'Priority', type: 'select', position: 'a0' });
      expect(adapter.createProperty).toHaveBeenCalledWith({ id: 'p1', name: 'Priority', type: 'select', position: 'a0' });
    });

    it('syncUpdateProperty calls adapter.updateProperty', async () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);

      await sync.syncUpdateProperty({ propertyId: 'p1', changes: { name: 'Phase' } });
      expect(adapter.updateProperty).toHaveBeenCalledWith({ propertyId: 'p1', changes: { name: 'Phase' } });
    });

    it('syncDeleteProperty calls adapter.deleteProperty', async () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);

      await sync.syncDeleteProperty({ propertyId: 'p1' });
      expect(adapter.deleteProperty).toHaveBeenCalledWith({ propertyId: 'p1' });
    });
  });

  describe('view operations', () => {
    it('syncCreateView calls adapter.createView', async () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);

      await sync.syncCreateView({ id: 'v1', name: 'Table', type: 'table', position: 'a0' });
      expect(adapter.createView).toHaveBeenCalledWith({ id: 'v1', name: 'Table', type: 'table', position: 'a0' });
    });

    it('syncUpdateView calls adapter.updateView', async () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);

      await sync.syncUpdateView({ viewId: 'v1', changes: { name: 'Renamed' } });
      expect(adapter.updateView).toHaveBeenCalledWith({ viewId: 'v1', changes: { name: 'Renamed' } });
    });

    it('syncDeleteView calls adapter.deleteView', async () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);

      await sync.syncDeleteView({ viewId: 'v1' });
      expect(adapter.deleteView).toHaveBeenCalledWith({ viewId: 'v1' });
    });
  });

  describe('error handling', () => {
    it('calls onError when adapter throws', async () => {
      const adapter = createMockAdapter();
      const error = new Error('Network fail');
      (adapter.createRow as ReturnType<typeof vi.fn>).mockRejectedValue(error);
      const onError = vi.fn();

      const sync = new DatabaseBackendSync(adapter, onError);

      await sync.syncCreateRow({ id: 'r1', properties: {}, position: 'a0' });
      expect(onError).toHaveBeenCalledWith(error);
    });
  });

  describe('flush and destroy', () => {
    it('flushPendingUpdates sends all debounced updates immediately', () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);

      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'A' } });
      sync.syncUpdateRow({ rowId: 'r2', properties: { title: 'B' } });

      expect(adapter.updateRow).not.toHaveBeenCalled();

      sync.flushPendingUpdates();

      expect(adapter.updateRow).toHaveBeenCalledTimes(2);
    });

    it('destroy clears pending timers without sending', () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);

      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'A' } });
      sync.destroy();

      vi.advanceTimersByTime(1000);
      expect(adapter.updateRow).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test test/unit/tools/database/database-backend-sync.test.ts`
Expected: All tests FAIL

- [ ] **Step 3: Commit failing tests**

```bash
git add test/unit/tools/database/database-backend-sync.test.ts
git commit -m "test(database): write failing sync tests for DatabaseAdapter"
```

---

### Task 5: Implement DatabaseBackendSync

**Files:**
- Rewrite: `src/tools/database/database-backend-sync.ts`

- [ ] **Step 1: Write the implementation**

```typescript
import type { DatabaseAdapter } from './types';

const UPDATE_DEBOUNCE_MS = 500;

/**
 * Orchestrates communication between the DatabaseTool and an optional DatabaseAdapter.
 *
 * - Immediate sync for discrete actions (create, delete, move, property ops, view ops)
 * - Debounced sync for row text edits (500ms)
 * - No-adapter mode: all methods are silent no-ops
 */
export class DatabaseBackendSync {
  private readonly adapter: DatabaseAdapter | undefined;
  private readonly onError: ((error: unknown) => void) | undefined;

  private readonly pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingUpdates = new Map<string, Parameters<DatabaseAdapter['updateRow']>[0]>();

  constructor(adapter?: DatabaseAdapter, onError?: (error: unknown) => void) {
    this.adapter = adapter;
    this.onError = onError;
  }

  private async safeCall<T>(fn: (adapter: DatabaseAdapter) => Promise<T>): Promise<T | undefined> {
    if (this.adapter === undefined) {
      return undefined;
    }

    try {
      return await fn(this.adapter);
    } catch (error) {
      this.onError?.(error);

      return undefined;
    }
  }

  // ─── Row operations ───

  async syncCreateRow(params: Parameters<DatabaseAdapter['createRow']>[0]): Promise<ReturnType<DatabaseAdapter['createRow']> extends Promise<infer R> ? R | undefined : never> {
    return this.safeCall((adapter) => adapter.createRow(params));
  }

  syncUpdateRow(params: Parameters<DatabaseAdapter['updateRow']>[0]): void {
    if (this.adapter === undefined) {
      return;
    }

    const { rowId } = params;
    const existingTimer = this.pendingTimers.get(rowId);

    if (existingTimer !== undefined) {
      clearTimeout(existingTimer);
    }

    this.pendingUpdates.set(rowId, params);

    const timer = setTimeout(() => {
      this.flushRow(rowId);
    }, UPDATE_DEBOUNCE_MS);

    this.pendingTimers.set(rowId, timer);
  }

  async syncMoveRow(params: Parameters<DatabaseAdapter['moveRow']>[0]): Promise<ReturnType<DatabaseAdapter['moveRow']> extends Promise<infer R> ? R | undefined : never> {
    return this.safeCall((adapter) => adapter.moveRow(params));
  }

  async syncDeleteRow(params: Parameters<DatabaseAdapter['deleteRow']>[0]): Promise<void> {
    await this.safeCall((adapter) => adapter.deleteRow(params));
  }

  // ─── Property operations ───

  async syncCreateProperty(params: Parameters<DatabaseAdapter['createProperty']>[0]): Promise<ReturnType<DatabaseAdapter['createProperty']> extends Promise<infer R> ? R | undefined : never> {
    return this.safeCall((adapter) => adapter.createProperty(params));
  }

  async syncUpdateProperty(params: Parameters<DatabaseAdapter['updateProperty']>[0]): Promise<ReturnType<DatabaseAdapter['updateProperty']> extends Promise<infer R> ? R | undefined : never> {
    return this.safeCall((adapter) => adapter.updateProperty(params));
  }

  async syncDeleteProperty(params: Parameters<DatabaseAdapter['deleteProperty']>[0]): Promise<void> {
    await this.safeCall((adapter) => adapter.deleteProperty(params));
  }

  // ─── View operations ───

  async syncCreateView(params: Parameters<DatabaseAdapter['createView']>[0]): Promise<ReturnType<DatabaseAdapter['createView']> extends Promise<infer R> ? R | undefined : never> {
    return this.safeCall((adapter) => adapter.createView(params));
  }

  async syncUpdateView(params: Parameters<DatabaseAdapter['updateView']>[0]): Promise<ReturnType<DatabaseAdapter['updateView']> extends Promise<infer R> ? R | undefined : never> {
    return this.safeCall((adapter) => adapter.updateView(params));
  }

  async syncDeleteView(params: Parameters<DatabaseAdapter['deleteView']>[0]): Promise<void> {
    await this.safeCall((adapter) => adapter.deleteView(params));
  }

  // ─── Flush & destroy ───

  flushPendingUpdates(): void {
    for (const rowId of this.pendingTimers.keys()) {
      this.flushRow(rowId);
    }
  }

  destroy(): void {
    for (const timer of this.pendingTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
    this.pendingUpdates.clear();
  }

  private flushRow(rowId: string): void {
    const timer = this.pendingTimers.get(rowId);

    if (timer !== undefined) {
      clearTimeout(timer);
    }

    this.pendingTimers.delete(rowId);

    const params = this.pendingUpdates.get(rowId);

    this.pendingUpdates.delete(rowId);

    if (params !== undefined) {
      void this.safeCall((adapter) => adapter.updateRow(params));
    }
  }
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `yarn test test/unit/tools/database/database-backend-sync.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/tools/database/database-backend-sync.ts test/unit/tools/database/database-backend-sync.test.ts
git commit -m "feat(database): implement property-based DatabaseBackendSync"
```

---

### Task 6: Update DatabaseView (rendering layer)

**Files:**
- Modify: `src/tools/database/database-view.ts`
- Modify: `test/unit/tools/database/database-view.test.ts`

The view still renders the same DOM structure (columns, cards, buttons), but its inputs change from `KanbanColumnData`/`KanbanCardData` to `SelectOption`/`DatabaseRow`.

- [ ] **Step 1: Update the test factories and imports**

In `test/unit/tools/database/database-view.test.ts`, replace the old factory fixtures with:

```typescript
import type { SelectOption, DatabaseRow } from '../../../../src/tools/database/types';

const makeOption = (overrides: Partial<SelectOption> = {}): SelectOption => ({
  id: `opt-${Math.random().toString(36).slice(2, 6)}`,
  label: 'Option',
  color: 'gray',
  position: 'a0',
  ...overrides,
});

const makeRow = (overrides: Partial<DatabaseRow> = {}): DatabaseRow => ({
  id: `row-${Math.random().toString(36).slice(2, 6)}`,
  position: 'a0',
  properties: {},
  ...overrides,
});
```

Replace all `makeColumn(...)` calls with `makeOption(...)` and all `makeCard(...)` calls with `makeRow(...)` throughout the file. In `makeRow`, set `properties: { title: 'Card text' }` wherever the test previously used `{ title: 'Card text' }` in `makeCard`.

Update `createBoard` calls: the old signature was `createBoard(columns, getCards)`. The new signature is `createBoard(options, getRows, titlePropertyId)` where:
- `options: SelectOption[]` replaces `columns: KanbanColumnData[]`
- `getRows: (optionId: string) => DatabaseRow[]` replaces `getCards: (columnId: string) => KanbanCardData[]`
- `titlePropertyId: string` is the ID of the title property (used to extract card titles from row properties)

Replace all `card.title` references with `row.properties[titlePropertyId]`.

- [ ] **Step 2: Update the implementation**

In `src/tools/database/database-view.ts`:

Replace imports:
```typescript
import type { SelectOption, DatabaseRow } from './types';
```

Update `createBoard` signature:
```typescript
createBoard(
  options: SelectOption[],
  getRows: (optionId: string) => DatabaseRow[],
  titlePropertyId: string,
): HTMLDivElement
```

Update `createColumnElement` to accept `SelectOption` instead of `KanbanColumnData`:
```typescript
private createColumnElement(option: SelectOption, rows: DatabaseRow[], titlePropertyId: string): HTMLDivElement
```

Update `createCardElement` to accept `DatabaseRow`:
```typescript
private createCardElement(row: DatabaseRow, titlePropertyId: string): HTMLDivElement
```

Inside `createCardElement`, the title text becomes:
```typescript
const titleValue = row.properties[titlePropertyId];
titleEl.textContent = typeof titleValue === 'string' ? titleValue : '';
```

The card element attributes change:
- `data-card-id` → `data-row-id` (set to `row.id`)

The `appendCard`, `removeCard`, `updateCardTitle` methods similarly change parameter names from `card`/`cardId` to `row`/`rowId`.

The column header attributes:
- Keep `data-column-id` as `data-option-id` (set to `option.id`)
- Column title = `option.label`
- Column dot color = `option.color`

- [ ] **Step 3: Run tests**

Run: `yarn test test/unit/tools/database/database-view.test.ts`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/tools/database/database-view.ts test/unit/tools/database/database-view.test.ts
git commit -m "refactor(database): update DatabaseView to use SelectOption and DatabaseRow"
```

---

### Task 7: Update drag result types

**Files:**
- Modify: `src/tools/database/database-card-drag.ts`
- Modify: `test/unit/tools/database/database-card-drag.test.ts`
- Modify: `src/tools/database/database-column-drag.ts`
- Modify: `test/unit/tools/database/database-column-drag.test.ts`

- [ ] **Step 1: Update CardDragResult**

In `src/tools/database/database-card-drag.ts`, rename the result interface:

```typescript
export interface CardDragResult {
  rowId: string;           // was cardId
  toOptionId: string;      // was toColumnId
  beforeRowId: string | null;  // was beforeCardId
  afterRowId: string | null;   // was afterCardId
}
```

Update internal references: the drag logic reads from DOM attributes. Change `data-card-id` reads to `data-row-id`, and `data-column-id` reads to `data-option-id` in `commitDrop`, `findTargetColumn`, `getDropPosition`, `resolveAfterCardId`.

- [ ] **Step 2: Update ColumnDragResult → GroupDragResult**

In `src/tools/database/database-column-drag.ts`, rename:

```typescript
export interface GroupDragResult {
  optionId: string;              // was columnId
  beforeOptionId: string | null; // was beforeColumnId
  afterOptionId: string | null;  // was afterColumnId
}
```

Rename `ColumnDragOptions` → `GroupDragOptions`. Update `data-column-id` reads to `data-option-id` in DOM queries.

- [ ] **Step 3: Update both test files**

Update the test files to use the new result property names and DOM attributes.

- [ ] **Step 4: Run tests**

Run: `yarn test test/unit/tools/database/database-card-drag.test.ts test/unit/tools/database/database-column-drag.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/database/database-card-drag.ts src/tools/database/database-column-drag.ts \
       test/unit/tools/database/database-card-drag.test.ts test/unit/tools/database/database-column-drag.test.ts
git commit -m "refactor(database): rename drag result types to row/option vocabulary"
```

---

### Task 8: Update DatabaseColumnControls

**Files:**
- Modify: `src/tools/database/database-column-controls.ts`
- Modify: `test/unit/tools/database/database-column-controls.test.ts`

- [ ] **Step 1: Update the interface**

In `src/tools/database/database-column-controls.ts`, rename the callback parameters:

```typescript
export interface ColumnControlsOptions {
  i18n: I18n;
  onRename: (optionId: string, label: string) => void;  // was (columnId, title)
  onDelete: (optionId: string) => void;                  // was (columnId)
}
```

In `makeEditable`, rename `columnId` parameter to `optionId`.

- [ ] **Step 2: Update tests**

In the test file, update the callback parameter assertions to use `optionId`/`label`.

- [ ] **Step 3: Run tests**

Run: `yarn test test/unit/tools/database/database-column-controls.test.ts`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/tools/database/database-column-controls.ts test/unit/tools/database/database-column-controls.test.ts
git commit -m "refactor(database): rename column controls to option vocabulary"
```

---

### Task 9: Update DatabaseCardDrawer

**Files:**
- Modify: `src/tools/database/database-card-drawer.ts`
- Modify: `test/unit/tools/database/database-card-drawer.test.ts`

- [ ] **Step 1: Update imports and `open`/`loadCard` signatures**

In `src/tools/database/database-card-drawer.ts`:

Replace imports:
```typescript
import type { DatabaseRow, SelectOption, PropertyDefinition } from './types';
```

Update `CardDrawerOptions`:
```typescript
export interface CardDrawerOptions {
  wrapper: HTMLElement;
  readOnly: boolean;
  toolsConfig?: ToolsConfig;
  titlePropertyId: string;                                                    // NEW
  descriptionPropertyId?: string;                                             // NEW (optional richText property)
  onTitleChange: (rowId: string, title: string) => void;                     // was (cardId, title)
  onDescriptionChange: (rowId: string, description: OutputData) => void;     // was (cardId, description)
  onClose: () => void;
}
```

Update `open` and `loadCard` to accept `DatabaseRow` and `SelectOption`:
```typescript
open(row: DatabaseRow, option?: SelectOption): void
private loadCard(row: DatabaseRow, option?: SelectOption): void
```

Inside `open`/`loadCard`, extract title from `row.properties[this.titlePropertyId]` instead of `card.title`. Extract description from `row.properties[this.descriptionPropertyId]` instead of `card.description`.

The status pill in `createPropertyRow` uses `option.label` and `option.color` instead of `column.title` and `column.color`.

- [ ] **Step 2: Update test factories**

In `test/unit/tools/database/database-card-drawer.test.ts`:

Replace `makeCard()` with:
```typescript
const makeRow = (overrides: Partial<DatabaseRow> = {}): DatabaseRow => ({
  id: `row-${Math.random().toString(36).slice(2, 6)}`,
  position: 'a0',
  properties: { 'prop-title': 'Test card', 'prop-status': 'opt-1' },
  ...overrides,
});
```

Replace `makeColumn()` with:
```typescript
const makeOption = (overrides: Partial<SelectOption> = {}): SelectOption => ({
  id: `opt-${Math.random().toString(36).slice(2, 6)}`,
  label: 'Status',
  color: 'blue',
  position: 'a0',
  ...overrides,
});
```

Update `createOptions` to include `titlePropertyId: 'prop-title'`.

Replace all `drawer.open(card, column)` with `drawer.open(row, option)`.

Update DOM attribute checks: `data-card-id` → `data-row-id`.

- [ ] **Step 3: Run tests**

Run: `yarn test test/unit/tools/database/database-card-drawer.test.ts`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/tools/database/database-card-drawer.ts test/unit/tools/database/database-card-drawer.test.ts
git commit -m "refactor(database): update card drawer to use DatabaseRow and SelectOption"
```

---

### Task 10: Update DatabaseTabBar

**Files:**
- Modify: `src/tools/database/database-tab-bar.ts`
- Modify: `test/unit/tools/database/database-tab-bar.test.ts`

- [ ] **Step 1: Update imports**

In `src/tools/database/database-tab-bar.ts`, replace:
```typescript
import type { DatabaseViewData } from './types';
```
with:
```typescript
import type { DatabaseViewConfig, ViewType } from './types';
```

Update the `TabBarOptions` interface:
```typescript
export interface TabBarOptions {
  views: DatabaseViewConfig[];               // was DatabaseViewData[]
  activeViewId: string;
  onTabClick: (viewId: string) => void;
  onAddView: (type: ViewType) => void;       // was (type: 'board')
  onRename: (viewId: string, newName: string) => void;
  onDuplicate: (viewId: string) => void;
  onDelete: (viewId: string) => void;
  onReorder: (viewId: string, newPosition: string) => void;
}
```

Replace all `DatabaseViewData` references in the class body with `DatabaseViewConfig`.

- [ ] **Step 2: Update test factories**

In `test/unit/tools/database/database-tab-bar.test.ts`, replace `makeView()`:
```typescript
import type { DatabaseViewConfig } from '../../../../src/tools/database/types';

const makeView = (overrides: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id: `view-${Math.random().toString(36).slice(2, 6)}`,
  name: 'Board',
  type: 'board',
  position: 'a0',
  sorts: [],
  filters: [],
  visibleProperties: [],
  ...overrides,
});
```

- [ ] **Step 3: Run tests**

Run: `yarn test test/unit/tools/database/database-tab-bar.test.ts`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/tools/database/database-tab-bar.ts test/unit/tools/database/database-tab-bar.test.ts
git commit -m "refactor(database): update tab bar to use DatabaseViewConfig"
```

---

### Task 11: Rewrite DatabaseTool integration tests

**Files:**
- Rewrite: `test/unit/tools/database/database.test.ts`

This is the orchestrator test — it exercises the full flow from render to save to validate, using the new property-based model.

- [ ] **Step 1: Rewrite the test file**

The test structure follows the same patterns as the existing file but with new types. Key test groups:

1. **static getters** — toolbox entries, isReadOnlySupported
2. **constructor** — creates default model with title+status schema, single board view
3. **render/save roundtrip** — save() returns DatabaseData with schema, rows, views
4. **validate** — rejects empty views, requires title property in schema, requires board views to have groupBy
5. **add row via click** — clicking "+ New Page" creates a row with the groupBy property value set to that column's option ID
6. **add column via click** — clicking "+ Column" adds a select option to the groupBy property
7. **delete row** — removes row from model and syncs
8. **column rename** — updates the select option label
9. **column delete** — removes select option, deletes rows in that group
10. **drawer integration** — clicking card opens drawer with DatabaseRow
11. **multi-view** — single model shared across views, view switching, add/duplicate/delete/rename/reorder views
12. **destroy** — cleans up subsystems

Due to the size of this file (~800+ lines), implement it following the exact patterns from the current `database.test.ts` but replacing:
- `KanbanData` → `DatabaseData`
- `KanbanCardData` → `DatabaseRow`
- `KanbanColumnData` → `SelectOption`
- `DatabaseViewData` → `DatabaseViewConfig`
- `cardMap` → `rows`
- `columns` → `schema[statusPropIndex].config.options`
- `columnId` → property value
- `viewModels: Map` → single `model`

The `createMockAPI()` and `createDatabaseOptions()` factories remain similar, but `data` is now `DatabaseData` shape.

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test test/unit/tools/database/database.test.ts`
Expected: Tests FAIL (index.ts hasn't been updated yet)

- [ ] **Step 3: Commit failing tests**

```bash
git add test/unit/tools/database/database.test.ts
git commit -m "test(database): rewrite integration tests for property-based model"
```

---

### Task 12: Update DatabaseTool orchestrator

**Files:**
- Modify: `src/tools/database/index.ts`

This is the largest update. The orchestrator changes from managing `viewModels: Map<string, DatabaseModel>` (one per view) to a single `model: DatabaseModel`.

- [ ] **Step 1: Update imports**

Replace:
```typescript
import type { DatabaseData, DatabaseViewData, KanbanData, DatabaseConfig } from './types';
```
with:
```typescript
import type { DatabaseData, DatabaseViewConfig, DatabaseConfig, PropertyValue } from './types';
```

Update drag result imports:
```typescript
import type { CardDragResult } from './database-card-drag';
import { DatabaseColumnDrag } from './database-column-drag';
import type { GroupDragResult } from './database-column-drag';
```

- [ ] **Step 2: Refactor class properties**

Remove:
```typescript
private views: DatabaseViewData[];
private activeViewId: string;
private viewModels: Map<string, DatabaseModel> = new Map();
```

Replace with:
```typescript
private model: DatabaseModel;
private activeViewId: string;
```

- [ ] **Step 3: Update constructor**

The constructor now creates a single `DatabaseModel` from the incoming `DatabaseData`:

```typescript
constructor({ data, config, api, block, readOnly }: BlockToolConstructorOptions<DatabaseData, DatabaseConfig>) {
  this.api = api;
  this.block = block;
  this.readOnly = readOnly;
  this.config = config ?? {};

  this.model = new DatabaseModel(data as DatabaseData | undefined);
  const views = this.model.getViews();
  this.activeViewId = (data as DatabaseData)?.activeViewId ?? (views.length > 0 ? views[0].id : '');

  this.activateView(this.activeViewId);
}
```

- [ ] **Step 4: Update save()**

```typescript
save(_blockContent: HTMLElement): DatabaseData {
  return {
    ...this.model.snapshot(),
    activeViewId: this.activeViewId,
  };
}
```

- [ ] **Step 5: Update validate()**

```typescript
validate(savedData: DatabaseData): boolean {
  const hasTitleProp = savedData.schema.some((p) => p.type === 'title');
  const hasViews = savedData.views.length > 0;
  const boardViewsValid = savedData.views
    .filter((v) => v.type === 'board')
    .every((v) => v.groupBy !== undefined);

  return hasTitleProp && hasViews && boardViewsValid;
}
```

- [ ] **Step 6: Update activateView**

No longer creates a model — just sets up the view and sync:

```typescript
private activateView(viewId: string): void {
  const viewConfig = this.model.getView(viewId);
  if (viewConfig === undefined) return;

  this.activeViewId = viewId;
  this.view = new DatabaseView({ readOnly: this.readOnly, i18n: this.api.i18n });
  this.sync = new DatabaseBackendSync(this.config.adapter, (error) => {
    this.api.notifier.show({ message: String(error), style: 'error' });
  });
}
```

- [ ] **Step 7: Update renderActiveBoard**

The board reads from the model using the active view's `groupBy`:

```typescript
private renderActiveBoard(): HTMLDivElement {
  const viewConfig = this.model.getView(this.activeViewId);
  const groupByPropId = viewConfig?.groupBy;
  const titleProp = this.model.getSchema().find((p) => p.type === 'title');
  const titlePropId = titleProp?.id ?? '';

  if (groupByPropId === undefined) {
    return this.view.createBoard([], () => [], titlePropId);
  }

  const options = this.model.getSelectOptions(groupByPropId);
  const groups = this.model.getRowsGroupedBy(groupByPropId);

  return this.view.createBoard(
    options,
    (optionId) => groups.get(optionId) ?? [],
    titlePropId,
  );
}
```

- [ ] **Step 8: Update event handlers**

`handleAddCard` becomes `handleAddRow`:
```typescript
private handleAddRow(optionId: string, boardEl: HTMLDivElement): void {
  const viewConfig = this.model.getView(this.activeViewId);
  const groupByPropId = viewConfig?.groupBy;
  if (groupByPropId === undefined) return;

  const titleProp = this.model.getSchema().find((p) => p.type === 'title');
  const row = this.model.addRow({
    ...(titleProp !== undefined ? { [titleProp.id]: this.api.i18n.t('tools.database.newPage') } : {}),
    [groupByPropId]: optionId,
  });

  // ... append to DOM, sync
  void this.sync.syncCreateRow({ id: row.id, properties: row.properties, position: row.position });
}
```

`handleCardDrop` becomes:
```typescript
private handleCardDrop(result: CardDragResult): void {
  const { rowId, toOptionId, beforeRowId, afterRowId } = result;
  // Calculate position between before/after rows
  const viewConfig = this.model.getView(this.activeViewId);
  const groupByPropId = viewConfig?.groupBy;
  if (groupByPropId === undefined) return;

  const beforeRow = beforeRowId !== null ? this.model.getRow(beforeRowId) : undefined;
  const afterRow = afterRowId !== null ? this.model.getRow(afterRowId) : undefined;
  const position = DatabaseModel.positionBetween(afterRow?.position ?? null, beforeRow?.position ?? null);

  // Update row: change groupBy property + position
  this.model.updateRow(rowId, { [groupByPropId]: toOptionId });
  this.model.moveRow(rowId, position);
  this.rerenderBoard();

  void this.sync.syncUpdateRow({ rowId, properties: { [groupByPropId]: toOptionId } });
  void this.sync.syncMoveRow({ rowId, position });
}
```

`handleAddColumn` becomes adding a select option:
```typescript
private handleAddColumn(boardEl: HTMLDivElement): void {
  const viewConfig = this.model.getView(this.activeViewId);
  const groupByPropId = viewConfig?.groupBy;
  if (groupByPropId === undefined) return;

  const prop = this.model.getProperty(groupByPropId);
  if (prop?.config === undefined) return;

  const existingOptions = prop.config.options;
  const lastPosition = existingOptions.length > 0 ? existingOptions[existingOptions.length - 1].position : null;
  const newOption = {
    id: nanoid(),
    label: this.api.i18n.t('tools.database.columnTitlePlaceholder'),
    position: generateKeyBetween(lastPosition, null),
  };

  this.model.updateProperty(groupByPropId, {
    config: { options: [...existingOptions, newOption] },
  });

  this.view.appendColumn(boardEl, newOption);
  void this.sync.syncUpdateProperty({ propertyId: groupByPropId, changes: { config: { options: [...existingOptions, newOption] } } });
}
```

Similar updates for `handleColumnRename`, `handleColumnDelete`, `handleCardClick`, and all view management methods (`addView`, `duplicateView`, `deleteView`, `renameView`, `reorderView`).

For view management — since there's now a single model, `duplicateView` just duplicates the view config:
```typescript
duplicateView(viewId: string): void {
  const sourceView = this.model.getView(viewId);
  if (sourceView === undefined) return;

  const newView = this.model.addView(sourceView.name, sourceView.type, {
    groupBy: sourceView.groupBy,
    sorts: [...sourceView.sorts],
    filters: [...sourceView.filters],
    visibleProperties: [...sourceView.visibleProperties],
  });

  void this.sync.syncCreateView({ ...newView });
  this.switchView(newView.id);
}
```

`switchView` no longer swaps models — just changes `activeViewId` and re-renders:
```typescript
private switchView(viewId: string): void {
  if (viewId === this.activeViewId || this.boardContainer === null) return;

  const oldViewConfig = this.model.getView(this.activeViewId);
  const newViewConfig = this.model.getView(viewId);
  if (newViewConfig === undefined) return;

  // Destroy per-view subsystems
  this.cardDrag?.destroy();
  this.columnDrag?.destroy();
  this.columnControls?.destroy();
  this.keyboard?.destroy();
  this.sync.flushPendingUpdates();
  this.sync.destroy();

  // Slide direction
  const slideLeft = oldViewConfig !== undefined && newViewConfig.position > oldViewConfig.position;

  // ... rest of slide animation logic stays the same ...

  this.activateView(viewId);
  // ... build new board, attach listeners, init subsystems ...
  this.rebuildTabBar();
}
```

The `createTabBar` callback uses `model.getViews()`:
```typescript
private createTabBar(): DatabaseTabBar {
  return new DatabaseTabBar({
    views: this.model.getViews(),
    activeViewId: this.activeViewId,
    onTabClick: (viewId) => this.switchView(viewId),
    onAddView: (type) => this.addView(type),
    onRename: (viewId, name) => { this.model.updateView(viewId, { name }); void this.sync.syncUpdateView({ viewId, changes: { name } }); },
    onDuplicate: (viewId) => this.duplicateView(viewId),
    onDelete: (viewId) => this.deleteView(viewId),
    onReorder: (viewId, newPosition) => { this.model.updateView(viewId, { position: newPosition }); this.rebuildTabBar(); },
  });
}
```

- [ ] **Step 9: Update attachBoardListeners DOM attribute reads**

Change `data-column-id` reads to `data-option-id` and `data-card-id` to `data-row-id` in the event delegation.

- [ ] **Step 10: Update initSubsystems**

The card drawer is initialized with `titlePropertyId` and `descriptionPropertyId`:
```typescript
const titleProp = this.model.getSchema().find((p) => p.type === 'title');
const descProp = this.model.getSchema().find((p) => p.type === 'richText');

this.cardDrawer = new DatabaseCardDrawer({
  wrapper: this.element,
  readOnly: this.readOnly,
  toolsConfig: this.api.tools.getToolsConfig(),
  titlePropertyId: titleProp?.id ?? '',
  descriptionPropertyId: descProp?.id,
  onTitleChange: (rowId, title) => {
    if (titleProp !== undefined) {
      this.model.updateRow(rowId, { [titleProp.id]: title });
    }
    const currentBoard = this.boardContainer?.querySelector<HTMLElement>('[data-blok-database-board]');
    if (currentBoard !== null && currentBoard !== undefined) {
      this.view.updateCardTitle(currentBoard, rowId, title);
    }
    this.sync.syncUpdateRow({ rowId, properties: { [titleProp!.id]: title } });
  },
  onDescriptionChange: (rowId, description) => {
    if (descProp !== undefined) {
      this.model.updateRow(rowId, { [descProp.id]: description });
    }
    this.sync.syncUpdateRow({ rowId, properties: descProp !== undefined ? { [descProp.id]: description } : {} });
  },
  onClose: () => {},
});
```

- [ ] **Step 11: Remove createDefaultView helper**

No longer needed — the model creates defaults internally.

- [ ] **Step 12: Run tests**

Run: `yarn test test/unit/tools/database/database.test.ts`
Expected: All tests PASS

- [ ] **Step 13: Commit**

```bash
git add src/tools/database/index.ts test/unit/tools/database/database.test.ts
git commit -m "feat(database): update orchestrator to use single property-based model"
```

---

### Task 13: Update index.html playground fixture

**Files:**
- Modify: `index.html` (lines ~857-878)

- [ ] **Step 1: Replace the database block fixture**

Find the database block data in `index.html` and replace it with the new format:

```javascript
{
  id: 'database-board',
  type: 'database',
  data: {
    schema: [
      { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
      {
        id: 'prop-status', name: 'Status', type: 'select', position: 'a1',
        config: {
          options: [
            { id: 'opt-backlog', label: 'Backlog', color: 'gray', position: 'a0' },
            { id: 'opt-progress', label: 'In progress', color: 'blue', position: 'a1' },
            { id: 'opt-review', label: 'In review', color: 'purple', position: 'a2' },
            { id: 'opt-done', label: 'Done', color: 'green', position: 'a3' },
          ],
        },
      },
    ],
    rows: {
      'row-1': { id: 'row-1', position: 'a0', properties: { 'prop-title': 'Write documentation', 'prop-status': 'opt-backlog' } },
      'row-2': { id: 'row-2', position: 'a1', properties: { 'prop-title': 'Add dark mode support', 'prop-status': 'opt-backlog' } },
      'row-3': { id: 'row-3', position: 'a2', properties: { 'prop-title': 'Implement drag and drop', 'prop-status': 'opt-progress' } },
      'row-4': { id: 'row-4', position: 'a3', properties: { 'prop-title': 'Design card detail panel', 'prop-status': 'opt-progress' } },
      'row-5': { id: 'row-5', position: 'a4', properties: { 'prop-title': 'Set up CI pipeline', 'prop-status': 'opt-progress' } },
      'row-6': { id: 'row-6', position: 'a5', properties: { 'prop-title': 'Code review: auth module', 'prop-status': 'opt-review' } },
      'row-7': { id: 'row-7', position: 'a6', properties: { 'prop-title': 'Project scaffolding', 'prop-status': 'opt-done' } },
      'row-8': { id: 'row-8', position: 'a7', properties: { 'prop-title': 'Database schema design', 'prop-status': 'opt-done' } },
      'row-9': { id: 'row-9', position: 'a8', properties: { 'prop-title': 'User authentication', 'prop-status': 'opt-done' } },
    },
    views: [
      {
        id: 'view-1', name: 'Board', type: 'board', position: 'a0',
        groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: ['prop-title', 'prop-status'],
      },
    ],
    activeViewId: 'view-1',
  },
},
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "chore(database): update playground fixture to property-based format"
```

---

### Task 14: Final verification

- [ ] **Step 1: Run full test suite**

Run: `yarn test`
Expected: All tests PASS (no regressions)

- [ ] **Step 2: Run lint**

Run: `yarn lint`
Expected: No errors

- [ ] **Step 3: Run dev server and verify manually**

Run: `yarn serve`
Open the playground, verify the database board renders correctly with the new data format.

- [ ] **Step 4: Fix any issues found**

If lint or tests fail, fix the issues and re-run.

- [ ] **Step 5: Final commit if needed**

```bash
git add -A
git commit -m "fix(database): address lint and test issues from property model migration"
```
