// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { modelAnswer } from '../../../src/shared/agent/model-answer';
import type { AgentResult } from '../../../types/agent';
import { agentTouched } from '../../evals/agent/graders/collab';
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

  it('counts every block the agent touched when the answer caps the changed lists', () => {
    const created = Array.from({ length: 60 }, (_, index) => `b${index}`);
    const full: AgentResult = {
      ok: true,
      revision: 'r',
      results: [{ ids: created.slice(0, 40) }, { id: 'b40', childIds: created.slice(41) }, { removedIds: ['gone'] }],
      refs: {},
      changed: { created, updated: [], moved: [], removed: ['gone'] },
      warnings: [],
    };
    const touched = agentTouched([executeResultOf(JSON.stringify(modelAnswer(full)))]);

    expect(touched.size).toBe(60);
    expect(touched.has('gone')).toBe(false);
  });

  it('reads an answer with no changed set as touching nothing', () => {
    expect(executeResultOf(JSON.stringify({ ok: true, revision: 'r', results: [{}] }))).toEqual({
      ok: true, changed: { created: [], updated: [], moved: [], removed: [] },
    });
  });
});
