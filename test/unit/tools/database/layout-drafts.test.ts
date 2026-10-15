import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LAYOUT_MAKER_ABSENCE_MS, LayoutDraftSession } from '../../../../src/tools/database/layout-drafts';
import type { CollaborationParticipant, CollaborationStatusChangedPayload } from '../../../../types/events/editor-events';

const row = (clientIds: number[], self = false): CollaborationParticipant => ({
  userId: null,
  present: true,
  self,
  clientIds,
  lastActiveAt: null,
  blockId: null,
  user: { name: '', color: '#000000', glyph: null, label: null },
});

const status = (participants: CollaborationParticipant[], state: CollaborationStatusChangedPayload['status'] = 'connected'): CollaborationStatusChangedPayload =>
  ({ status: state, participants });

const MAKER = 7;
const draft = { at: 0, by: [MAKER] };
const T0 = 1_000_000_000_000;

describe('LayoutDraftSession: when a collaborator\'s draft is abandoned', () => {
  let session: LayoutDraftSession;

  beforeEach(() => {
    vi.clearAllMocks();
    session = new LayoutDraftSession();
  });

  it('keeps a draft through a short drop-out of its maker, however long this editor has been connected', () => {
    session.notePresence(status([row([1], true)]), T0);
    session.notePresence(status([row([1], true), row([MAKER])]), T0 + 60 * 60_000);
    expect(session.isAbandoned('d', draft, T0 + 60 * 60_000)).toBe(false);
    // The room withdraws the maker at once when its socket drops.
    session.notePresence(status([row([1], true)]), T0 + 60 * 60_000 + 1_000);

    expect(session.isAbandoned('d', draft, T0 + 60 * 60_000 + 40_000)).toBe(false);
  });

  it('deletes only after the maker has been absent the whole window, counted from when it was last seen', () => {
    const seen = T0 + 5 * 60_000;

    session.notePresence(status([row([1], true), row([MAKER])]), T0);
    expect(session.isAbandoned('d', draft, T0)).toBe(false);
    session.notePresence(status([row([1], true), row([MAKER])]), seen);
    session.notePresence(status([row([1], true)]), seen + 1);

    expect(session.isAbandoned('d', draft, seen + LAYOUT_MAKER_ABSENCE_MS - 1)).toBe(false);
    expect(session.isAbandoned('d', draft, seen + LAYOUT_MAKER_ABSENCE_MS + 1)).toBe(true);
  });

  it('starts the window when this editor first sees the draft, not from the maker\'s clock', () => {
    session.notePresence(status([row([1], true)]), T0);
    const later = T0 + 2 * LAYOUT_MAKER_ABSENCE_MS;

    // `at: 0` is ancient on any clock: it must not count.
    expect(session.isAbandoned('d', draft, later)).toBe(false);
    expect(session.isAbandoned('d', draft, later + LAYOUT_MAKER_ABSENCE_MS - 1)).toBe(false);
    expect(session.isAbandoned('d', draft, later + LAYOUT_MAKER_ABSENCE_MS + 1)).toBe(true);
  });

  it('judges a list complete by connections, not by rows that fold one person\'s tabs', () => {
    // 20 people with 3 tabs each: 60 connections, past the 50 the status lists.
    const rows = Array.from({ length: 20 }, (_, i) => row([100 + 3 * i, 101 + 3 * i, 102 + 3 * i], i === 0));

    session.notePresence(status(rows), T0);
    session.isAbandoned('d', draft, T0);

    expect(session.isAbandoned('d', draft, T0 + 2 * LAYOUT_MAKER_ABSENCE_MS)).toBe(false);
  });

  it('never deletes while not connected', () => {
    session.notePresence(status([row([1], true)]), T0);
    session.isAbandoned('d', draft, T0);
    session.notePresence(status([row([1], true)], 'offline'), T0 + 1);

    expect(session.isAbandoned('d', draft, T0 + 2 * LAYOUT_MAKER_ABSENCE_MS)).toBe(false);
  });
});
