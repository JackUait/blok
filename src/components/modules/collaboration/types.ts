/**
 * Identity of a persisted working set, mirrored from the server's
 * CollabWorkingSetTag. Format names the CRDT schema the update frames were
 * produced against (1 = client schema v2), epoch counts resets, and lineage
 * (32 lower-hex chars) is compared by equality: a different lineage means
 * "drop what you cached, this is not your history".
 */
export interface WorkingSetTag {
  format: number;
  epoch: number;
  lineage: string;
}

/**
 * One y-protocols message as carried by one WebSocket frame — the frames this
 * codec can put on the wire and hand back to the provider.
 *
 * - `syncStep1` carries a state vector; `syncStep2`/`update` carry a yjs update.
 * - `awareness` bytes are relayed verbatim; this codec never parses their interior.
 * - `permissionDenied` is the only auth sub-message.
 * - `control` is the Blok-only working-set announcement (message type 100).
 */
export type SyncWireFrame =
  | { type: 'syncStep1'; stateVector: Uint8Array }
  | { type: 'syncStep2'; update: Uint8Array }
  | { type: 'update'; update: Uint8Array }
  | { type: 'awareness'; update: Uint8Array }
  | { type: 'queryAwareness' }
  | { type: 'permissionDenied'; reason: string }
  | { type: 'control'; tag: WorkingSetTag };

/**
 * What {@link decode} returns. Either a frame this codec understands, an
 * ignorable frame of an unknown OUTER message type (the payload is left
 * unread), or a malformed frame with a human reason.
 *
 * decode NEVER throws: hostile or truncated input becomes `malformed`, not an
 * exception, so a bad frame can never take a WebSocket handler down with it.
 */
export type SyncWireDecodeResult =
  | SyncWireFrame
  | { type: 'unknown'; messageType: number }
  | { type: 'malformed'; reason: string };
