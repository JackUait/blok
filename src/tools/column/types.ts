import type { BlockToolData } from '../../../types';

export interface ColumnData extends BlockToolData {
  /**
   * Width of this column relative to its siblings, applied as flex-grow.
   * Omitted means equal width (flex-grow: 1). Set by the resize sub-project.
   */
  widthRatio?: number;

  /**
   * Transient flag set when a column is created programmatically (e.g. by a
   * drag-beside drop) and will be populated by reparenting existing blocks.
   * Suppresses the empty-paragraph seed in rendered(). Never persisted — not
   * returned from save().
   */
  noSeed?: boolean;

  /**
   * Transient flag: seed the empty paragraph but do NOT move the caret into it.
   * Columns render asynchronously, so when a column_list seeds several columns
   * the LAST one's self-focus would otherwise win the race. Setting this on
   * every column except the first lets only the first column claim the caret.
   * Never persisted — not returned from save().
   */
  noFocus?: boolean;
}
