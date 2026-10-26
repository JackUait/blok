// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultAgentActor } from '../../../src/mcp/actor';
import { openMcpLive, openMcpStored } from '../agent/parity/mcp-harness';

import type { OutputData } from '../../../types';

const SEED: OutputData = {
  blocks: [{
    id: 'db',
    type: 'database',
    data: {
      title: 'Tasks',
      schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }],
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', filters: [], sorts: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
  }],
};

// The actor blok-mcp makes for the caller the harness signs in as.
const ACTOR = defaultAgentActor('alice', 'parity');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each([['stored', openMcpStored], ['live', openMcpLive]] as const)('blok-mcp %s stamps what an agent creates', (_mode, open) => {
  it('as the editor does: created now, by the person, with the agent', async () => {
    const run = await open(SEED, ACTOR);

    try {
      const done = await run.execute({ commands: [
        { name: 'block.insert', args: { id: 'n1', type: 'paragraph', data: { text: 'new' }, position: 'end' } },
        { name: 'database.addRow', args: { id: 'db', values: { t: 'Row' } } },
      ] });

      expect(done.ok).toBe(true);
      const created = run.output().blocks.filter(block => block.id === 'n1' || block.type === 'database-row');

      expect(created).toHaveLength(2);
      for (const block of created) {
        expect(block, block.id).toMatchObject({ createdAt: expect.any(Number), createdBy: 'alice', createdWith: ACTOR.id });
      }
    } finally {
      await run.close();
    }
  });
});
