// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_OUT, generate } from '../../../scripts/generate-agent-room-scenarios.mjs';

/**
 * Pins the room-* and version-* files under test/fixtures/agent-server-scenarios
 * to their generator. C# AgentServerScenarioTests and Go
 * TestMatchesTheAgentServerScenarios read them.
 * Regenerate with `node scripts/generate-agent-room-scenarios.mjs`.
 */
describe('agent room scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('match what the generator writes', () => {
    const files = generate();
    const committed = readdirSync(DEFAULT_OUT).filter((name) => /^(room|version)-.*\.json$/.test(name)).sort();

    expect(committed, 'Run `node scripts/generate-agent-room-scenarios.mjs`.').toStrictEqual([...files.keys()].sort());
    for (const [name, text] of files) {
      expect(readFileSync(join(DEFAULT_OUT, name), 'utf8'), name).toBe(text);
    }
  });
});
