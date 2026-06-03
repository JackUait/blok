import type { BlockToolData } from '../../../types';

export interface ColumnData extends BlockToolData {
  /**
   * Width of this column relative to its siblings, applied as flex-grow.
   * Omitted means equal width (flex-grow: 1). Set by the resize sub-project.
   */
  widthRatio?: number;
}
