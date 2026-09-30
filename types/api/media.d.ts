/**
 * How an image failed: `upload` is lost on save, `load` is saved but will not display.
 */
export type MediaFailureKind = 'upload' | 'load';

/**
 * A failure a tool reports to the editor.
 */
export interface MediaFailureInput {
  /** Id of the block that failed. */
  blockId: string;

  /** Tool name, e.g. `'image'`. */
  tool: string;

  kind: MediaFailureKind;

  /** The source that failed, if any. */
  url?: string;

  /** Tries the failed source again. */
  retry(): void;

  /** A `blob:` or `data:image/` URL of what the user picked, shown in the notice. */
  preview?: string;
}

/**
 * Media API: lets tools report failed media, and hosts ask before leaving.
 */
export interface Media {
  /**
   * Record a failure. Replaces an earlier one for the same block.
   */
  reportFailure(failure: MediaFailureInput): void;

  /**
   * Drop the failure recorded for a block, if any.
   * Pass `recovered: true` when the media now works, so the notice can say so.
   */
  clearFailure(blockId: string, options?: { recovered?: boolean }): void;

  /**
   * Ask before an in-app navigation. Shows a banner while images are failed.
   * @returns true to leave, false to stay
   */
  confirmLeave(): Promise<boolean>;
}
