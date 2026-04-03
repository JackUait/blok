import { BlockToolData } from './block-tool';
import { OutputData } from '../data-formats/output-data';

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
    rows: Record<string, DatabaseRow>;
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
