/**
 * Editor content width mode.
 *
 * - `'narrow'` — content is constrained to the default `--max-width-content` (the default).
 * - `'full'`   — content max-width constraint is removed so it fills its container.
 */
export type EditorWidth = 'full' | 'narrow';

/**
 * Describes Blok's width API for controlling the editor content width mode.
 */
export interface Width {
  /**
   * Returns the current editor content width mode.
   *
   * @returns {EditorWidth} the active mode (defaults to `'narrow'`)
   */
  get(): EditorWidth;

  /**
   * Sets the editor content width mode.
   *
   * @param {EditorWidth} value - the mode to apply
   */
  set(value: EditorWidth): void;

  /**
   * Toggles the editor content width mode between `'narrow'` and `'full'`.
   */
  toggle(): void;
}
