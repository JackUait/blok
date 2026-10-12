// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPresenceColor } from '../../../src/components/modules/collaboration/presence';
import { AgentPresence } from '../../../src/mcp/live/presence';
import type { AgentActor, AgentResult, ChangedSet, TextRangeRef } from '../../../types/agent';

const actor: AgentActor = { id: 'agent:alice:claude', name: 'claude (for alice)', kind: 'agent', onBehalfOf: 'alice', color: '#7c3aed' };
const result = (changed: Partial<ChangedSet>, lastRange?: TextRangeRef): AgentResult => ({
  ok: true,
  revision: '1',
  results: [],
  refs: {},
  warnings: [],
  changed: { created: [], updated: [], moved: [], removed: [], ...changed },
  ...(lastRange !== undefined && { lastRange }),
});

describe('AgentPresence', () => {
  let fields: Record<string, unknown>;
  const activity = vi.fn<() => boolean>();
  let clock: number;
  let presence: AgentPresence;

  const target = (): { setAwarenessField(field: string, value: unknown): void; sendActivity(): boolean } => ({
    setAwarenessField: (field, value) => {
      fields[field] = value;
    },
    sendActivity: activity,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    fields = {};
    clock = 1_000_000;
    activity.mockReturnValue(true);
    presence = new AgentPresence(target(), { actor, name: 'claude', onBehalfOfName: 'Alice', now: () => clock });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('announces a named agent participant with its own id', () => {
    presence.announce();

    // The browser composes "<agent> for <name>" (03 §3.10), so the published name carries no "(for …)".
    expect(fields.user).toEqual({ name: 'claude', color: '#7c3aed', id: 'agent:alice:claude' });
    expect(fields.agent).toEqual({ via: 'mcp', onBehalfOf: 'alice', onBehalfOfName: 'Alice' });
    expect('caret' in fields).toBe(false);
  });

  it('points at the last created block and sets a block-level cursor', () => {
    presence.afterBatch(result({ created: ['a', 'b'], updated: ['c'] }));

    expect(fields.blockId).toBe('b');
    expect(fields.activeAt).toBe(clock);
    expect(fields.agentCursor).toEqual({ actorId: actor.id, name: 'claude', color: '#7c3aed', blockId: 'b' });
  });

  it('falls back to updated, then moved', () => {
    presence.afterBatch(result({ updated: ['u1', 'u2'], moved: ['m'] }));
    expect(fields.blockId).toBe('u2');
    presence.afterBatch(result({ moved: ['m1'] }));
    expect(fields.blockId).toBe('m1');
  });

  it('uses lastRange for a text-level cursor', () => {
    presence.afterBatch(result({ updated: ['p'] }, { blockId: 'p', field: 'text', start: 4, end: 12 }));

    expect(fields.agentCursor).toEqual({ actorId: actor.id, name: 'claude', color: '#7c3aed', blockId: 'p', field: 'text', start: 4, end: 12 });
  });

  it('keeps the old cursor after a batch that touched nothing', () => {
    presence.afterBatch(result({ created: ['a'] }));
    presence.afterBatch(result({}));

    expect(fields.blockId).toBe('a');
  });

  it('sends activity at most once a minute, and a failed send does not count', () => {
    activity.mockReturnValueOnce(false);
    presence.afterBatch(result({ created: ['a'] }));
    presence.afterBatch(result({ created: ['b'] }));
    clock += 30_000;
    presence.afterBatch(result({ created: ['c'] }));
    clock += 30_000;
    presence.afterBatch(result({ created: ['d'] }));

    expect(activity).toHaveBeenCalledTimes(3);
  });

  it('clears the cursor and block on clear', () => {
    presence.afterBatch(result({ created: ['a'] }));
    presence.clear();

    expect(fields.agentCursor).toBeNull();
    expect(fields.blockId).toBeNull();
  });

  it('publishes actor.name when no presence name is given', () => {
    const custom = new AgentPresence(target(), { actor: { ...actor, name: 'Release bot' } });

    custom.announce();
    custom.afterBatch(result({ created: ['a'] }));

    expect(fields.user).toMatchObject({ name: 'Release bot' });
    expect(fields.agentCursor).toMatchObject({ name: 'Release bot' });
  });

  it('derives a valid color when the actor has none, the same one every time', () => {
    const plain = (): AgentPresence => new AgentPresence(target(), { actor: { id: 'agent:x', name: 'x', kind: 'agent', onBehalfOf: 'x' } });

    plain().announce();
    const first = fields.user;

    plain().announce();
    expect(fields.user).toEqual(first);
    expect(isPresenceColor((fields.user as { color: unknown }).color)).toBe(true);
  });
});
