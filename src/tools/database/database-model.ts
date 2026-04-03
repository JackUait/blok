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
    const lastPosition = this.schema.length > 0 ? this.schema[this.schema.length - 1].position : null;
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
    if (prop === undefined) return;
    if (changes.name !== undefined) prop.name = changes.name;
    if (changes.config !== undefined) prop.config = changes.config;
  }

  deleteProperty(propertyId: string): void {
    this.schema = this.schema.filter((p) => p.id !== propertyId);
    for (const row of Object.values(this.rows)) {
      const { [propertyId]: _, ...rest } = row.properties;
      row.properties = rest;
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
    const lastPosition = orderedRows.length > 0 ? orderedRows[orderedRows.length - 1].position : null;
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
    if (row === undefined) return;
    Object.assign(row.properties, properties);
  }

  moveRow(rowId: string, position: string): void {
    const row = this.rows[rowId];
    if (row === undefined) return;
    row.position = position;
  }

  deleteRow(rowId: string): void {
    const { [rowId]: _, ...rest } = this.rows;
    this.rows = rest;
  }

  // ─── View-oriented queries ───

  getRowsGroupedBy(propertyId: string): Map<string, DatabaseRow[]> {
    const groups = new Map<string, DatabaseRow[]>();
    const ordered = this.getOrderedRows();
    for (const row of ordered) {
      const rawValue = row.properties[propertyId];
      const key = this.toGroupKey(rawValue);
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
    if (prop === undefined || (prop.type !== 'select' && prop.type !== 'multiSelect')) return [];
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
    if (view === undefined) return;
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

  private toGroupKey(value: PropertyValue | undefined): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'boolean' || typeof value === 'number') return String(value);
    return '';
  }

  static positionBetween(after: string | null, before: string | null): string {
    return generateKeyBetween(after, before);
  }

  private static createDefaultSchema(): PropertyDefinition[] {
    return [
      { id: nanoid(), name: 'Title', type: 'title', position: 'a0' },
      {
        id: nanoid(), name: 'Status', type: 'select', position: 'a1',
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
      id: nanoid(), name: 'Board', type: 'board', position: 'a0',
      groupBy: groupByPropertyId, sorts: [], filters: [], visibleProperties: [],
    };
  }
}
