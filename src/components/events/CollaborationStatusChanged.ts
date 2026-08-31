export type { CollaborationStatusChangedPayload } from '../../../types/events/editor-events';

/**
 * Fired when the collaboration session's connection state or peer set changes.
 *
 * This is the surface a host uses to render a sync pill and a presence stack:
 * subscribe via `blok.events.on('collaboration:status', ...)`. The collaboration
 * module emits it; single-player editors never do.
 *
 * Public event name: `collaboration:status`.
 */
export const CollaborationStatusChanged = 'collaboration:status';
