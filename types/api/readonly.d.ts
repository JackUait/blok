/**
 * ReadOnly API
 */
export interface ReadOnly {
  /**
   * Set read-only mode to the specified boolean state
   *
   * @param {Boolean} state - read-only state to set
   * @returns {Promise<boolean>} the new read-only state
   */
  set: (state: boolean) => Promise<boolean>;

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
}
