// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadParityCases } from '../agent/parity/corpus';
import { checkMcpCase } from '../agent/parity/mcp-harness';
import { conformanceCommand } from './mcp-process';
import { processOpener, SPAWNED_AGENT_ID, toGoldenActor } from './process-opener';
import { CASE_TIMEOUT_MS } from './fixture-suite';

const command = conformanceCommand();
const cases = loadParityCases();

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the spawned agent id maps to the golden actor', () => {
  it('maps only the exact spawned id, in createdWith and lastEditedWith', () => {
    const saved = { blocks: [
      { id: 'a', createdWith: SPAWNED_AGENT_ID, lastEditedWith: SPAWNED_AGENT_ID },
      { id: 'b', createdWith: 'agent:alice:parity', lastEditedWith: 'someone', data: { lastEditedWith: SPAWNED_AGENT_ID } },
    ] };

    expect(toGoldenActor(saved, 'agent-test')).toEqual({ blocks: [
      { id: 'a', createdWith: 'agent-test', lastEditedWith: 'agent-test' },
      { id: 'b', createdWith: 'agent:alice:parity', lastEditedWith: 'someone', data: { lastEditedWith: 'agent-test' } },
    ] });
  });
});

// The agent parity corpus, through the spawned binary in stored mode over the files source.
describe.skipIf(command === undefined)('MCP conformance: agent parity corpus (stored)', () => {
  it('has cases to exercise', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    if (command !== undefined) {
      await checkMcpCase(c, 'mcp-stored', processOpener(command));
    }
  }, CASE_TIMEOUT_MS);
});
