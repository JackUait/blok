// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentAttribution } from '../../../../src/shared/agent/attribution';

describe('agentAttribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('credits the person, with the agent as co-author', () => {
    expect(agentAttribution({ id: 'agent-1', onBehalfOf: 'human-1' })).toEqual({ by: 'human-1', with: 'agent-1' });
  });

  it('credits the agent alone when no person is known', () => {
    expect(agentAttribution({ id: 'agent-1' })).toEqual({ by: 'agent-1' });
    expect(agentAttribution({ id: 'agent-1', onBehalfOf: '' })).toEqual({ by: 'agent-1' });
  });

  it("credits only the person for attributeTo 'user'", () => {
    expect(agentAttribution({ id: 'agent-1', onBehalfOf: 'human-1' }, 'user')).toEqual({ by: 'human-1' });
  });

  it("names nobody for attributeTo 'user' when no person is known", () => {
    expect(agentAttribution({ id: 'agent-1' }, 'user')).toEqual({});
  });

  it('names nobody for an agent with no id', () => {
    expect(agentAttribution({ id: '' })).toEqual({});
  });
});
