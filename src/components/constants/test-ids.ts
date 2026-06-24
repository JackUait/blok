/**
 * Stable, documented test-id values used with the `data-blok-testid`
 * attribute ({@link DATA_ATTR.testid}).
 *
 * Exported as `Blok.TEST_ID` so consumers (and their test suites) can target
 * editor chrome without reverse-engineering internal selectors. These values
 * are part of the public contract — query them as
 * `[${DATA_ATTR.testid}="${TEST_ID.plusButton}"]`.
 */
export const TEST_ID = {
  /** The "+" (add block) toolbar button. */
  plusButton: 'plus-button',
  /** The block settings / drag handle toggler (☰). */
  settingsToggler: 'settings-toggler',
  /** A single block's wrapper element. */
  blockWrapper: 'block-wrapper',
} as const;
