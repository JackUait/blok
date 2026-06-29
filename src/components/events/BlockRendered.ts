export type { BlockRenderedPayload } from '../../../types/events/editor-events';

/**
 * Fired when a single block has been rendered into the DOM
 * (its `rendered()` lifecycle hook has been invoked).
 *
 * Public event name: `block:rendered`.
 */
export const BlockRendered = 'block:rendered';
