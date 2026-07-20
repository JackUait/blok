import { BlockTool, BlockToolConstructorOptions } from './block-tool';
import { BlockToolData } from './block-tool-data';
import { OutputData } from '../data-formats/output-data';
import { ToolboxConfig } from './tool-settings';

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

export interface DatabaseRowData extends BlockToolData {
  properties: Record<string, PropertyValue>;
  position: string;
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

/**
 * Data saved by the database block.
 * Schema and views only — rows are child blocks (database-row type).
 */
export interface DatabaseData extends BlockToolData {
  schema: PropertyDefinition[];
  views: DatabaseViewConfig[];
  activeViewId: string;
}

// ─── Adapter ───

export interface DatabaseAdapter {
  loadDatabase(): Promise<{
    schema: PropertyDefinition[];
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

/**
 * Database Tool constructor options
 */
export type DatabaseConstructorOptions = BlockToolConstructorOptions<DatabaseData, DatabaseConfig>;

/**
 * Database Tool for the Blok Editor
 * Notion-style database block: schema + views stored in its data, rows as
 * child `database-row` blocks.
 */
export declare class Database implements BlockTool {
  /**
   * Tool's Toolbox settings
   */
  static toolbox?: ToolboxConfig;

  /**
   * Is Tool supports read-only mode
   */
  static isReadOnlySupported?: boolean;

  constructor(options: DatabaseConstructorOptions);

  /**
   * Return Tool's view
   */
  render(): HTMLDivElement;

  /**
   * Called after the block is added to the page
   */
  rendered(): void;

  /**
   * Extract Tool's data from the view
   */
  save(blockContent: HTMLElement): DatabaseData;

  /**
   * Validate Database block data
   */
  validate(savedData: DatabaseData): boolean;

  /**
   * Clean up subscriptions and view renderers
   */
  destroy(): void;

  /**
   * Toggle read-only mode
   */
  setReadOnly(state: boolean): void;

  /**
   * Add a new view of the given type
   */
  addView(type: ViewType): void;

  /**
   * Rename a view
   */
  renameView(viewId: string, name: string): void;

  /**
   * Duplicate a view
   */
  duplicateView(viewId: string): void;

  /**
   * Delete a view
   */
  deleteView(viewId: string): void;

  /**
   * Move a view to a new position
   */
  reorderView(viewId: string, newPosition: string): void;
}
