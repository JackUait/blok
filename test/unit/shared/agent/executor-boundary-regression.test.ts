// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runBatch } from '../../../../src/shared/agent/executor';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';

import type { AgentApplier } from '../../../../src/shared/agent/executor';
import type { PlannerContext } from '../../../../src/shared/agent/types';
import type { AgentActor, AgentResult, CommandLogEntry, OutputData } from '../../../../types';

import { plannerContext, stubPorts, TOOLS, tool } from './fixtures';

const doc: OutputData = {
  blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] } }],
};
const actor: AgentActor = { id: 'agent-1', name: 'Agent', kind: 'agent' };
const recordSchema = {
  type: 'object',
  properties: { count: { type: 'integer' } },
  required: ['count'],
  additionalProperties: false,
};

interface MemoryApplier extends AgentApplier {
  current: DocSnapshot;
  version: string;
  applied: number;
}

const memoryApplier = (
  initial: OutputData = doc,
  over: Partial<AgentApplier> = {}
): MemoryApplier => {
  const state: MemoryApplier = {
    current: DocSnapshot.fromOutput(initial),
    version: 'r0',
    applied: 0,
    runtime: 'node',
    isReadOnly: () => false,
    snapshot: () => state.current,
    revision: () => state.version,
    apply: (_plan, draft) => {
      state.current = draft;
      state.applied++;
      state.version = `r${state.applied}`;

      return Promise.resolve();
    },
    ...over,
  };

  return state;
};

const recordTools = () => {
  const tools = new Map(TOOLS);

  tools.set('record', tool('record', {
    data: recordSchema, defaultData: { count: 0 }, insertRequires: ['host'],
  }));

  return tools;
};

const context = (over: Partial<PlannerContext> = {}): Omit<PlannerContext, 'prepared'> => {
  const { prepared: _prepared, ...ctx } = plannerContext(over);

  return ctx;
};

const run = (
  batch: unknown,
  applier: AgentApplier,
  log: CommandLogEntry[],
  ctx: Omit<PlannerContext, 'prepared'> = context()
): Promise<AgentResult> => runBatch({
  batch, applier, ctx, actor, log, batchNo: 1, now: () => 7,
});

const gate = (): { promise: Promise<void>; release(): void } => {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>(accept => {
    resolve = accept;
  });

  return {
    promise,
    release: () => {
      if (resolve === undefined) {
        throw new Error('The gate has no resolver.');
      }
      resolve();
    },
  };
};

const waitForEntry = (entry: Promise<void>, batch: Promise<AgentResult>): Promise<void> =>
  Promise.race([entry, batch.then(() => {
    throw new Error('The batch finished before preparation began.');
  })]);

