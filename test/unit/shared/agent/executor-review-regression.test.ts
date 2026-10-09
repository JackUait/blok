// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { failure } from '../../../../src/shared/agent/errors';
import { runBatch } from '../../../../src/shared/agent/executor';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';

import type { AgentApplier } from '../../../../src/shared/agent/executor';
import type { PlannerContext } from '../../../../src/shared/agent/types';
import type { AgentActor, AgentResult, CommandLogEntry, OutputData } from '../../../../types';

import { plannerContext, TOOLS, tool } from './fixtures';

const doc: OutputData = {
  blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] } }],
};
const containerDoc: OutputData = {
  blocks: [{ id: 'container', type: 'container', data: {} }],
};
const actor: AgentActor = { id: 'agent-1', name: 'Agent', kind: 'agent' };

interface MemoryApplier extends AgentApplier {
  current: DocSnapshot;
  applied: number;
}

const memoryApplier = (
  initial: OutputData = doc,
  over: Partial<AgentApplier> = {}
): MemoryApplier => {
  const state: MemoryApplier = {
    current: DocSnapshot.fromOutput(initial),
    applied: 0,
    runtime: 'node',
    isReadOnly: () => false,
    snapshot: () => state.current,
    revision: () => `r${state.applied}`,
    apply: (_plan, draft) => {
      state.current = draft;
      state.applied++;

      return Promise.resolve();
    },
    ...over,
  };

  return state;
};

const recordTools = () => {
  const tools = new Map(TOOLS);

  tools.set('record', tool('record', {
    data: {
      type: 'object',
      properties: { count: { type: 'integer' } },
      required: ['count'],
      additionalProperties: false,
    },
    defaultData: { count: 0 },
    insertRequires: ['host'],
  }));

  return tools;
};

const context = (tools: PlannerContext['tools']): Omit<PlannerContext, 'prepared'> => {
  const { prepared: _prepared, ...ctx } = plannerContext({ tools });

  return ctx;
};

const run = (
  batch: unknown,
  applier: AgentApplier,
  ctx: Omit<PlannerContext, 'prepared'>,
  log: CommandLogEntry[]
): Promise<AgentResult> => runBatch({
  batch, applier, ctx, actor, log, batchNo: 1, now: () => 7,
});

