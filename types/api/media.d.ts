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
   * Ask before an in-app navigation. Call it from your router's leave guard.
   *
   * - While the row-page layout builder has unsaved edits, it asks
   *   "Discard all layout changes?". Discard drops the draft; Cancel stays.
   * - Then, while images are failed, it shows a banner.
   *
   * Resolves `true` at once when there is nothing to ask.
   * Blok itself only holds a same-document browser Back (Navigation API,
   * where the browser lets it be canceled) and full page loads (`beforeunload`).
   * @returns true to leave, false to stay
   */
  confirmLeave(): Promise<boolean>;
}
