import type { BlockToolData } from '../../../types';

export interface ColumnListData extends BlockToolData {
  /**
   * Transient seed hint: how many columns to create on first render.
   * Set only by toolbox presets; never persisted. The real structure
   * lives in the block's contentIds (the column children).
   */
  columnCount?: number;

  /**
   * Transient flag: suppress the default column auto-seed on first render.
   * Set by drag-beside (which inserts the column_list and then fills it with
   * explicit columns); never persisted.
   */
  noSeed?: boolean;
}
