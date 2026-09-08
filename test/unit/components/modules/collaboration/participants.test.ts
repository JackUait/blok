import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { buildParticipants } from '../../../../../src/components/modules/collaboration/participants';
import type { DrawableState } from '../../../../../src/components/modules/collaboration/presence';

const NOW = 1_700_000_000_000;

const state = (clientId: number, fields: Record<string, unknown>): DrawableState =>
  ({ clientId, state: { user: {}, ...fields } });

describe('buildParticipants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports one connection as one present participant', () => {
    const [participant] = buildParticipants(
      [state(7, { user: { name: 'Ada', color: '#ff0000' }, blockId: 'block-1', activeAt: NOW - 1000 })],
      42,
      new Map(),
      undefined,
      NOW
    );

    expect(participant.clientIds).toEqual([7]);
    expect(participant.present).toBe(true);
    expect(participant.self).toBe(false);
    expect(participant.userId).toBeNull();
    expect(participant.lastActiveAt).toBe(NOW - 1000);
    expect(participant.blockId).toBe('block-1');
    expect(participant.user.name).toBe('Ada');
  });

  // Two tabs of one signed-in person are one person. Keyed by clientId they
  // would be two rows, and a host drawing faces would show the same photo twice.
  it('collapses two client ids that share a verified identity', () => {
    const [participant, ...rest] = buildParticipants(
      [
        state(7, { user: { name: 'Ada', color: '#ff0000' }, blockId: 'block-1', activeAt: NOW - 9000 }),
        state(9, { user: { name: 'Ada', color: '#ff0000' }, blockId: 'block-2', activeAt: NOW - 1000 }),
      ],
      42,
      new Map([[7, 'u_7'], [9, 'u_7']]),
      undefined,
      NOW
    );

    expect(rest).toHaveLength(0);
    expect(participant.userId).toBe('u_7');
    expect(participant.clientIds).toEqual([7, 9]);
    expect(participant.lastActiveAt).toBe(NOW - 1000);
    expect(participant.blockId).toBe('block-2');
  });

  // Two tabs can stamp the identical millisecond, so the winner cannot be left
  // to whichever the awareness map happened to yield first.
  it('breaks an exact activity tie on the lowest client id', () => {
    const [participant] = buildParticipants(
      [
        state(9, { user: {}, blockId: 'block-9', activeAt: NOW }),
        state(7, { user: {}, blockId: 'block-7', activeAt: NOW }),
      ],
      42,
      new Map([[7, 'u_7'], [9, 'u_7']]),
      undefined,
      NOW
    );

    expect(participant.blockId).toBe('block-7');
  });

  // Neither tab has ever published an activity stamp: `blockId` still cannot
  // be left to whichever the awareness map happened to yield first.
  it('falls back to the lowest client id for blockId when neither member has ever been active', () => {
    const [participant] = buildParticipants(
      [
        state(9, { user: {}, blockId: 'block-9' }),
        state(7, { user: {}, blockId: 'block-7' }),
      ],
      42,
      new Map([[7, 'u_7'], [9, 'u_7']]),
      undefined,
      NOW
    );

    expect(participant.lastActiveAt).toBeNull();
    expect(participant.blockId).toBe('block-7');
  });

  // clientId 7's own base slot is 'sun' (7 % 12); clientId 9's is 'galaxy'
  // (9 % 12) — see anonymous-identity.ts's `baseSlot`. States arrive with the
  // HIGHER client id first, the shape a map that "yields 9 first" produces:
  // identity fields must still come from the LOWEST client id, or the same
  // verified person draws a different glyph depending on which browser's
  // awareness map happens to enumerate first.
  it('takes identity fields from the lowest client id, not whichever entry arrives first', () => {
    const [participant] = buildParticipants(
      [state(9, { user: {} }), state(7, { user: {} })],
      42,
      new Map([[9, 'u_7'], [7, 'u_7']]),
      undefined,
      NOW
    );

    expect(participant.user.glyph).toBe('sun');
  });

  it('clamps a stamp from the future and drops one past the age cap', () => {
    const [ahead, ancient] = buildParticipants(
      [
        state(7, { user: {}, activeAt: NOW + 60_000 }),
        state(9, { user: {}, activeAt: NOW - 86_400_001 }),
      ],
      42,
      new Map(),
      undefined,
      NOW
    );

    expect(ahead.lastActiveAt).toBe(NOW);
    expect(ancient.lastActiveAt).toBeNull();
  });

  it('refuses a verified id longer than 128 characters rather than truncating it', () => {
    const [participant] = buildParticipants(
      [state(7, { user: {} })],
      42,
      new Map([[7, 'u'.repeat(129)]]),
      undefined,
      NOW
    );

    expect(participant.userId).toBeNull();
  });

  // A blank id off the wire must not become the join key: two different
  // people who both happen to report an empty (or all-whitespace) id would
  // otherwise collapse into ONE participant.
  it('refuses a blank verified id rather than merging every blank-id client into one', () => {
    const [first, second] = buildParticipants(
      [state(7, { user: { name: 'Ada' } }), state(9, { user: { name: 'Grace' } })],
      42,
      new Map([[7, ''], [9, '   ']]),
      undefined,
      NOW
    );

    expect(first.userId).toBeNull();
    expect(second.userId).toBeNull();
    expect(first.clientIds).toEqual([7]);
    expect(second.clientIds).toEqual([9]);
  });

  // The renderer filters the reader out because it must not draw their own
  // caret. This list is the opposite: every product that draws it draws the
  // reader, so `self` has to be reachable.
  it('marks the reader as self when their own state is in the list', () => {
    const rows = buildParticipants(
      [state(7, { user: { name: 'Ada' } }), state(42, { user: { name: 'Me' } })],
      42,
      new Map(),
      undefined,
      NOW
    );

    expect(rows.filter((row) => row.self).map((row) => row.clientIds)).toEqual([[42]]);
  });

  // A nameless person is drawn as a silhouette, and the assignment has to match
  // what every other browser computes or the same person wears two faces.
  it('gives a nameless participant a silhouette and a localized label', () => {
    const [named, nameless] = buildParticipants(
      [state(7, { user: { name: 'Ada' } }), state(9, { user: {} })],
      42,
      new Map(),
      (key) => `t:${key}`,
      NOW
    );

    expect(named.user.glyph).toBeNull();
    expect(named.user.label).toBeNull();
    // clientId 9's base slot is 9 % 12 (ANONYMOUS_GLYPHS.length) = 9 =
    // 'galaxy', worked out independently of buildParticipants's own output —
    // deriving the expected label from the actual glyph would only prove the
    // two are consistent with EACH OTHER, not that either is correct.
    expect(nameless.user.glyph).toBe('galaxy');
    expect(nameless.user.label).toBe('t:presence.anonymous.galaxy');
  });

  it('leaves the label null when no translator was supplied', () => {
    const [nameless] = buildParticipants([state(9, { user: {} })], 42, new Map(), undefined, NOW);

    expect(nameless.user.glyph).not.toBeNull();
    expect(nameless.user.label).toBeNull();
  });

  // clientId 1 and clientId 13 collide on the same base slot (1 % 12 === 13
  // % 12, ANONYMOUS_GLYPHS.length === 12), so only a ROOM-WIDE assignment
  // pass can tell they need pushing apart. A per-row pass — computing
  // `assignAnonymousGlyphs` on each client id alone — cannot see the other
  // occupant of its own base slot, and would silently draw both with the
  // same silhouette.
  it('pushes two nameless clients apart when their base slot collides', () => {
    const [first, second] = buildParticipants(
      [state(1, { user: {} }), state(13, { user: {} })],
      42,
      new Map(),
      undefined,
      NOW
    );

    expect(first.user.glyph).not.toBeNull();
    expect(second.user.glyph).not.toBeNull();
    expect(first.user.glyph).not.toBe(second.user.glyph);
  });

  // A UTF-16 `.slice` cuts an astral character (a surrogate pair) in half
  // once the cut point lands on an odd offset. The leading 'A' pushes the
  // rocket-emoji run onto exactly such an offset, so this fails against a
  // UTF-16 slice and passes only against a code-point-aware cap.
  it('caps a name by code points, not UTF-16 units, so an emoji is never cut mid-surrogate', () => {
    const name = `A${'\u{1F680}'.repeat(40)}`;

    const [participant] = buildParticipants(
      [state(7, { user: { name } })],
      42,
      new Map(),
      undefined,
      NOW
    );

    expect(Array.from(participant.user.name)).toHaveLength(32);
    expect(participant.user.name).not.toMatch(/[\uD800-\uDBFF]$/u);
    expect(participant.user.name).toBe(`A${'\u{1F680}'.repeat(31)}`);
  });
});
