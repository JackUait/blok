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

  /** Captured replay participation; history wins. Not field ownership. */
  replaySource?: 'history' | 'remote';

  /**
   * Local agents keep origin 'local'. `movingTo` is set when a later edit of
   * the same agent batch moves the block to that parent (null: top level).
   */
  agent?: { id: string; name: string; turnId: string; movingTo?: string | null };
}
