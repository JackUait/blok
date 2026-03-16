/**
 * Theme mode set by the user.
 */
export type ThemeMode = 'dark' | 'light' | 'auto';

/**
 * Resolved theme after evaluating OS preference (for 'auto' mode).
 */
export type ResolvedTheme = 'dark' | 'light';

/**
 * Describes the theme API.
 */
export interface Theme {
  /**
   * Returns the current theme mode.
   */
  get(): ThemeMode;

  /**
   * Sets the theme mode.
   */
  set(mode: ThemeMode): void;

  /**
   * Returns the resolved theme ('dark' or 'light'), evaluating OS preference if mode is 'auto'.
   */
  getResolved(): ResolvedTheme;
}
