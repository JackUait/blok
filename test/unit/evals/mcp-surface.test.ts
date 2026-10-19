// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { executeResultOf, mcpArgs } from '../../evals/agent/runner/surfaces/mcp';

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

describe('executeResultOf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads an answer that leaves out empty changed lists, so graders still see what the agent touched', () => {
    const result = executeResultOf(JSON.stringify({ ok: true, revision: 'r', results: [{}], changed: { updated: ['p'] } }));

    expect(result).toEqual({ ok: true, changed: { created: [], updated: ['p'], moved: [], removed: [] } });
  });

  it('reads an answer with no changed set as touching nothing', () => {
    expect(executeResultOf(JSON.stringify({ ok: true, revision: 'r', results: [{}] }))).toEqual({
      ok: true, changed: { created: [], updated: [], moved: [], removed: [] },
    });
  });
});
