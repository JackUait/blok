/**
 * Describes the editor-level width mode API
 */
export interface Width {
  /**
   * Returns the current width mode
   */
  get(): 'narrow' | 'full';

  /**
   * Sets the width mode
   */
  set(mode: 'narrow' | 'full'): void;

  /**
   * Toggles between 'narrow' and 'full'
   */
  toggle(): void;
}
