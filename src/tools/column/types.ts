import type { BlockToolData } from '../../../types';

export interface ColumnData extends BlockToolData {
  /**
   * Width of this column relative to its siblings, 0–1.
   * Omitted means equal width (flex-grow: 1). Set by the resize sub-project.
   */
  widthRatio?: number;
}
