// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mcpArgs } from '../../evals/agent/runner/surfaces/mcp';

describe('mcpArgs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes no --schema for the shipped setup, so the server picks its own default', () => {
    expect(mcpArgs('bin.mjs', '/docs', 'shipped', [])).toEqual(['bin.mjs', '--source', 'files:/docs']);
  });

  it('passes the schema an experiment names', () => {
    expect(mcpArgs('bin.mjs', '/docs', 'full', ['--x'])).toEqual(['bin.mjs', '--source', 'files:/docs', '--schema', 'full', '--x']);
  });
});
