import type { BlockToolData } from '../../../types';

/**
 * Cell content can be either:
 * - A string (plain text/HTML, backwards compatible)
 * - An object with block IDs (for nested blocks like lists)
 */
export type CellContent = string | { blocks: string[] };

/**
 * Type guard to check if cell content contains blocks
 */
export const isCellWithBlocks = (cell: CellContent): cell is { blocks: string[] } => {
  return typeof cell === 'object' && cell !== null && 'blocks' in cell;
};

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
  /** 2D array of cell content (string or block references) */
  content: CellContent[][];
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
