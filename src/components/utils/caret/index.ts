/**
 * Caret utilities - Public API re-exports.
 *
 * This module re-exports all public caret utility functions for backward compatibility.
 * The caret utilities have been split into focused modules for better maintainability.
 *
 * Module structure:
 * - selection.ts: Reading selection/caret state
 * - focus.ts: Setting focus and caret position
 * - boundaries.ts: Detecting if caret is at start/end of input
 * - lines.ts: Detecting if caret is on first/last line
 * - navigation.ts: X-position navigation (Notion-style)
 * - inline-removal.ts: Tracking empty inline element removal
 */

// Reading selection state
export { getCaretNodeAndOffset, getCaretOffset } from './selection';

// Focus operations
export { focus, setSelectionToElement } from './focus';

// Boundary detection
export { isCaretAtStartOfInput, isCaretAtEndOfInput, checkContenteditableSliceForEmptiness } from './boundaries';

// Line detection
export { isCaretAtFirstLine, isCaretAtLastLine, getValidCaretRect } from './lines';

// X-position navigation
export {
  getCaretXPosition,
  setCaretAtXPosition,
  getTargetYPosition,
  getCaretPositionFromPoint,
  findBestPositionInRange,
  setCaretAtXPositionInNativeInput,
  setCaretAtXPositionInContentEditable
} from './navigation';

// Inline removal detection
export { findNbspAfterEmptyInline, ensureInlineRemovalObserver, isElementVisuallyEmpty } from './inline-removal';

// Export the WeakSet for testing purposes
export { whitespaceFollowingRemovedEmptyInline } from './inline-removal';
