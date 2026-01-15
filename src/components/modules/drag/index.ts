/**
 * Drag module exports
 *
 * This module provides the decoupled drag and drop functionality for Blok.
 * The main entry point is DragController which is exported as DragManager for backward compatibility.
 */

// Main orchestrator (exported as DragManager for backward compatibility)
export { DragController } from './DragController';

// State management
export * from './state';

// Preview system
export * from './preview';

// Target detection
export * from './target';

// Operations
export * from './operations';

// Accessibility
export * from './a11y';

// Utilities
export { AutoScroll } from './utils/AutoScroll';
export { ListItemDepth } from './utils/ListItemDepth';
export { ListItemDescendants } from './utils/ListItemDescendants';
export { findScrollableAncestor } from './utils/findScrollableAncestor';
export { DRAG_CONFIG, PREVIEW_STYLES, hasPassedThreshold } from './utils/drag.constants';
