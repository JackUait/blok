export type { BlockChildrenMountedPayload } from '../../../types/events/editor-events';

/**
 * Fired when a CONTAINER block's child holders have been mounted into its
 * child slot — the moment the child DOM has settled and a caret set into a
 * freshly inserted child sticks.
 *
 * Emitted by the React, Vue and Angular block adapters, whose portals commit a
 * frame AFTER core's `rendered()` hook; a vanilla container tool mounts its
 * children synchronously inside `rendered()`, so for those `block:rendered`
 * already means "settled". It fires on every reconciliation pass of the slot,
 * not only the first, so treat it as a settle signal rather than a change
 * signal.
 *
 * Public event name: `block:childrenMounted`.
 */
export const BlockChildrenMounted = 'block:childrenMounted';
