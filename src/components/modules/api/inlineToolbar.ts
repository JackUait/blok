import type { InlineToolbar } from '../../../../types/api/inline-toolbar';
import { Module } from '../../__module';

/**
 * @class InlineToolbarAPI
 * Provides methods for working with the Inline Toolbar
 */
export class InlineToolbarAPI extends Module {
  /**
   * Available methods
   * @returns {InlineToolbar}
   */
  public get methods(): InlineToolbar {
    return {
      close: (): void => this.close(),
      open: (): void => this.open(),
    };
  }

  /**
   * Open Inline Toolbar
   */
  public open(): void {
    // A host's open() overrides an earlier close() of the same selection.
    this.Blok.InlineToolbar.clearDismissal();
    void this.Blok.InlineToolbar.tryToShow();
  }

  /**
   * Close Inline Toolbar
   */
  public close(): void {
    // Not a plain close(): a selectionchange still queued (180ms debounce) would reopen it.
    this.Blok.InlineToolbar.dismiss();
  }
}
