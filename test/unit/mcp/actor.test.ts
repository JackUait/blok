// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentPresenceName, defaultAgentActor, safeClientName } from '../../../src/mcp/actor';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MCP agent identity', () => {
  it('attributes the agent to its own id and names the represented principal', () => {
    expect(defaultAgentActor('user-42', 'desktop')).toEqual({
      id: 'agent:user-42:desktop',
      name: 'desktop (for user-42)',
      kind: 'agent',
      onBehalfOf: 'user-42',
    });
  });

  it('preserves safe client-name characters', () => {
    expect(safeClientName('Agent_2.3-test')).toBe('Agent_2.3-test');
  });

  it('replaces unsafe characters before the name reaches the actor id', () => {
    const clientName = safeClientName('Desktop/1.0 (mac):test');

    expect(clientName).toBe('Desktop-1.0--mac--test');
    expect(defaultAgentActor('user-42', clientName).id).toBe('agent:user-42:Desktop-1.0--mac--test');
  });

  it.each([undefined, ''])('uses a fallback for an absent client name (%s)', raw => {
    expect(safeClientName(raw)).toBe('mcp-client');
  });

  it('limits client names to 64 safe characters', () => {
    expect(safeClientName('x'.repeat(200))).toBe('x'.repeat(64));
  });

  it('publishes the bare client name as the presence name of a default agent', () => {
    const actor = defaultAgentActor('alice', 'claude-code');

    expect(agentPresenceName({ customActor: false, clientName: 'claude-code', actor })).toBe('claude-code');
    expect(actor.name).toBe('claude-code (for alice)');
  });

  it('publishes a custom actor name as given', () => {
    const actor = { id: 'bot:1', name: 'Release bot (for alice)', kind: 'agent' as const, onBehalfOf: 'alice' };

    expect(agentPresenceName({ customActor: true, clientName: 'claude-code', actor })).toBe('Release bot (for alice)');
  });
});
