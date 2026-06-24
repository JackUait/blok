/**
 * Describes Blok's placeholder API for controlling the editor-level placeholder
 * (the hint shown on the empty default block) at runtime.
 */
export interface Placeholder {
  /**
   * Returns the current editor placeholder.
   * @returns the placeholder text, or `false` when disabled.
   */
  get(): string | false;

  /**
   * Sets the editor placeholder. Updates existing blocks in place and applies to
   * blocks created afterward. Pass `false` to clear it.
   * @param value - new placeholder text, or false to disable it
   */
  set(value: string | false): void;
}
