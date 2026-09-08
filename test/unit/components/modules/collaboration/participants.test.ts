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
    expect(nameless.user.glyph).not.toBeNull();
    expect(nameless.user.label).toBe(`t:presence.anonymous.${nameless.user.glyph ?? ''}`);
  });

  it('leaves the label null when no translator was supplied', () => {
    const [nameless] = buildParticipants([state(9, { user: {} })], 42, new Map(), undefined, NOW);

    expect(nameless.user.glyph).not.toBeNull();
    expect(nameless.user.label).toBeNull();
  });
});
