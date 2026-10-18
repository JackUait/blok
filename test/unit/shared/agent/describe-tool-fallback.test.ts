// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentFailure } from '../../../../src/shared/agent/errors';
import { openJsonSession } from '../../agent/harness';

const failureOf = (fn: () => unknown): AgentFailure['error'] => {
  try {
    fn();
  } catch (error) {
    if (error instanceof AgentFailure) {
      return error.error;
    }
    throw error;
  }
  throw new Error('Expected an AgentFailure');
};

describe('describe with a name that is not a block type', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers { tool } with a command name with that command, as { command } would', () => {
    const session = openJsonSession({ blocks: [] });

    try {
      expect(session.describe({ tool: 'block.insert' })).toEqual(session.describe({ command: 'block.insert' }));
    } finally {
      session.close();
    }
  });

  it('names the block types when { tool } matches neither a block type nor a command', () => {
    const session = openJsonSession({ blocks: [] });

    try {
      const error = failureOf(() => session.describe({ tool: 'bullets' }));

      expect(error.code).toBe('UNKNOWN_TOOL');
      expect(error.message).toMatch(/Known: .*\bparagraph\b.*/);
      expect(error.message).toMatch(/\blist\b/);
    } finally {
      session.close();
    }
  });
});
