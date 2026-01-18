/**
 * UI Controllers Module
 *
 * This module exports the refactored UI class and its controllers/handlers.
 * The UI class is now a thin orchestrator that delegates to specialized controllers.
 *
 * @module uiControllers
 */

// Re-export controllers for external use if needed
export { KeyboardController } from './controllers/keyboard';
export { SelectionController } from './controllers/selection';
export { BlockHoverController } from './controllers/blockHover';

// Re-export handlers for external use if needed
export {
  createDocumentClickedHandler,
  analyzeClickContext,
  type ClickHandlerDependencies,
} from './handlers/click';

export {
  createRedactorTouchHandler,
  getClickedNode,
  type RedactorTouchHandlerDependencies,
} from './handlers/touch';

// Re-export constants
export { HOVER_ZONE_SIZE, KEYS_REQUIRING_CARET_CAPTURE } from './constants';
