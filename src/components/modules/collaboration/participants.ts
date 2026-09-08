import type { CollaborationParticipant } from '../../../../types/events/editor-events';

import { ANONYMOUS_LABEL_KEYS, assignAnonymousGlyphs } from './anonymous-identity';
import { readActiveAt, type DrawableState } from './presence';
import { normalizeUserId } from '../userDirectory';

/** Longest name drawn, matching what the renderer already caps at. */
const MAX_NAME_LENGTH = 32;

const readName = (value: unknown): string =>
  typeof value !== 'string'
    ? ''
    : Array.from(value.trim().slice(0, 2 * MAX_NAME_LENGTH)).slice(0, MAX_NAME_LENGTH).join('');

/** One connection's fields, before they are folded into a row. */
interface Member {
  clientId: number;
  activeAt: number | null;
  blockId: string | null;
  name: string;
  color: string;
}

/**
 * The member whose fields the row is published under: identity (name, color,
 * silhouette) and, on an exact activity tie, activity — always the LOWEST
 * client id in the group.
 *
 * Deterministic on client id rather than map-iteration order, which the
 * awareness map does not guarantee is the same in every browser. Without this
 * every collapsed row's name/color/glyph would be whichever connection the
 * local Map happened to enumerate first — the same person showing a different
 * face in every tab that is watching them.
 * @param members - every connection folded into one row, unsorted
 */
const lowestClientId = (members: Member[]): Member =>
  members.reduce((lowest, candidate) => (candidate.clientId < lowest.clientId ? candidate : lowest));

/**
 * The member whose `lastActiveAt`/`blockId` the row publishes: the highest
 * `activeAt`, ties going to the lowest client id — including the tie between
 * two members that have BOTH never published one. Ranking null as
 * "older than anything real" is what makes that last case fall through to the
 * same client-id rule instead of staying on whichever member the map
 * happened to enumerate first.
 * @param members - every connection folded into one row, unsorted
 */
const mostRecentlyActive = (members: Member[]): Member =>
  members.reduce((current, candidate) => {
    const currentRank = current.activeAt ?? Number.NEGATIVE_INFINITY;
    const candidateRank = candidate.activeAt ?? Number.NEGATIVE_INFINITY;

    return candidateRank > currentRank
      || (candidateRank === currentRank && candidate.clientId < current.clientId)
      ? candidate
      : current;
  });

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
  // Group first, publish second: every field a row carries has to be picked
  // from a group of members ALREADY KNOWN, never appended one at a time as
  // states stream by — that streaming shape is what let the first-seen
  // connection win identity fields by accident of map order.
  //
  // `userId` is kept beside the group rather than re-derived from the key
  // string: every member routed to the same key by construction shares the
  // identical verified id (or none), so recording it once at creation is
  // exact, and never mistakes a verified id that happens to READ like the
  // client-id fallback (`client:7`) for the fallback itself.
  const groups = new Map<string, { userId: string | null; members: Member[] }>();

  for (const entry of states) {
    const userId = normalizeUserId(identities.get(entry.clientId));
    const key = userId ?? `client:${entry.clientId}`;
    const member: Member = {
      clientId: entry.clientId,
      activeAt: readActiveAt(entry.state.activeAt, now),
      blockId: typeof entry.state.blockId === 'string' ? entry.state.blockId : null,
      name: readName(entry.state.user.name),
      color: typeof entry.state.user.color === 'string' ? entry.state.user.color : '',
    };
    const group = groups.get(key);

    if (group === undefined) {
      groups.set(key, { userId, members: [member] });
    } else {
      group.members.push(member);
    }
  }

  // One pass over every nameless client, room-wide, so the assignment matches
  // what each other browser computes for the same room. Per-row assignment
  // would give the same person a different face in each tab, and would hide a
  // slot COLLISION between two different nameless people entirely.
  const glyphs = assignAnonymousGlyphs(
    states.filter((entry) => readName(entry.state.user.name) === '').map((entry) => entry.clientId)
  );

  const rows: CollaborationParticipant[] = [];

  for (const { userId, members } of groups.values()) {
    const identity = lowestClientId(members);
    const activity = mostRecentlyActive(members);
    const glyph = identity.name === '' ? glyphs.get(identity.clientId) ?? null : null;

    rows.push({
      userId,
      present: true,
      self: members.some((member) => member.clientId === localClientId),
      clientIds: members.map((member) => member.clientId).sort((a, b) => a - b),
      lastActiveAt: activity.activeAt,
      blockId: activity.blockId,
      user: {
        name: identity.name,
        color: identity.color,
        glyph,
        // A label in the wrong language is worse than none, so a host that
        // wired no translator gets the silhouette and no phrase.
        label: glyph === null || translate === undefined ? null : translate(ANONYMOUS_LABEL_KEYS[glyph]),
      },
    });
  }

  return rows;
};
