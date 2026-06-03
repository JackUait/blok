import type { BlockToolData } from '../../../types';

export interface ColumnListData extends BlockToolData {
  /**
   * Transient seed hint: how many columns to create on first render.
   * Set only by toolbox presets; never persisted. The real structure
   * lives in the block's contentIds (the column children).
   */
  columnCount?: number;
}
