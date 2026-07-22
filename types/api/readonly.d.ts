/**
 * ReadOnly API
 */
/**
 * Options for {@link ReadOnly.set}
 */
export interface ReadOnlySetOptions {
  /**
   * When true, all editor controls are hidden while read-only is active:
   * the hover toolbar (settings toggler), the block settings popover and the
   * inline toolbar. Writes the object form of `config.readOnly` so the live
   * state reflects the change.
   */
  hideControls?: boolean;
}

export interface ReadOnly {
  /**
   * Set read-only mode to the specified boolean state
   *
   * @param {Boolean} state - read-only state to set
   * @param options - optional read-only mode options (e.g. `hideControls`)
   * @returns {Promise<boolean>} the new read-only state
   */
  set: (state: boolean, options?: ReadOnlySetOptions) => Promise<boolean>;

  /**
   * Toggle read-only state (deprecated - use set() instead)
   * Without parameter, toggles current state. With parameter, sets to specified state.
   *
   * @param {Boolean|undefined} state - optional state to set (if omitted, toggles)
   * @returns {Promise<boolean>} current value
   * @deprecated Use `set()` method for clearer intent
   */
  toggle: (state?: boolean) => Promise<boolean>;

  /**
   * Contains current read-only state
   */
  isEnabled: boolean;

  /**
   * Observability constant: true means `readOnly.set()` toggles the mode
   * in place — preserving block instances, caret, undo history and scroll —
   * instead of recreating the editor. Consumers can assert on it before
   * relying on in-place toggle semantics.
   */
  readonly togglesInPlace: true;
}
