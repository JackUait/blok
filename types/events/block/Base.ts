import type { BlockAPI } from '../../api';

/**
 * Who made a block change: this tab, another tab of this browser on the same
 * document, or a collaboration peer. This tab's own undo/redo is 'local'.
 */
export type BlockMutationOrigin = 'local' | 'tab' | 'remote';

/**
 * Details of CustomEvent fired on block mutation
 */
export interface BlockMutationEventDetail {
  /**
   * Affected block
   */
  target: BlockAPI;

  /**
   * Who made the change
   */
  origin?: BlockMutationOrigin;
}
