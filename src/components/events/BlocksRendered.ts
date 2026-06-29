export type { BlocksRenderedPayload } from '../../../types/events/editor-events';

/**
 * Fired when a batch of blocks has finished rendering into the DOM,
 * e.g. on editor initialization or after `blok.blocks.render()`.
 *
 * Emitted once the browser has painted the inserted blocks, so subscribers
 * can safely read the rendered DOM (build a table of contents, mark blocks,
 * etc.) instead of polling.
 *
 * Public event name: `blocks:rendered`.
 */
export const BlocksRendered = 'blocks:rendered';
