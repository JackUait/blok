import type { BlockToolData } from '../../../types';

/**
 * Data format for the Table tool.
 * In legacy mode, this is the single-block data.
 * In hierarchical mode, this is the parent block data
 * (child row blocks use the same type with cells populated).
 */
export interface TableData extends BlockToolData {
  /** Whether the first row is a heading row */
  withHeadings: boolean;
  /** Whether the table is full-width */
  stretched?: boolean;
  /** 2D array of cell HTML content (legacy format) */
  content: string[][];
  /** Column widths in pixels (e.g., [200, 300, 250]). Omit for equal widths. */
  colWidths?: number[];
}

/**
 * Table tool configuration
 */
export interface TableConfig {
  /** Initial number of rows (default: 2) */
  rows?: number;
  /** Initial number of columns (default: 2) */
  cols?: number;
  /** Whether to start with heading row enabled */
  withHeadings?: boolean;
  /** Whether to start stretched */
  stretched?: boolean;
}