describe('runBatch fresh-placement and runtime failure boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses a fresh fallback type change without applying the old preparation or preparing again', async () => {
    const initial: OutputData = {
      blocks: [{ id: 'parent', type: 'record_parent', data: {} }],
    };
    const peerDoc: OutputData = {
      blocks: [{ id: 'parent', type: 'alternate_parent', data: {} }],
    };
    const tools = recordTools();

    tools.set('alternate_record', tool('alternate_record', {
      data: recordSchema, defaultData: { count: 0 }, insertRequires: ['host'],
    }));
    tools.set('record_parent', tool('record_parent', {
      children: {
        accepts: true, allow: ['record'], ownedByTool: false,
        layout: false, deletedWithParent: false,
      },
    }));
    tools.set('alternate_parent', tool('alternate_parent', {
      children: {
        accepts: true, allow: ['alternate_record'], ownedByTool: false,
        layout: false, deletedWithParent: false,
      },
    }));
    const entered = gate();
    const release = gate();
    const prepareInsert = vi.fn(async (_type: string) => {
      entered.release();
      await release.promise;

      return { count: 2 };
    });
    const applier = memoryApplier(initial, { prepareInsert });
    const log: CommandLogEntry[] = [];
    const sanitizedTypes: string[] = [];
    const ctx = context({ tools, ports: stubPorts({
      sanitizeBlockData: (type, data) => {
        sanitizedTypes.push(type);

        return data;
      },
    }) });
    const pending = run({ commands: [
      { name: 'doc.read', args: {} },
      {
        name: 'block.insert',
        args: { id: 'child', type: 'record', parentId: 'parent', demote: true },
      },
    ] }, applier, log, ctx);

    await waitForEntry(entered.promise, pending);
    applier.current = DocSnapshot.fromOutput(peerDoc);
    applier.version = 'peer';
    release.release();
    const result = await pending;

    expect(result).toMatchObject({
      ok: false, revision: 'peer',
      error: {
        code: 'ORPHANED_SIDE_EFFECT', commandIndex: 1,
        details: {
          orphaned: [{ command: 'block.insert', type: 'record', prepared: { count: 2 } }],
          cause: { code: 'STALE', commandIndex: 1, retryable: true },
        },
      },
    });
    expect(applier.current.toOutput()).toEqual(peerDoc);
    if (result.ok) {
      throw new Error('Expected the changed preparation type to be refused.');
    }
    expect(log).toEqual([
      { batch: 1, index: 0, name: 'doc.read', args: {}, actorId: 'agent-1' },
      {
        batch: 1, index: 1, name: 'block.insert',
        args: { id: 'child', type: 'record', parentId: 'parent', demote: true },
        error: result.error, actorId: 'agent-1',
      },
    ]);
    expect(applier.applied).toBe(0);
    expect(sanitizedTypes).toEqual(['record', 'alternate_record']);
    expect(prepareInsert).toHaveBeenCalledOnce();
    expect(prepareInsert).toHaveBeenCalledWith('record');
  });

  it('reports a settle rejection with the returned preparation receipt and applies nothing', async () => {
    const prepareInsert = vi.fn((_type: string) => Promise.resolve({ count: 2 }));
    const settle = vi.fn(() => Promise.reject(new Error('settle refused')));
    const applier = memoryApplier(doc, { prepareInsert, settle });
    const log: CommandLogEntry[] = [];
    const pending = run({ commands: [
      { name: 'block.insert', args: { type: 'record' } },
    ] }, applier, log, context({ tools: recordTools() }));

    await expect(pending).resolves.toMatchObject({
      ok: false, revision: 'r0',
      error: {
        code: 'ORPHANED_SIDE_EFFECT',
        details: {
          orphaned: [{ command: 'block.insert', type: 'record', prepared: { count: 2 } }],
          cause: {
            code: 'APPLY_FAILED', retryable: false,
            message: expect.stringContaining('settle refused'),
          },
        },
      },
      warnings: [],
    });
    const result = await pending;

    expect(applier.current.toOutput()).toEqual(doc);
    if (result.ok) {
      throw new Error('Expected settle to return a structured failure.');
    }
    expect(log).toEqual([{
      batch: 1, index: 0, name: 'block.insert', args: { type: 'record' },
      error: result.error, actorId: 'agent-1',
    }]);
    expect(applier.applied).toBe(0);
    expect(prepareInsert).toHaveBeenCalledOnce();
    expect(prepareInsert).toHaveBeenCalledWith('record');
    expect(settle).toHaveBeenCalledOnce();
  });

  it('returns a structured initial revision failure without a failure revision', async () => {
    const applier = memoryApplier(doc, {
      revision: () => {
        throw new Error('revision unavailable');
      },
    });
    const log: CommandLogEntry[] = [];
    const pending = run({ commands: [
      { name: 'doc.read', args: {} },
    ] }, applier, log);

    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'APPLY_FAILED', retryable: false,
        message: expect.stringContaining('revision unavailable'),
      },
      warnings: [],
    });
    const result = await pending;

    expect(result).not.toHaveProperty('revision');
    expect(applier.current.toOutput()).toEqual(doc);
    if (result.ok) {
      throw new Error('Expected an unreadable revision to return a failure.');
    }
    expect(log).toEqual([{
      batch: 1, index: 0, name: 'doc.read', args: {},
      error: result.error, actorId: 'agent-1',
    }]);
    expect(applier.applied).toBe(0);
  });

  it('returns a structured failure and one error log when undo rejects', async () => {
    const undo = vi.fn(() => Promise.reject(new Error('undo refused')));
    const applier = memoryApplier(doc, { undo });
    const log: CommandLogEntry[] = [];
    const pending = run({ commands: [
      { name: 'history.undo', args: {} },
    ] }, applier, log);

    await expect(pending).resolves.toMatchObject({
      ok: false, revision: 'r0',
      error: {
        code: 'APPLY_FAILED', retryable: false,
        message: expect.stringContaining('undo refused'),
      },
      warnings: [],
    });
    const result = await pending;

    expect(applier.current.toOutput()).toEqual(doc);
    if (result.ok) {
      throw new Error('Expected undo to return a structured failure.');
    }
    expect(log).toEqual([{
      batch: 1, index: 0, name: 'history.undo', args: {},
      error: result.error, actorId: 'agent-1',
    }]);
    expect(applier.applied).toBe(0);
    expect(undo).toHaveBeenCalledOnce();
  });

  it('logs only the failure when redo succeeds but its revision readback throws', async () => {
    const afterHistory: OutputData = {
      blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'Redo' }] } }],
    };
    const applier = memoryApplier();
    const history = { completed: false };
    const redo = vi.fn(() => {
      applier.current = DocSnapshot.fromOutput(afterHistory);
      history.completed = true;

      return Promise.resolve();
    });

    applier.redo = redo;
    applier.revision = () => {
      if (history.completed) {
        throw new Error('history revision unavailable');
      }

      return 'r0';
    };
    const log: CommandLogEntry[] = [];
    const outcome: unknown = await run({ commands: [
      { name: 'history.redo', args: {} },
    ] }, applier, log).catch((error: unknown) => error);

    expect(log[0]).toMatchObject({
      batch: 1, index: 0, name: 'history.redo', args: {}, actorId: 'agent-1',
      error: {
        code: 'APPLY_FAILED', retryable: false,
        message: expect.stringContaining('history revision unavailable'),
      },
    });
    expect(log).toHaveLength(1);
    expect(log[0]).not.toHaveProperty('result');
    expect(outcome).toMatchObject({
      ok: false,
      error: {
        code: 'APPLY_FAILED', retryable: false,
        message: expect.stringContaining('history revision unavailable'),
      },
      warnings: [],
    });
    expect(outcome).not.toHaveProperty('revision');
    expect(applier.current.toOutput()).toEqual(afterHistory);
    expect(applier.applied).toBe(0);
    expect(redo).toHaveBeenCalledOnce();
  });
});
