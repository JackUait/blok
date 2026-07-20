/**
 * DragA11y - Handles accessibility announcements for drag operations
 */

import type { Block } from '../../../block';
import { DRAG_CONFIG } from '../utils/drag.constants';
import { resolveMoveDestination } from '../utils/moveDestination';

export interface AnnouncerAdapter {
  announce(message: string, options?: { politeness: 'polite' | 'assertive' }): void;
}

export interface BlockManagerAdapter {
  getBlockIndex(block: Block): number;
  blocks: Block[];
}

export interface I18nAdapter {
  t(key: string, params?: Record<string, number | string>): string;
}

export class DragA11y {
  private blockManager: BlockManagerAdapter;
  private i18n: I18nAdapter;
  private announcer: AnnouncerAdapter;
  private lastAnnouncedDropIndex: number | null = null;
  private lastAnnouncedKey: string | null = null;
  private pendingKey: string | null = null;
  private pendingMessage: (() => string) | null = null;
  private announcementTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(
    blockManager: BlockManagerAdapter,
    i18n: I18nAdapter,
    announcer: AnnouncerAdapter
  ) {
    this.blockManager = blockManager;
    this.i18n = i18n;
    this.announcer = announcer;
  }

  /**
   * Announces the current drop position to screen readers
   * Throttled to avoid overwhelming screen readers with rapid announcements
   * Only announces if the position has changed since the last announcement
   * @param targetBlock - Current drop target block
   * @param targetEdge - Edge of target ('top', 'bottom', 'left', or 'right')
   * @param sourceBlocks - Blocks participating in the drag
   * @param isDuplicate - Whether the preview represents Alt/Option duplication
   */
  announceDropPosition(
    targetBlock: Block,
    targetEdge: 'top' | 'bottom' | 'left' | 'right',
    sourceBlocks: Block[] = [],
    isDuplicate = false
  ): void {
    if (isDuplicate && sourceBlocks.length === 0) {
      return;
    }

    const targetIndex = this.blockManager.getBlockIndex(targetBlock);
    const hasStaleSource = sourceBlocks.some(
      block => !this.blockManager.blocks.includes(block)
    );

    if (targetIndex === -1 || hasStaleSource) {
      return;
    }

    // Horizontal drops create a column left/right of the target rather than
    // reordering by index, so they get a dedicated phrasing.
    if (targetEdge === 'left' || targetEdge === 'right') {
      const i18nKey = targetEdge === 'left' ? 'a11y.dropCreateColumnLeft' : 'a11y.dropCreateColumnRight';

      this.scheduleAnnouncement(`column-${targetEdge}`, () => this.i18n.t(i18nKey));

      return;
    }

    const rawDropIndex = targetEdge === 'top' ? targetIndex : targetIndex + 1;
    const moveDestination = sourceBlocks.length === 0 || isDuplicate
      ? null
      : resolveMoveDestination(
        this.blockManager.blocks,
        sourceBlocks,
        targetBlock,
        targetEdge
      );

    if (!isDuplicate && sourceBlocks.length > 0 && moveDestination === null) {
      return;
    }

    const dropIndex = moveDestination?.finalFirstIndex ?? rawDropIndex;
    const total = this.blockManager.blocks.length + (isDuplicate ? sourceBlocks.length : 0);
    const operation = isDuplicate ? 'duplicate' : 'move';

    this.scheduleAnnouncement(`${operation}-index-${dropIndex}-total-${total}`, () => {
      this.lastAnnouncedDropIndex = dropIndex;

      return this.i18n.t('a11y.dropPosition', {
        position: dropIndex + 1,
        total,
      });
    });
  }

  /**
   * Throttles and de-duplicates a polite drop announcement.
   * Only the most recent pending announcement fires once the throttle elapses,
   * and an identical consecutive announcement (same dedupe key) is suppressed.
   * @param dedupeKey - Stable identity of the announcement to suppress repeats
   * @param buildMessage - Lazily builds the message when the throttle fires
   */
  private scheduleAnnouncement(dedupeKey: string, buildMessage: () => string): void {
    // Always record the CURRENT position first (last one wins): an
    // already-scheduled timeout reads this at fire time, so returning to the
    // last-announced position within the throttle window overwrites a stale
    // pending position instead of letting it fire.
    this.pendingKey = dedupeKey;
    this.pendingMessage = buildMessage;

    // If there's already a pending timeout, let it handle the announcement
    if (this.announcementTimeoutId !== null) {
      return;
    }

    // Nothing new to announce and no timeout in flight — don't schedule one
    if (this.lastAnnouncedKey === dedupeKey) {
      this.pendingKey = null;
      this.pendingMessage = null;

      return;
    }

    this.announcementTimeoutId = setTimeout(() => {
      const pendingKey = this.pendingKey;
      const pendingMessage = this.pendingMessage;

      // Clear the timeout state
      this.announcementTimeoutId = null;
      this.pendingKey = null;
      this.pendingMessage = null;

      if (pendingKey === null || pendingMessage === null) {
        return;
      }

      // Don't announce if it's the same as what we already announced
      if (this.lastAnnouncedKey === pendingKey) {
        return;
      }

      this.lastAnnouncedKey = pendingKey;

      this.announcer.announce(pendingMessage(), { politeness: 'polite' });
    }, DRAG_CONFIG.announcementThrottleMs);
  }

  /**
   * Announces that a drop operation has completed
   * @param sourceBlock - The primary block that was dropped
   * @param sourceBlocks - All blocks that were dropped
   * @param isMultiBlockDrag - Whether this was a multi-block drag
   */
  announceDropComplete(sourceBlock: Block, sourceBlocks: Block[], isMultiBlockDrag: boolean): void {
    const newIndex = this.blockManager.getBlockIndex(sourceBlock);
    const total = this.blockManager.blocks.length;

    if (isMultiBlockDrag) {
      const message = this.i18n.t('a11y.blocksMoved', {
        count: sourceBlocks.length,
        position: newIndex + 1,
      });

      this.announcer.announce(message, { politeness: 'assertive' });
    } else {
      const message = this.i18n.t('a11y.blockMoved', {
        position: newIndex + 1,
        total,
      });

      this.announcer.announce(message, { politeness: 'assertive' });
    }
  }

  /**
   * Announces that a duplication operation has completed
   * @param duplicatedBlocks - The blocks that were duplicated
   */
  announceDuplicateComplete(duplicatedBlocks: Block[]): void {
    const firstBlock = duplicatedBlocks[0];

    if (!firstBlock) {
      return;
    }

    const newIndex = this.blockManager.getBlockIndex(firstBlock);
    const count = duplicatedBlocks.length;

    if (count > 1) {
      const message = this.i18n.t('a11y.blocksDuplicated', {
        count,
        position: newIndex + 1,
      });

      this.announcer.announce(message, { politeness: 'assertive' });
    } else {
      const message = this.i18n.t('a11y.blockDuplicated', {
        position: newIndex + 1,
        total: this.blockManager.blocks.length,
      });

      this.announcer.announce(message, { politeness: 'assertive' });
    }
  }

  /**
   * Resets the announcement state
   * Call this when starting a new drag operation
   */
  reset(): void {
    if (this.announcementTimeoutId !== null) {
      clearTimeout(this.announcementTimeoutId);
      this.announcementTimeoutId = null;
    }

    this.lastAnnouncedDropIndex = null;
    this.lastAnnouncedKey = null;
    this.pendingKey = null;
    this.pendingMessage = null;
  }

  /**
   * Gets the last announced drop index
   */
  getLastAnnouncedIndex(): number | null {
    return this.lastAnnouncedDropIndex;
  }
}
