/**
 * DragA11y - Handles accessibility announcements for drag operations
 */

import type { Block } from '../../../block';
import { DRAG_CONFIG } from '../utils/drag.constants';

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
  private pendingAnnouncementIndex: number | null = null;
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
   * @param targetEdge - Edge of target ('top' or 'bottom')
   */
  announceDropPosition(targetBlock: Block, targetEdge: 'top' | 'bottom'): void {
    const targetIndex = this.blockManager.getBlockIndex(targetBlock);
    const dropIndex = targetEdge === 'top' ? targetIndex : targetIndex + 1;

    // Don't announce if position hasn't changed
    if (this.lastAnnouncedDropIndex === dropIndex) {
      return;
    }

    // Store the pending announcement
    this.pendingAnnouncementIndex = dropIndex;

    // If there's already a pending timeout, let it handle the announcement
    if (this.announcementTimeoutId !== null) {
      return;
    }

    // Schedule the announcement with throttling
    this.announcementTimeoutId = setTimeout(() => {
      if (this.pendingAnnouncementIndex === null) {
        return;
      }

      const pendingIndex = this.pendingAnnouncementIndex;

      // Clear the timeout state
      this.announcementTimeoutId = null;
      this.pendingAnnouncementIndex = null;

      // Don't announce if it's the same as what we already announced
      if (this.lastAnnouncedDropIndex === pendingIndex) {
        return;
      }

      this.lastAnnouncedDropIndex = pendingIndex;

      const total = this.blockManager.blocks.length;
      const message = this.i18n.t('a11y.dropPosition', {
        position: pendingIndex + 1,
        total,
      });

      this.announcer.announce(message, { politeness: 'polite' });
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
    this.pendingAnnouncementIndex = null;
  }

  /**
   * Gets the last announced drop index
   */
  getLastAnnouncedIndex(): number | null {
    return this.lastAnnouncedDropIndex;
  }
}
