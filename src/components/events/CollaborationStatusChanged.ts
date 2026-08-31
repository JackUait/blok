export type { CollaborationStatusChangedPayload, CollaborationTerminalReason } from '../../../types/events/editor-events';

/**
 * Fired when the collaboration session's connection state or peer set changes.
 *
 * This is the surface a host uses to render a sync pill and a presence stack:
 * subscribe via `blok.events.on('collaboration:status', ...)`. The collaboration
 * module emits it; single-player editors never do.
 *
 * The payload separates a session that is RETRYING (`offline`, with `retryInMs`)
 * from one that has stopped for good (`error`, with the reason). Folding the two
 * together would tell a host that edits are pending on a session that will never
 * send them.
 *
 * Public event name: `collaboration:status`.
 */
export const CollaborationStatusChanged = 'collaboration:status';
