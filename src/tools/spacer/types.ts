import type { BlockToolData } from '../../../types';

/**
 * Spacer block data — a single vertical gap height in pixels.
 */
export interface SpacerData extends BlockToolData {
  /**
   * Gap height in pixels. Clamped to [8, 600]; defaults to 24.
   */
  height?: number;
}
