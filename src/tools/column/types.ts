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
}