describe('runBatch preparation review regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('inserts the permitted paragraph without preparing the demoted record', async () => {
    const tools = recordTools();

    tools.set('container', tool('container', {
      children: {
        accepts: true, allow: ['paragraph'], ownedByTool: false,
        layout: false, deletedWithParent: false,
      },
    }));
    const prepareInsert = vi.fn((_type: string) => Promise.resolve({ count: 2 }));
    const applier = memoryApplier(containerDoc, { prepareInsert });
    const log: CommandLogEntry[] = [];
    const result = await run({ commands: [
      {
        name: 'block.insert',
        args: { id: 'child', type: 'record', parentId: 'container', demote: true },
        ref: 'made',
      },
      { name: 'doc.read', args: { ids: ['$made'], detail: 'full' } },
    ] }, applier, context(tools), log);

    expect(applier.current.toOutput()).toEqual({ blocks: [
      { id: 'container', type: 'container', data: {}, content: ['child'] },
      {
        id: 'child', type: 'paragraph', data: {}, parent: 'container',
        lastEditedBy: 'agent-1', lastEditedAt: 7,
      },
    ] });
    expect(result).toMatchObject({
      ok: true, revision: 'r1', refs: { made: 'child' },
      changed: { created: ['child'], updated: [], moved: [], removed: [] },
      results: [
        { id: 'child', childIds: [] },
        {
          revision: 'r1', rootId: null,
          blocks: [{
            id: 'child', type: 'paragraph', depth: 1, parentId: 'container', data: {},
          }],
        },
      ],
      warnings: [{ code: 'DEMOTED', commandIndex: 0 }],
    });
    expect(result.warnings).toHaveLength(1);
    expect(log).toEqual([
      {
        batch: 1, index: 0, name: 'block.insert',
        args: { id: 'child', type: 'record', parentId: 'container', demote: true },
        result: { id: 'child', childIds: [] }, actorId: 'agent-1',
      },
      {
        batch: 1, index: 1, name: 'doc.read',
        args: { ids: ['$made'], detail: 'full' },
        result: {
          revision: 'r1', rootId: null,
          blocks: [{
            id: 'child', type: 'paragraph', depth: 1, parentId: 'container', data: {},
          }],
        },
        actorId: 'agent-1',
      },
    ]);
    expect(applier.applied).toBe(1);
    expect(prepareInsert).not.toHaveBeenCalled();
  });

  it('uses the prepared payload of the permitted record fallback rather than its default data', async () => {
    const tools = recordTools();

    tools.set('container', tool('container', {
      children: {
        accepts: true, allow: ['record'], ownedByTool: false,
        layout: false, deletedWithParent: false,
      },
    }));
    const prepareInsert = vi.fn((_type: string) => Promise.resolve({ count: 2 }));
    const applier = memoryApplier(containerDoc, { prepareInsert });
    const log: CommandLogEntry[] = [];
    const result = await run({ commands: [
      {
        name: 'block.insert',
        args: { id: 'child', type: 'paragraph', parentId: 'container', demote: true },
        ref: 'made',
      },
      { name: 'doc.read', args: { ids: ['$made'], detail: 'full' } },
    ] }, applier, context(tools), log);

    expect(applier.current.get('child')?.data).toEqual({ count: 2 });
    expect(applier.current.toOutput()).toEqual({ blocks: [
      { id: 'container', type: 'container', data: {}, content: ['child'] },
      {
        id: 'child', type: 'record', data: { count: 2 }, parent: 'container',
        lastEditedBy: 'agent-1', lastEditedAt: 7,
      },
    ] });
    expect(result).toMatchObject({
      ok: true, revision: 'r1', refs: { made: 'child' },
      changed: { created: ['child'], updated: [], moved: [], removed: [] },
      results: [
        { id: 'child', childIds: [] },
        {
          revision: 'r1', rootId: null,
          blocks: [{
            id: 'child', type: 'record', depth: 1, parentId: 'container', data: { count: 2 },
          }],
        },
      ],
      warnings: [{ code: 'DEMOTED', commandIndex: 0 }],
    });
    expect(result.warnings).toHaveLength(1);
    expect(log).toEqual([
      {
        batch: 1, index: 0, name: 'block.insert',
        args: { id: 'child', type: 'paragraph', parentId: 'container', demote: true },
        result: { id: 'child', childIds: [] }, actorId: 'agent-1',
      },
      {
        batch: 1, index: 1, name: 'doc.read',
        args: { ids: ['$made'], detail: 'full' },
        result: {
          revision: 'r1', rootId: null,
          blocks: [{
            id: 'child', type: 'record', depth: 1, parentId: 'container', data: { count: 2 },
          }],
        },
        actorId: 'agent-1',
      },
    ]);
    expect(applier.applied).toBe(1);
    expect(prepareInsert).toHaveBeenCalledOnce();
    expect(prepareInsert).toHaveBeenCalledWith('record');
  });

  it('attributes an index-less typed preparation error to command 1 without replacing a supplied index', async () => {
    const batch = { commands: [
      { name: 'doc.read', args: {} },
      { name: 'block.insert', args: { type: 'record' } },
    ] };
    const details = { reason: 'host', resource: { id: 'outside', policy: 'forbidden' } };
    const path = '/commands/1/args/type';
    const typedFailure = failure('PRECONDITION_FAILED', 'Host refused.', { path, details });
    const prepareInsert = vi.fn((_type: string) => Promise.reject(typedFailure));
    const applier = memoryApplier(doc, { prepareInsert });
    const log: CommandLogEntry[] = [];
    const result = await run(batch, applier, context(recordTools()), log);
    const expectedError = {
      code: 'PRECONDITION_FAILED', message: 'Host refused.', retryable: false,
      commandIndex: 1, path: '/commands/1/args/type',
      details: { reason: 'host', resource: { id: 'outside', policy: 'forbidden' } },
    };

    expect(log[1]?.error).toEqual(expectedError);
    expect(result).toEqual({
      ok: false, revision: 'r0', error: expectedError, warnings: [],
    });
    expect(applier.current.toOutput()).toEqual(doc);
    expect(log).toEqual([
      { batch: 1, index: 0, name: 'doc.read', args: {}, actorId: 'agent-1' },
      {
        batch: 1, index: 1, name: 'block.insert', args: { type: 'record' },
        error: expectedError, actorId: 'agent-1',
      },
    ]);
    expect(applier.applied).toBe(0);

    const suppliedFailure = failure('PRECONDITION_FAILED', 'Host refused.', {
      commandIndex: 0, path, details,
    });
    const suppliedPrepare = vi.fn((_type: string) => Promise.reject(suppliedFailure));
    const suppliedApplier = memoryApplier(doc, { prepareInsert: suppliedPrepare });
    const suppliedLog: CommandLogEntry[] = [];
    const suppliedResult = await run(batch, suppliedApplier, context(recordTools()), suppliedLog);
    const suppliedError = { ...expectedError, commandIndex: 0 };

    expect(suppliedResult).toEqual({
      ok: false, revision: 'r0', error: suppliedError, warnings: [],
    });
    expect(suppliedApplier.current.toOutput()).toEqual(doc);
    expect(suppliedLog).toEqual([
      {
        batch: 1, index: 0, name: 'doc.read', args: {},
        error: suppliedError, actorId: 'agent-1',
      },
      {
        batch: 1, index: 1, name: 'block.insert', args: { type: 'record' },
        actorId: 'agent-1',
      },
    ]);
    expect(suppliedApplier.applied).toBe(0);
    expect(prepareInsert).toHaveBeenCalledOnce();
    expect(prepareInsert).toHaveBeenCalledWith('record');
    expect(suppliedPrepare).toHaveBeenCalledOnce();
    expect(suppliedPrepare).toHaveBeenCalledWith('record');
  });
});
