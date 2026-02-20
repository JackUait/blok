import type { BlockToolData } from '../../../types';

/**
 * Cell content always contains block IDs.
 * Every cell in the table is represented as an array of block references.
 */
export type CellContent = { blocks: string[] };

/**
 * Legacy cell content type for migration from string-based cells.
 * Used when loading saved data that may contain plain text strings.
 */
export type LegacyCellContent = string | CellContent;

/**
 * Type guard to check if legacy cell content has been migrated to blocks format.
 * Used during data loading to identify cells that need migration.
 */
export const isCellWithBlocks = (cell: LegacyCellContent): cell is CellContent => {
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
  /** Whether the first column is a heading column */
  withHeadingColumn: boolean;
  /** Whether the table is full-width */
  stretched?: boolean;
  /** 2D array of cell content (may contain legacy string format when loading saved data) */
  content: LegacyCellContent[][];
  /** Column widths in pixels (e.g., [200, 300, 250]). Omit for equal widths. */
  colWidths?: number[];
  /** Original per-column width in pixels, set once at creation. New columns = initialColWidth / 2. */
  initialColWidth?: number;
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
  /** Additional tool names to restrict from being inserted into table cells */
  restrictedTools?: string[];
}

/**
 * Block data within a clipboard cell (no IDs — those are assigned on paste).
 */
export interface ClipboardBlockData {
  tool: string;
  data: Record<string, unknown>;
  tunes?: Record<string, unknown>;
}

/**
 * Clipboard payload for copied table cells.
 * Stored as JSON in a data attribute on the HTML table element.
 */
export interface TableCellsClipboard {
  rows: number;
  cols: number;
  cells: Array<Array<{ blocks: ClipboardBlockData[] }>>;
}
