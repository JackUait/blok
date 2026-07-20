import { PasteConfig, SanitizerConfig } from '../configs';
import { BlockTool, BlockToolConstructable, BlockToolConstructorOptions } from './block-tool';
import { BlockToolData } from './block-tool-data';
import { ToolboxConfig } from './tool-settings';

/**
 * Cell content always contains block IDs.
 * Every cell in the table is represented as an array of block references.
 */
export interface CellContent {
  blocks: string[];
}

/**
 * Table Tool's input and output data format
 */
export interface TableData extends BlockToolData {
  /** Whether the first row is a heading row */
  withHeadings: boolean;
  /** Whether the first column is a heading column */
  withHeadingColumn: boolean;
  /** Whether the table is full-width */
  stretched?: boolean;
  /** 2D array of cell content */
  content: CellContent[][];
  /** Column widths in pixels (e.g., [200, 300, 250]). Omit for equal widths. */
  colWidths?: number[];
}

/**
 * Table Tool's configuration
 */
export interface TableConfig {
  /** Initial number of rows (default: 3) */
  rows?: number;
  /** Initial number of columns (default: 3) */
  cols?: number;
  /** Whether to start with heading row enabled */
  withHeadings?: boolean;
  /** Whether to start stretched */
  stretched?: boolean;
  /** Additional tool names to restrict from being inserted into table cells */
  restrictedTools?: string[];
}

/**
 * Table Tool constructor options
 */
export type TableConstructorOptions = BlockToolConstructorOptions<TableData, TableConfig>;

/**
 * Table Tool for the Blok Editor
 * Renders a 2D grid of block-based cells
 */
export declare class Table implements BlockTool {
  /**
   * Tool's Toolbox settings
   */
  static toolbox?: ToolboxConfig;

  /**
   * Sanitizer rules description
   */
  static sanitize?: SanitizerConfig;

  /**
   * Paste substitutions configuration
   */
  static pasteConfig?: PasteConfig | false;

  /**
   * Is Tool supports read-only mode
   */
  static isReadOnlySupported?: boolean;

  /**
   * The table exclusively manages its own child (cell) blocks
   */
  static ownsChildren?: boolean;

  constructor(options: TableConstructorOptions);

  /**
   * Return Tool's view
   */
  render(): HTMLElement;

  /**
   * Validate Table block data
   */
  validate(blockData: TableData): boolean;

  /**
   * Extract Tool's data from the view
   */
  save(): TableData;
}

/**
 * Table Tool constructor
 * @deprecated Use `typeof Table` and {@link TableConstructorOptions} instead
 */
export interface TableConstructable extends BlockToolConstructable {
  new(config: TableConstructorOptions): Table;
}
