import type { CollaborationParticipant } from '../../../../types/events/editor-events';

import { ANONYMOUS_LABEL_KEYS, assignAnonymousGlyphs } from './anonymous-identity';
import { readActiveAt, type DrawableState } from './presence';

/**
 * Longest verified id carried. Refused rather than truncated: a truncated id
 * is a different id that can collide with a real one, and a silent collision
 * merges two people into one row.
 */
const MAX_USER_ID_LENGTH = 128;

/** Longest name drawn, matching what the renderer already caps at. */
const MAX_NAME_LENGTH = 32;

const readName = (value: unknown): string =>
  typeof value !== 'string'
    ? ''
    : Array.from(value.trim().slice(0, 2 * MAX_NAME_LENGTH)).slice(0, MAX_NAME_LENGTH).join('');

/**
 * Turn the drawable awareness states into one row per person.
 *
 * The join key is the verified id when the room supplied one and the client id
 * otherwise, so two tabs of one signed-in person collapse while two anonymous
 * connections stay apart. `identities` is empty until the server half ships;
 * every row then keys on its own client id, which is exactly the behaviour the
 * old per-connection `peers` list had.
 * @param states - the drawable states PLUS this editor's own, so `self` exists
 * @param localClientId - this editor's own id, marked `self`
 * @param identities - client id to verified actor id, from the room
 * @param translate - localizes an anonymous label; omit and the label stays null
 * @param now - the receiver's clock, for the activity clamp
 */
export const buildParticipants = (
  states: DrawableState[],
  localClientId: number | null,
  identities: Map<number, string>,
  translate: ((key: string) => string) | undefined,
  now: number
): CollaborationParticipant[] => {
  const rows = new Map<string, CollaborationParticipant>();
  // Which client id currently owns a row's `lastActiveAt` and `blockId`. Kept
  // beside the rows rather than inside them, because it is bookkeeping and not
  // part of the published shape.
  const owner = new Map<string, number>();

  // One pass over every nameless client, so the assignment matches what each
  // other browser computes for the same room. Per-row assignment would give the
  // same person a different face in each tab.
  const glyphs = assignAnonymousGlyphs(
    states.filter((entry) => readName(entry.state.user.name) === '').map((entry) => entry.clientId)
  );

  for (const entry of states) {
    const raw = identities.get(entry.clientId);
    const userId = raw !== undefined && raw.length <= MAX_USER_ID_LENGTH ? raw : null;
    const key = userId ?? `client:${entry.clientId}`;
    const activeAt = readActiveAt(entry.state.activeAt, now);
    const blockId = typeof entry.state.blockId === 'string' ? entry.state.blockId : null;
    const existing = rows.get(key);

    if (existing === undefined) {
      const name = readName(entry.state.user.name);
      const glyph = name === '' ? glyphs.get(entry.clientId) ?? null : null;

      rows.set(key, {
        userId,
        present: true,
        self: entry.clientId === localClientId,
        clientIds: [entry.clientId],
        lastActiveAt: activeAt,
        blockId,
        user: {
          name,
          color: typeof entry.state.user.color === 'string' ? entry.state.user.color : '',
          glyph,
          // A label in the wrong language is worse than none, so a host that
          // wired no translator gets the silhouette and no phrase.
          label: glyph === null || translate === undefined ? null : translate(ANONYMOUS_LABEL_KEYS[glyph]),
        },
      });

      owner.set(key, entry.clientId);

      continue;
    }

    existing.clientIds.push(entry.clientId);
    existing.self = existing.self || entry.clientId === localClientId;

    // A tie goes to the lower client id, the same rule the glyph assignment
    // uses, because two tabs can stamp the identical millisecond. Compared
    // against the CURRENT owner, never against the row's own id list — that
    // list already contains this entry, so the test would never fire.
    const held = owner.get(key) ?? entry.clientId;
    const wins = activeAt !== null &&
      (existing.lastActiveAt === null ||
        activeAt > existing.lastActiveAt ||
        (activeAt === existing.lastActiveAt && entry.clientId < held));

    if (wins) {
      existing.lastActiveAt = activeAt;
      existing.blockId = blockId;
      owner.set(key, entry.clientId);
    }
  }

  return [...rows.values()].map((row) => ({ ...row, clientIds: [...row.clientIds].sort((a, b) => a - b) }));
};
