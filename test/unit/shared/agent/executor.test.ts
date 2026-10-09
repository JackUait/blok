// @vitest-environment node
// Install at test/unit/shared/agent/executor.test.ts; ./fixtures is the delivered fixture.
// Dependency: src/shared/agent/executor.ts is absent. Task15 validation is source-held.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runBatch } from '../../../../src/shared/agent/executor';
import { failure } from '../../../../src/shared/agent/errors';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';

import type { AgentApplier, BatchInput } from '../../../../src/shared/agent/executor';
import type { AgentPorts, PlannerCommand, PlannerContext, Plan } from '../../../../src/shared/agent/types';
import type { AgentActor, AgentResult, CommandLogEntry, OutputData } from '../../../../types';
import type { ToolActionImpl } from '../../../../types/tools/tool-description';

import { coreCommandMap, plannerContext, stubPorts, TOOLS, tool } from './fixtures';

const doc: OutputData = {
  blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] } }],
};
const recordDoc: OutputData = {
  blocks: [{ id: 'rec', type: 'record', data: { count: 1 } }],
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
  plans: Plan[];
  events: string[];
}

const memoryApplier = (
  over: Partial<AgentApplier> = {},
  initial: OutputData = doc
): MemoryApplier => {
  const state: MemoryApplier = {
    current: DocSnapshot.fromOutput(initial),
    version: 'r0',
    applied: 0,
    plans: [],
    events: [],
    runtime: 'node',
    isReadOnly: () => false,
    snapshot: () => {
      state.events.push('snapshot');

      return state.current;
    },
    revision: () => state.version,
    apply: (plan, draft) => {
      state.events.push('apply');
      state.plans.push(plan);
      state.current = draft;
      state.applied++;
      state.version = `r${state.applied}`;

      return Promise.resolve();
    },
    ...over,
  };

  return state;
};

const context = (over: Partial<PlannerContext> = {}): Omit<PlannerContext, 'prepared'> => {
  const { prepared: _prepared, ...ctx } = plannerContext(over);

  return ctx;
};

const run = (
  batch: unknown,
  applier = memoryApplier(),
  extra: Partial<Omit<BatchInput, 'batch' | 'applier'>> = {}
): Promise<AgentResult> => runBatch({
  batch, applier, ctx: context(), actor, log: [], batchNo: 1, now: () => 7, ...extra,
});

const preparedInsertContext = (ports: Partial<AgentPorts> = {}): Omit<PlannerContext, 'prepared'> => {
  const tools = new Map(TOOLS);

  tools.set('record', tool('record', { data: recordSchema, insertRequires: ['host'] }));

  return context({ tools, ports: stubPorts(ports) });
};

const actionContext = (
  impl: ToolActionImpl,
  over: Partial<PlannerCommand> = {}
): Omit<PlannerContext, 'prepared'> => {
  const tools = new Map(TOOLS);
  const commands = coreCommandMap();

  tools.set('record', tool('record', { data: recordSchema }, { actions: { change: impl } }));
  commands.set('record.change', {
    name: 'record.change',
    args: { type: 'object' },
    readOnly: false,
    available: true,
    source: { tool: 'record', target: 'create' },
    ...over,
  });

  return context({ tools, commands });
};

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
    throw new Error('The batch finished before reaching the fixture boundary.');
  })]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

describe('runBatch contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('commits once and reports refs, changed IDs, attribution and post-batch read revisions', async () => {
    const applier = memoryApplier();
    const result = await run({ commands: [
      { name: 'doc.read', args: {} },
      { name: 'block.insert', args: { id: 'new', type: 'paragraph', data: { text: 'x' } }, ref: 'a' },
      { name: 'doc.read', args: {} },
    ] }, applier);

    expect(result).toMatchObject({
      ok: true, revision: 'r1', refs: { a: 'new' },
      changed: { created: ['new'], updated: [], moved: [], removed: [] },
      results: [
        { revision: 'r1', blocks: [expect.objectContaining({ id: 'p' })] },
        { id: 'new' },
        { revision: 'r1', blocks: [
          expect.objectContaining({ id: 'p' }), expect.objectContaining({ id: 'new' }),
        ] },
      ],
    });
    expect(applier.applied).toBe(1);
    expect(applier.plans).toHaveLength(1);
    expect(applier.current.get('new')?.rest).toMatchObject({ lastEditedBy: 'agent-1', lastEditedAt: 7 });
  });

  it('uses final generated IDs and reports a successful warning only once', async () => {
    const applier = memoryApplier();
    const result = await run({ commands: [
      { name: 'block.insert', args: { type: 'paragraph', data: { text: '**literal**' } }, ref: 'a' },
    ] }, applier);

    expect(result).toMatchObject({ ok: true, warnings: [
      { code: 'LOOKS_LIKE_MARKDOWN', commandIndex: 0, field: 'text' },
    ] });
    if (!result.ok) {
      throw new Error('Expected a successful insert.');
    }
    const id = result.refs.a;

    if (id === undefined) {
      throw new Error('The insert returned no ref.');
    }
    expect(result.warnings[0]?.blockId).toBe(id);
    expect(result.changed.created).toEqual([id]);
    expect(applier.current.ids()).toEqual(['p', id]);
  });

  it('returns the final text range with the commit result', async () => {
    const result = await run({ commands: [
      { name: 'text.insert', args: { id: 'p', at: 1, text: 'x' } },
    ] });

    expect(result).toMatchObject({
      ok: true, revision: 'r1',
      lastRange: { blockId: 'p', field: 'text', start: 1, end: 2 },
      changed: { updated: ['p'] },
    });
  });

  it('does not apply a read-only plan or change its revision', async () => {
    const applier = memoryApplier();
    const result = await run({ commands: [{ name: 'doc.read', args: {} }] }, applier);

    expect(result).toMatchObject({
      ok: true, revision: 'r0', refs: {},
      changed: { created: [], updated: [], moved: [], removed: [] },
      results: [{ revision: 'r0' }],
    });
    expect(applier.applied).toBe(0);
    expect(applier.plans).toEqual([]);
    expect(applier.current.toOutput()).toEqual(doc);
  });

  it('retains earlier warnings when the third command fails in pre-plan and writes nothing', async () => {
    const applier = memoryApplier();
    const before = applier.current.toOutput();
    const result = await run({ commands: [
      { name: 'block.insert', args: { type: 'paragraph', data: { text: '**literal**' } } },
      { name: 'block.insert', args: { type: 'paragraph' } },
      { name: 'block.delete', args: { id: 'missing' } },
    ] }, applier);

    expect(result).toMatchObject({
      ok: false, revision: 'r0', error: { code: 'BLOCK_NOT_FOUND', commandIndex: 2 },
      warnings: [{ code: 'LOOKS_LIKE_MARKDOWN', commandIndex: 0 }],
    });
    expect(applier.current.toOutput()).toEqual(before);
    expect(applier.applied).toBe(0);
  });

  it('retains pre-plan warnings when asynchronous preparation fails', async () => {
    let converted = 0;
    const applier = memoryApplier();
    const ctx = context({ ports: stubPorts({
      markdownToBlocks: () => {
        converted++;

        return Promise.reject(new Error('converter failed'));
      },
    }) });
    const result = await run({ commands: [
      { name: 'block.insert', args: { type: 'paragraph', data: { text: '**literal**' } } },
      { name: 'markdown.insert', args: { markdown: '# heading' } },
    ] }, applier, { ctx });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'TOOL_ACTION_FAILED', commandIndex: 1, retryable: false },
      warnings: [{ code: 'LOOKS_LIKE_MARKDOWN', commandIndex: 0 }],
    });
    expect(converted).toBe(1);
    expect(applier.applied).toBe(0);
    expect(applier.current.toOutput()).toEqual(doc);
  });

  it('rejects an invalid envelope before snapshots, preparation or apply', async () => {
    let converted = 0;
    const applier = memoryApplier();
    const ctx = context({ ports: stubPorts({
      markdownToBlocks: () => {
        converted++;

        return Promise.resolve({ blocks: [], warnings: [] });
      },
    }) });
    const result = await run({ commands: [
      { name: 'markdown.insert', args: { markdown: 1 } },
    ] }, applier, { ctx });

    expect(result).toMatchObject({ ok: false, error: {
      code: 'INVALID_ARGS', commandIndex: 0, path: '/commands/0/args/markdown',
    } });
    expect(converted).toBe(0);
    expect(applier.events).toEqual([]);
  });

  it('reports an unknown command without planning or preparation', async () => {
    const applier = memoryApplier();
    const result = await run({ commands: [{ name: 'record.hidden', args: {} }] }, applier);

    expect(result).toMatchObject({ ok: false, error: { code: 'UNKNOWN_COMMAND', commandIndex: 0 } });
    expect(applier.events).toEqual([]);
  });

  it('honors unavailable contract entries before their handler can prepare', async () => {
    let prepared = 0;
    const ctx = actionContext({
      prepare: () => {
        prepared++;

        return Promise.resolve({});
      },
      run: () => ({}),
    }, { source: { tool: 'record', target: 'block' }, available: false, unavailableReason: 'service', requires: ['host'] });
    const applier = memoryApplier({}, recordDoc);
    const result = await run({ commands: [{ name: 'record.change', args: { id: 'rec' } }] }, applier, { ctx });

    expect(result).toMatchObject({ ok: false, error: {
      code: 'COMMAND_UNAVAILABLE', commandIndex: 0,
      details: { reason: 'service', requires: ['host'] },
    } });
    expect(prepared).toBe(0);
    expect(applier.events).toEqual([]);
  });

  it('refuses writes in a read-only document before planning or host work', async () => {
    let prepared = 0;
    const applier = memoryApplier({
      isReadOnly: () => true,
      prepareInsert: () => {
        prepared++;

        return Promise.resolve({ count: 1 });
      },
    });
    const result = await run({ commands: [
      { name: 'block.insert', args: { type: 'record' } },
    ] }, applier, { ctx: preparedInsertContext() });

    expect(result).toMatchObject({ ok: false, error: { code: 'READ_ONLY', retryable: false } });
    expect(prepared).toBe(0);
    expect(applier.events).toEqual([]);
  });

  it('still reads a read-only document', async () => {
    const applier = memoryApplier({ isReadOnly: () => true });
    const result = await run({ commands: [{ name: 'doc.read', args: {} }] }, applier);

    expect(result).toMatchObject({ ok: true, revision: 'r0', results: [{ revision: 'r0' }] });
    expect(applier.applied).toBe(0);
  });

  it('requires a host-effect action to be alone before invoking prepare', async () => {
    let prepared = 0;
    const ctx = actionContext({
      prepare: () => {
        prepared++;

        return Promise.resolve({ hostId: 'outside' });
      },
      run: () => ({}),
    }, { source: { tool: 'record', target: 'block' }, effects: 'host' });
    const applier = memoryApplier({}, recordDoc);
    const result = await run({ commands: [
      { name: 'record.change', args: { id: 'rec' } }, { name: 'doc.read', args: {} },
    ] }, applier, { ctx });

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_ARGS', commandIndex: 0 } });
    expect(prepared).toBe(0);
    expect(applier.events).toEqual([]);
  });

  it('rejects an initial stale revision before a host-effect prepare', async () => {
    let prepared = 0;
    const ctx = actionContext({
      prepare: () => {
        prepared++;

        return Promise.resolve({ hostId: 'outside' });
      },
      run: () => ({}),
    }, { source: { tool: 'record', target: 'block' }, effects: 'host' });
    const applier = memoryApplier({}, recordDoc);
    const result = await run({
      commands: [{ name: 'record.change', args: { id: 'rec' } }], expectRevision: 'old',
    }, applier, { ctx });

    expect(result).toMatchObject({ ok: false, revision: 'r0', error: { code: 'STALE', retryable: true } });
    expect(prepared).toBe(0);
    expect(applier.applied).toBe(0);
    if (result.ok) {
      throw new Error('Expected STALE.');
    }
    expect(result.error.details?.orphaned).toBeUndefined();
  });

  it('rejects an initial stale revision before prepareInsert', async () => {
    let prepared = 0;
    const applier = memoryApplier({
      prepareInsert: () => {
        prepared++;

        return Promise.resolve({ count: 1 });
      },
    });
    const result = await run({
      commands: [{ name: 'block.insert', args: { type: 'record' } }], expectRevision: 'old',
    }, applier, { ctx: preparedInsertContext() });

    expect(result).toMatchObject({ ok: false, error: { code: 'STALE', retryable: true } });
    expect(prepared).toBe(0);
    expect(applier.applied).toBe(0);
  });

  it('rejects an initial stale revision before Markdown conversion', async () => {
    let converted = 0;
    const ctx = context({ ports: stubPorts({
      markdownToBlocks: () => {
        converted++;

        return Promise.resolve({ blocks: [], warnings: [] });
      },
    }) });
    const result = await run({
      commands: [{ name: 'markdown.insert', args: { markdown: '# heading' } }], expectRevision: 'old',
    }, memoryApplier(), { ctx });

    expect(result).toMatchObject({ ok: false, error: { code: 'STALE', retryable: true } });
    expect(converted).toBe(0);
  });

  it('includes current context in a stale failure for a named block', async () => {
    const result = await run({
      commands: [{ name: 'block.delete', args: { id: 'p' } }], expectRevision: 'old',
    });

    expect(result).toMatchObject({ ok: false, revision: 'r0', error: { code: 'STALE' } });
    if (result.ok) {
      throw new Error('Expected STALE.');
    }
    expect(result.error.details?.current).toEqual([{ id: 'p', type: 'paragraph', text: 'P' }]);
  });

  it('returns empty current context for a stale batch naming no blocks', async () => {
    const applier = memoryApplier();
    const result = await run({
      commands: [{ name: 'doc.read', args: {} }], expectRevision: 'old',
    }, applier);

    if (result.ok) {
      throw new Error('Expected STALE.');
    }
    expect(result.error.details?.current).toEqual([]);
    expect(result).toMatchObject({ ok: false, revision: 'r0', error: { code: 'STALE', retryable: true } });
    expect(applier.applied).toBe(0);
  });

  it('checks the fresh revision again after prep and reports completed host work', async () => {
    const applier = memoryApplier();
    let prepared = 0;
    const peerDoc: OutputData = {
      blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'Peer after settlement' }] } }],
    };

    applier.prepareInsert = () => {
      prepared++;
      applier.current = DocSnapshot.fromOutput({
        blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'Peer during preparation' }] } }],
      });
      applier.version = 'peer1';

      return Promise.resolve({ count: 1 });
    };
    applier.settle = () => {
      applier.current = DocSnapshot.fromOutput(peerDoc);
      applier.version = 'peer2';

      return Promise.resolve();
    };
    const result = await run({
      commands: [{ name: 'block.insert', args: { type: 'record', position: { after: 'p' } } }], expectRevision: 'r0',
    }, applier, { ctx: preparedInsertContext() });

    if (result.ok) {
      throw new Error('Expected an orphaned STALE failure.');
    }
    const cause = result.error.details?.cause;

    if (!isRecord(cause) || !isRecord(cause.details)) {
      throw new Error('Expected a cause carrying stale context.');
    }
    expect(cause.details.current).toEqual([{ id: 'p', type: 'paragraph', text: 'Peer after settlement' }]);
    expect(result).toMatchObject({
      ok: false, revision: 'peer2', error: {
        code: 'ORPHANED_SIDE_EFFECT',
        details: {
          orphaned: [{ command: 'block.insert', type: 'record', prepared: { count: 1 } }],
          cause: { code: 'STALE', retryable: true },
        },
      },
    });
    expect(prepared).toBe(1);
    expect(applier.applied).toBe(0);
    expect(applier.current.toOutput()).toEqual(peerDoc);
  });

  it('retains pre-plan warnings when pure prep is followed by a stale revision', async () => {
    const applier = memoryApplier();
    const ctx = context({ ports: stubPorts({
      markdownToBlocks: () => {
        applier.version = 'peer1';

        return Promise.resolve({ blocks: [], warnings: [] });
      },
    }) });
    const result = await run({ expectRevision: 'r0', commands: [
      { name: 'block.insert', args: { type: 'paragraph', data: { text: '**literal**' } } },
      { name: 'markdown.insert', args: { markdown: '# heading' } },
    ] }, applier, { ctx });

    expect(result).toMatchObject({
      ok: false, revision: 'peer1', error: { code: 'STALE' },
      warnings: [{ code: 'LOOKS_LIKE_MARKDOWN', commandIndex: 0 }],
    });
    if (result.ok) {
      throw new Error('Expected STALE.');
    }
    expect(result.error.details?.orphaned).toBeUndefined();
    expect(applier.applied).toBe(0);
  });

  it('keeps concrete warnings on a fresh-plan structural failure without duplicating pre-plan warnings', async () => {
    const applier = memoryApplier();
    let generatedId = 'pre-plan-warning';
    const ctx = context({ ports: stubPorts({
      newId: () => generatedId,
      markdownToBlocks: () => {
        generatedId = 'concrete-warning';
        applier.current = DocSnapshot.fromOutput({ blocks: [] });
        applier.version = 'peer1';

        return Promise.resolve({ blocks: [], warnings: [] });
      },
    }) });
    const result = await run({ commands: [
      { name: 'block.insert', args: { type: 'paragraph', data: { text: '**literal**' } } },
      { name: 'markdown.insert', args: { markdown: '' } },
      { name: 'block.delete', args: { id: 'p' } },
    ] }, applier, { ctx });

    expect(result.warnings[0]?.blockId).toBe('concrete-warning');
    expect(result.warnings).toHaveLength(1);
    expect(result).toMatchObject({
      ok: false, revision: 'peer1', error: { code: 'BLOCK_NOT_FOUND', commandIndex: 2 },
      warnings: [{ code: 'LOOKS_LIKE_MARKDOWN', commandIndex: 0 }],
    });
    expect(applier.applied).toBe(0);
    expect(applier.current.toOutput()).toEqual({ blocks: [] });
  });

  it('awaits settlement and replans from the fresh document without overwriting peer content', async () => {
    const entered = gate();
    const release = gate();
    const applier = memoryApplier();
    const peerDoc: OutputData = { blocks: [
      { id: 'p', type: 'paragraph', data: { text: [{ text: 'Peer' }] } },
      { id: 'peer', type: 'paragraph', data: { text: [{ text: 'Kept' }] } },
    ] };

    applier.settle = async () => {
      entered.release();
      await release.promise;
      applier.current = DocSnapshot.fromOutput(peerDoc);
      applier.version = 'peer1';
    };
    const pending = run({ commands: [
      { name: 'block.insert', args: { id: 'new', type: 'paragraph', data: { text: 'Agent' } } },
    ] }, applier);

    await waitForEntry(entered.promise, pending);
    const beforeApply = applier.applied;

    release.release();
    const result = await pending;

    expect(applier.current.get('p')?.data.text).toEqual([{ text: 'Peer' }]);
    expect(applier.current.get('peer')?.data.text).toEqual([{ text: 'Kept' }]);
    expect(applier.current.childrenOf(null)).toEqual(['p', 'peer', 'new']);
    expect(beforeApply).toBe(0);
    expect(result).toMatchObject({ ok: true, changed: { created: ['new'] } });
  });

  const runtimes: AgentApplier['runtime'][] = ['editor', 'node', 'jint', 'node-live'];

  it.each(runtimes)('starts apply without yielding after the fresh snapshot in %s', async runtime => {
    const applier = memoryApplier({ runtime });
    const events: string[] = [];
    let snapshots = 0;
    let applySnapshot = 0;

    applier.snapshot = () => {
      const index = ++snapshots;

      events.push(`snapshot:${index}`);
      queueMicrotask(() => events.push(`yield:${index}`));

      return applier.current;
    };
    applier.apply = (_plan, draft) => {
      applySnapshot = snapshots;
      events.push(`apply:${applySnapshot}`);
      applier.current = draft;
      applier.applied++;

      return Promise.resolve();
    };
    const result = await run({ commands: [{ name: 'block.delete', args: { id: 'p' } }] }, applier);

    expect(events.indexOf(`apply:${applySnapshot}`)).toBeLessThan(events.indexOf(`yield:${applySnapshot}`));
    expect(applySnapshot).toBeGreaterThanOrEqual(2);
    expect(applier.applied).toBe(1);
    expect(result).toMatchObject({ ok: true });
  });

  it('waits for asynchronous apply before reading back revision and appending success logs', async () => {
    const entered = gate();
    const release = gate();
    const log: CommandLogEntry[] = [];
    const applier = memoryApplier();

    applier.apply = async (_plan, draft) => {
      entered.release();
      await release.promise;
      applier.current = draft;
      applier.applied++;
      applier.version = 'committed';
    };
    const pending = run({ commands: [
      { name: 'block.delete', args: { id: 'p' } },
    ] }, applier, { log });

    await waitForEntry(entered.promise, pending);
    const during = { applied: applier.applied, log: [...log] };

    release.release();
    const result = await pending;

    expect(result).toMatchObject({ ok: true, revision: 'committed' });
    expect(during).toEqual({ applied: 0, log: [] });
    expect(log).toEqual([expect.objectContaining({ result: { removedIds: ['p'], liftedIds: [] } })]);
  });

  it('cancels before checking even an invalid input and performs no work', async () => {
    const stopped = new AbortController();
    const applier = memoryApplier();

    stopped.abort();
    const result = await run(null, applier, { signal: stopped.signal });

    expect(result).toMatchObject({ ok: false, error: { code: 'CANCELLED', retryable: true } });
    expect(applier.events).toEqual([]);
    expect(applier.applied).toBe(0);
  });

  it('cancels after Markdown prep completes without applying', async () => {
    const stopped = new AbortController();
    let converted = 0;
    const applier = memoryApplier();
    const ctx = context({ ports: stubPorts({
      markdownToBlocks: () => {
        converted++;
        stopped.abort();

        return Promise.resolve({ blocks: [
          { type: 'paragraph', data: { text: [{ text: 'Converted' }] } },
        ], warnings: [] });
      },
    }) });
    const result = await run({ commands: [
      { name: 'markdown.insert', args: { markdown: 'Converted' } },
    ] }, applier, { ctx, signal: stopped.signal });

    expect(result).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(converted).toBe(1);
    expect(applier.applied).toBe(0);
    expect(applier.current.toOutput()).toEqual(doc);
  });

  it('carries completed host preparation on CANCELLED without wrapping it as orphan failure', async () => {
    const stopped = new AbortController();
    let ran = 0;
    const ctx = actionContext({
      prepare: () => {
        stopped.abort();

        return Promise.resolve({ hostId: 'outside' });
      },
      run: () => {
        ran++;

        return {};
      },
    }, { source: { tool: 'record', target: 'block' }, effects: 'host' });
    const applier = memoryApplier({}, recordDoc);
    const result = await run({ commands: [
      { name: 'record.change', args: { id: 'rec' } },
    ] }, applier, { ctx, signal: stopped.signal });

    expect(result).toMatchObject({ ok: false, error: {
      code: 'CANCELLED', retryable: true,
      details: { orphaned: [{ command: 'record.change', prepared: { hostId: 'outside' } }] },
    } });
    expect(ran).toBe(0);
    expect(applier.applied).toBe(0);
    if (result.ok) {
      throw new Error('Expected CANCELLED.');
    }
    expect(result.error.details?.cause).toBeUndefined();
  });

  it('reports prepareInsert work on cancellation after settlement and keeps warnings', async () => {
    const stopped = new AbortController();
    const applier = memoryApplier({
      prepareInsert: () => Promise.resolve({ count: 1 }),
      settle: () => {
        stopped.abort();

        return Promise.resolve();
      },
    });
    const result = await run({ commands: [
      { name: 'block.insert', args: { type: 'paragraph', data: { text: '**literal**' } } },
      { name: 'block.insert', args: { type: 'record' } },
    ] }, applier, { ctx: preparedInsertContext(), signal: stopped.signal });

    expect(result).toMatchObject({
      ok: false, error: {
        code: 'CANCELLED',
        details: { orphaned: [{ command: 'block.insert', type: 'record', prepared: { count: 1 } }] },
      },
      warnings: [{ code: 'LOOKS_LIKE_MARKDOWN', commandIndex: 0 }],
    });
    expect(applier.applied).toBe(0);
    expect(applier.current.toOutput()).toEqual(doc);
  });

  it('cancels right before apply when synchronous final planning aborts the signal', async () => {
    const stopped = new AbortController();
    let sanitized = 0;
    const ctx = context({ ports: stubPorts({
      sanitizeBlockData: (_type, data) => {
        sanitized++;
        if (sanitized === 2) {
          stopped.abort();
        }

        return data;
      },
    }) });
    const applier = memoryApplier();
    const result = await run({ commands: [
      { name: 'block.insert', args: { type: 'paragraph' } },
    ] }, applier, { ctx, signal: stopped.signal });

    expect(result).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(sanitized).toBe(2);
    expect(applier.applied).toBe(0);
    expect(applier.current.toOutput()).toEqual(doc);
  });

  it('does not cancel an apply already in progress', async () => {
    const stopped = new AbortController();
    const entered = gate();
    const release = gate();
    const applier = memoryApplier();

    applier.apply = async (_plan, draft) => {
      stopped.abort();
      entered.release();
      await release.promise;
      applier.current = draft;
      applier.applied++;
      applier.version = 'committed';
    };
    const pending = run({ commands: [
      { name: 'block.delete', args: { id: 'p' } },
    ] }, applier, { signal: stopped.signal });

    await waitForEntry(entered.promise, pending);
    release.release();
    const result = await pending;

    expect(result).toMatchObject({ ok: true, revision: 'committed', changed: { removed: ['p'] } });
    expect(applier.applied).toBe(1);
    expect(applier.current.has('p')).toBe(false);
  });

  it('rejects structural errors in a prepared batch before any host call', async () => {
    let prepared = 0;
    const applier = memoryApplier({
      prepareInsert: () => {
        prepared++;

        return Promise.resolve({ count: 1 });
      },
    });
    const result = await run({ commands: [
      { name: 'block.insert', args: { type: 'record' }, ref: 'a' },
      { name: 'block.move', args: { id: '$a', parentId: 'missing', position: 'end' } },
    ] }, applier, { ctx: preparedInsertContext() });

    expect(result).toMatchObject({ ok: false, error: { code: 'BLOCK_NOT_FOUND', commandIndex: 1 } });
    expect(prepared).toBe(0);
    expect(applier.applied).toBe(0);
  });

  it('merges prepared insert data and resolves a later ref against the real planned block', async () => {
    const calls: string[] = [];
    const applier = memoryApplier({
      prepareInsert: type => {
        calls.push(type);

        return Promise.resolve({ count: 2 });
      },
    });
    const result = await run({ commands: [
      { name: 'block.insert', args: { id: 'new', type: 'record' }, ref: 'a' },
      { name: 'doc.read', args: { ids: ['$a'], detail: 'full' } },
      { name: 'block.update', args: { id: '$a', data: { count: 3 } } },
      { name: 'doc.read', args: { ids: ['$a'], detail: 'full' } },
    ] }, applier, { ctx: preparedInsertContext() });

    expect(result).toMatchObject({
      ok: true, refs: { a: 'new' }, changed: { created: ['new'], updated: [] },
      results: [
        { id: 'new' },
        { revision: 'r1', blocks: [expect.objectContaining({ id: 'new', data: { count: 2 } })] },
        { id: 'new' },
        { revision: 'r1', blocks: [expect.objectContaining({ id: 'new', data: { count: 3 } })] },
      ],
    });
    expect(applier.current.get('new')?.data).toEqual({ count: 3 });
    expect(calls).toEqual(['record']);
    expect(applier.applied).toBe(1);
  });

  it('passes Markdown conversion warnings through the real plan exactly once', async () => {
    const received: string[] = [];
    const ctx = context({ ports: stubPorts({
      markdownToBlocks: markdown => {
        received.push(markdown);

        return Promise.resolve({
          blocks: [{ id: 'converted', type: 'paragraph', data: { text: [{ text: 'Converted' }] } }],
          warnings: [{ code: 'MARKDOWN_DEGRADED', message: 'Some markup was dropped.' }],
        });
      },
    }) });
    const applier = memoryApplier();
    const result = await run({ commands: [
      { name: 'markdown.insert', args: { markdown: 'Converted' } },
    ] }, applier, { ctx });

    expect(result).toMatchObject({ ok: true, warnings: [
      { code: 'MARKDOWN_DEGRADED', commandIndex: 0 },
    ] });
    expect(received).toEqual(['Converted']);
    expect(applier.applied).toBe(1);
    expect(applier.current.toOutput().blocks.map(block => block.data.text)).toEqual([
      [{ text: 'P' }], [{ text: 'Converted' }],
    ]);
  });

  it('passes services and args to prepare and uses prepared output in skeleton and concrete create runs', async () => {
    const calls: unknown[] = [];
    const service = { key: 'service' };
    const prepared = { count: 2 };
    const ctx = actionContext({
      prepare: (prepContext, args) => {
        calls.push({ services: prepContext.services, args });

        return Promise.resolve(prepared);
      },
      run: (recording, _args, value) => {
        calls.push({ prepared: value });
        let count = 0;

        if (value !== undefined) {
          if (!isRecord(value) || typeof value.count !== 'number') {
            return recording.fail('PRECONDITION_FAILED', 'Prepared count is missing.');
          }
          count = value.count;
        }
        const id = recording.insert({ type: recording.tool, data: { count } });

        return { id, childIds: [] };
      },
    });
    const applier = memoryApplier();
    const result = await run({ commands: [
      { name: 'record.change', args: { requested: 'original' } },
    ] }, applier, { ctx: { ...ctx, services: { host: service } } });

    expect(result).toMatchObject({ ok: true });
    expect(calls).toEqual([
      { prepared: undefined },
      { services: { host: service }, args: { requested: 'original' } },
      { prepared },
    ]);
    expect(applier.current.toOutput().blocks[1]?.data).toEqual({ count: 2 });
    expect(applier.applied).toBe(1);
  });

  it('awaits preparations in command order before starting the next preparation', async () => {
    const entered = gate();
    const release = gate();
    const events: string[] = [];
    const ctx = actionContext({
      prepare: async (_ctx, args) => {
        if (!isRecord(args) || typeof args.label !== 'string') {
          throw new Error('Expected a fixture label.');
        }
        events.push(`prepare:${args.label}`);
        if (args.label === 'first') {
          entered.release();
          await release.promise;
        }
        events.push(`prepared:${args.label}`);

        return args.label;
      },
      run: (_ctx, _args, value) => {
        events.push(`run:${String(value)}`);

        return {};
      },
    }, { source: { tool: 'record', target: 'block' } });
    const applier = memoryApplier({}, recordDoc);
    const pending = run({ commands: [
      { name: 'record.change', args: { id: 'rec', label: 'first' } },
      { name: 'record.change', args: { id: 'rec', label: 'second' } },
    ] }, applier, { ctx });

    await waitForEntry(entered.promise, pending);
    const held = [...events];

    release.release();
    const result = await pending;

    expect(events).toEqual([
      'prepare:first', 'prepared:first', 'prepare:second', 'prepared:second', 'run:first', 'run:second',
    ]);
    expect(held).toEqual(['prepare:first']);
    expect(result).toMatchObject({ ok: true });
    expect(applier.applied).toBe(0);
  });

  it('rejects a thenable action run without awaiting it or applying its recorded edits', async () => {
    const ctx = actionContext({
      prepare: () => Promise.resolve({}),
      run: recording => {
        recording.insert({ type: recording.tool, data: { count: 1 } });

        return Promise.resolve({});
      },
    });
    const applier = memoryApplier();
    const result = await run({ commands: [
      { name: 'record.change', args: {} },
    ] }, applier, { ctx });

    expect(result).toMatchObject({ ok: false, error: {
      code: 'PRECONDITION_FAILED', commandIndex: 0,
    } });
    expect(applier.applied).toBe(0);
    expect(applier.current.toOutput()).toEqual(doc);
  });

  it('reports a missing prepareInsert provider as unavailable service', async () => {
    const applier = memoryApplier();
    const result = await run({ commands: [
      { name: 'block.insert', args: { type: 'record' } },
    ] }, applier, { ctx: preparedInsertContext() });

    expect(result).toMatchObject({ ok: false, error: {
      code: 'COMMAND_UNAVAILABLE', commandIndex: 0, details: { reason: 'service', requires: ['host'] },
    } });
    expect(applier.applied).toBe(0);
    expect(applier.current.toOutput()).toEqual(doc);
  });

  it('maps an untyped action prepare rejection to TOOL_ACTION_FAILED at its command', async () => {
    let ran = 0;
    const ctx = actionContext({
      prepare: () => Promise.reject(new Error('host unavailable')),
      run: () => {
        ran++;

        return {};
      },
    }, { source: { tool: 'record', target: 'block' } });
    const applier = memoryApplier({}, recordDoc);
    const result = await run({ commands: [{ name: 'record.change', args: { id: 'rec' } }] }, applier, { ctx });

    expect(result).toMatchObject({ ok: false, error: {
      code: 'TOOL_ACTION_FAILED', commandIndex: 0, retryable: false,
    } });
    expect(ran).toBe(0);
    expect(applier.applied).toBe(0);
  });

  it('preserves typed prepare failures and wraps earlier completed host work with its cause', async () => {
    const cause = failure('PRECONDITION_FAILED', 'Conversion is not allowed.', { commandIndex: 1 }).error;
    const applier = memoryApplier({ prepareInsert: () => Promise.resolve({ count: 1 }) });
    const result = await run({ commands: [
      { name: 'block.insert', args: { type: 'record' } },
      { name: 'markdown.insert', args: { markdown: 'bad' } },
    ] }, applier, { ctx: preparedInsertContext({
      markdownToBlocks: () => Promise.reject(failure('PRECONDITION_FAILED', cause.message, { commandIndex: 1 })),
    }) });

    expect(result).toMatchObject({ ok: false, error: {
      code: 'ORPHANED_SIDE_EFFECT', commandIndex: 1,
      details: {
        orphaned: [{ command: 'block.insert', type: 'record', prepared: { count: 1 } }],
        cause,
      },
    } });
    expect(applier.applied).toBe(0);
    expect(applier.current.toOutput()).toEqual(doc);
  });

  it('lists multiple completed prepareInsert outputs in command order after a later failure', async () => {
    let count = 0;
    const applier = memoryApplier({
      prepareInsert: () => Promise.resolve({ count: ++count }),
    });
    const result = await run({ commands: [
      { name: 'block.insert', args: { type: 'record' } },
      { name: 'block.insert', args: { type: 'record' } },
      { name: 'markdown.insert', args: { markdown: 'bad' } },
    ] }, applier, { ctx: preparedInsertContext({
      markdownToBlocks: () => Promise.reject(new Error('converter failed')),
    }) });

    expect(result).toMatchObject({ ok: false, error: {
      code: 'ORPHANED_SIDE_EFFECT', commandIndex: 2,
      details: {
        orphaned: [
          { command: 'block.insert', type: 'record', prepared: { count: 1 } },
          { command: 'block.insert', type: 'record', prepared: { count: 2 } },
        ],
        cause: { code: 'TOOL_ACTION_FAILED', commandIndex: 2 },
      },
    } });
    expect(count).toBe(2);
    expect(applier.applied).toBe(0);
    expect(applier.current.toOutput()).toEqual(doc);
  });

  it('reports a completed host action when its synchronous run fails', async () => {
    const ctx = actionContext({
      prepare: () => Promise.resolve({ hostId: 'outside' }),
      run: recording => recording.fail('PRECONDITION_FAILED', 'The host result cannot be used.'),
    }, { source: { tool: 'record', target: 'block' }, effects: 'host' });
    const applier = memoryApplier({}, recordDoc);
    const result = await run({ commands: [{ name: 'record.change', args: { id: 'rec' } }] }, applier, { ctx });

    expect(result).toMatchObject({ ok: false, error: {
      code: 'ORPHANED_SIDE_EFFECT', commandIndex: 0, retryable: false,
      details: {
        orphaned: [{ command: 'record.change', prepared: { hostId: 'outside' } }],
        cause: { code: 'PRECONDITION_FAILED', commandIndex: 0 },
      },
    } });
    expect(applier.applied).toBe(0);
    expect(applier.current.toOutput()).toEqual(recordDoc);
  });

  it('returns a successful host-only action result without applying an empty plan', async () => {
    let prepared = 0;
    const ctx = actionContext({
      prepare: () => {
        prepared++;

        return Promise.resolve({ hostId: 'outside' });
      },
      run: (_ctx, _args, value) => ({ acknowledged: value }),
    }, { source: { tool: 'record', target: 'block' }, effects: 'host' });
    const applier = memoryApplier({}, recordDoc);
    const result = await run({ commands: [{ name: 'record.change', args: { id: 'rec' } }] }, applier, { ctx });

    expect(result).toMatchObject({
      ok: true, revision: 'r0', warnings: [],
      results: [{ acknowledged: { hostId: 'outside' } }],
    });
    expect(prepared).toBe(1);
    expect(applier.applied).toBe(0);
  });

  it('refuses invalid real prepared data before apply and reports the host output', async () => {
    // Dependency: Task15 must validate the concrete plan after PREPARE_PENDING is gone.
    const applier = memoryApplier({ prepareInsert: () => Promise.resolve({ count: 'invalid' }) });
    const result = await run({ commands: [
      { name: 'block.insert', args: { id: 'new', type: 'record' } },
    ] }, applier, { ctx: preparedInsertContext() });

    expect(result).toMatchObject({ ok: false, error: {
      code: 'ORPHANED_SIDE_EFFECT',
      details: {
        orphaned: [{ command: 'block.insert', type: 'record', prepared: { count: 'invalid' } }],
        cause: { code: 'DATA_REJECTED', commandIndex: 0, details: { blockId: 'new' } },
      },
    } });
    expect(applier.applied).toBe(0);
    expect(applier.current.toOutput()).toEqual(doc);
  });

  it('defers the whole pending validation pass then reports an earlier invalid write after host work', async () => {
    // Dependency: Task15 P1/P3 validates earlier writes only once preparation is concrete.
    let prepared = 0;
    const tools = new Map(TOOLS);

    tools.set('record', tool('record', { data: recordSchema }));
    tools.set('host_record', tool('host_record', { data: recordSchema, insertRequires: ['host'] }));
    const applier = memoryApplier({
      prepareInsert: () => {
        prepared++;

        return Promise.resolve({ count: 2 });
      },
    }, { blocks: [{ id: 'rec', type: 'record', data: { count: 1 } }] });
    const result = await run({ commands: [
      { name: 'block.update', args: { id: 'rec', data: { count: 'invalid' } } },
      { name: 'block.insert', args: { type: 'host_record' } },
    ] }, applier, { ctx: context({ tools }) });

    expect(result).toMatchObject({ ok: false, error: {
      code: 'ORPHANED_SIDE_EFFECT',
      details: {
        orphaned: [{ command: 'block.insert', type: 'host_record', prepared: { count: 2 } }],
        cause: { code: 'DATA_REJECTED', commandIndex: 0, details: { blockId: 'rec' } },
      },
    } });
    expect(prepared).toBe(1);
    expect(applier.applied).toBe(0);
    expect(applier.current.get('rec')?.data).toEqual({ count: 1 });
  });

  it('rejects an invalid earlier concrete write despite its later repair and keeps prior warnings', async () => {
    // Dependency: Task15 P1 checks edit-time data, not only the final repaired draft.
    const tools = new Map(TOOLS);

    tools.set('record', tool('record', { data: recordSchema }));
    const applier = memoryApplier({}, { blocks: [
      { id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] } },
      { id: 'rec', type: 'record', data: { count: 1 } },
    ] });
    const before = applier.current.toOutput();
    const result = await run({ commands: [
      { name: 'block.update', args: { id: 'p', data: { text: '**literal**' } } },
      { name: 'block.update', args: { id: 'rec', data: { count: 'invalid' } } },
      { name: 'block.update', args: { id: 'rec', data: { count: 2 } } },
    ] }, applier, { ctx: context({ tools }) });

    expect(result).toMatchObject({
      ok: false, error: { code: 'DATA_REJECTED', commandIndex: 1, details: { blockId: 'rec' } },
      warnings: [{ code: 'LOOKS_LIKE_MARKDOWN', commandIndex: 0 }],
    });
    expect(applier.applied).toBe(0);
    expect(applier.current.toOutput()).toEqual(before);
  });

  it('keeps a prepared create ref usable by a later command under B03', async () => {
    // Dependency: C1 skeleton dispatch remains held for later producer integration.
    let prepared = 0;
    const runs: unknown[] = [];
    const ctx = actionContext({
      prepare: () => {
        prepared++;

        return Promise.resolve({ count: 7 });
      },
      run: (recording, _args, value) => {
        runs.push(value);
        let count = 0;

        if (value !== undefined) {
          if (!isRecord(value) || typeof value.count !== 'number') {
            return recording.fail('PRECONDITION_FAILED', 'Prepared count is missing.');
          }
          count = value.count;
        }
        const id = recording.insert({ type: recording.tool, data: { count } });

        return { id, childIds: [] };
      },
    });
    const applier = memoryApplier();
    const result = await run({ commands: [
      { name: 'record.change', args: {}, ref: 'a' },
      { name: 'doc.read', args: { ids: ['$a'], detail: 'full' } },
      { name: 'block.update', args: { id: '$a', data: { count: 2 } } },
    ] }, applier, { ctx });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) {
      throw new Error('Expected a prepared create ref.');
    }
    const id = result.refs.a;

    if (id === undefined) {
      throw new Error('The create action returned no ref.');
    }
    expect(result.results[1]).toMatchObject({
      revision: 'r1', blocks: [expect.objectContaining({ id, data: { count: 7 } })],
    });
    expect(runs).toEqual([undefined, { count: 7 }]);
    expect(applier.current.get(id)?.data).toEqual({ count: 2 });
    expect(result.changed).toEqual({ created: [id], updated: [], moved: [], removed: [] });
    expect(prepared).toBe(1);
    expect(applier.applied).toBe(1);
  });

  it('supports a concrete undefined preparation without treating it as an exclusive phase marker', async () => {
    const calls: string[] = [];
    const payloads: unknown[] = [];
    const ctx = actionContext({
      prepare: () => {
        calls.push('prepare');

        return Promise.resolve(undefined);
      },
      run: (recording, _args, value) => {
        calls.push('run');
        payloads.push(value);
        const id = recording.insert({ type: recording.tool, data: { count: 0 } });

        return { id, childIds: [] };
      },
    });
    const applier = memoryApplier();
    const result = await run({ commands: [
      { name: 'record.change', args: {}, ref: 'a' },
      { name: 'doc.read', args: { ids: ['$a'], detail: 'full' } },
      { name: 'block.update', args: { id: '$a', data: { count: 2 } } },
    ] }, applier, { ctx });

    if (!result.ok) {
      throw new Error('Expected a concrete undefined preparation to remain valid.');
    }
    const id = result.refs.a;

    if (id === undefined) {
      throw new Error('The create action returned no ref.');
    }
    expect(payloads).toEqual([undefined, undefined]);
    expect(result.results[1]).toMatchObject({
      revision: 'r1', blocks: [expect.objectContaining({ id, data: { count: 0 } })],
    });
    expect(calls).toEqual(['run', 'prepare', 'run']);
    expect(applier.current.get(id)?.data).toEqual({ count: 2 });
    expect(result.changed).toEqual({ created: [id], updated: [], moved: [], removed: [] });
    expect(applier.applied).toBe(1);
  });

  it('maps an untyped apply rejection to APPLY_FAILED and does not claim rollback', async () => {
    const applier = memoryApplier();

    applier.apply = (_plan, draft) => {
      applier.current = draft;
      applier.version = 'partly-applied';

      return Promise.reject(new Error('tool bug'));
    };
    const result = await run({ commands: [
      { name: 'block.delete', args: { id: 'p' } },
    ] }, applier);

    expect(result).toMatchObject({
      ok: false, revision: 'partly-applied',
      error: { code: 'APPLY_FAILED', retryable: false },
    });
    expect(applier.current.has('p')).toBe(false);
  });

  it('preserves an AgentFailure from apply including conflict details', async () => {
    const thrown = failure('CONFLICT', 'A peer changed this block.', {
      commandIndex: 0, path: '/commands/0/args/id', details: { id: 'p' },
    });
    const applier = memoryApplier({ apply: () => Promise.reject(thrown) });
    const result = await run({ commands: [{ name: 'block.delete', args: { id: 'p' } }] }, applier);

    expect(result).toMatchObject({ ok: false, error: thrown.error });
  });

  it('wraps an apply failure after completed host work and retains concrete warnings', async () => {
    const applier = memoryApplier({
      prepareInsert: () => Promise.resolve({ count: 1 }),
      apply: () => Promise.reject(new Error('apply failed')),
    });
    const result = await run({ commands: [
      { name: 'block.insert', args: { type: 'paragraph', data: { text: '**literal**' } } },
      { name: 'block.insert', args: { type: 'record' } },
    ] }, applier, { ctx: preparedInsertContext() });

    expect(result).toMatchObject({
      ok: false, error: {
        code: 'ORPHANED_SIDE_EFFECT',
        details: {
          orphaned: [{ command: 'block.insert', type: 'record', prepared: { count: 1 } }],
          cause: { code: 'APPLY_FAILED' },
        },
      },
      warnings: [{ code: 'LOOKS_LIKE_MARKDOWN', commandIndex: 0 }],
    });
  });

  it('logs every checked command once with successful results or the failing command error', async () => {
    const log: CommandLogEntry[] = [];

    await run({ commands: [
      { name: 'block.delete', args: { id: 'p' } },
    ] }, memoryApplier(), { log, batchNo: 3 });
    const failed = await run({ commands: [
      { name: 'doc.read', args: {} },
      { name: 'block.delete', args: { id: 'missing' } },
      { name: 'doc.read', args: {} },
    ] }, memoryApplier(), { log, batchNo: 4 });

    expect(log).toEqual([
      {
        batch: 3, index: 0, name: 'block.delete', args: { id: 'p' },
        result: { removedIds: ['p'], liftedIds: [] }, actorId: 'agent-1',
      },
      { batch: 4, index: 0, name: 'doc.read', args: {}, actorId: 'agent-1' },
      {
        batch: 4, index: 1, name: 'block.delete', args: { id: 'missing' },
        error: expect.objectContaining({ code: 'BLOCK_NOT_FOUND', commandIndex: 1 }), actorId: 'agent-1',
      },
      { batch: 4, index: 2, name: 'doc.read', args: {}, actorId: 'agent-1' },
    ]);
    if (failed.ok) {
      throw new Error('Expected a failed batch.');
    }
    expect(log[2]?.error).toEqual(failed.error);
  });

  it('logs the returned orphan failure rather than its unwrapped cause', async () => {
    const log: CommandLogEntry[] = [];
    const ctx = actionContext({
      prepare: () => Promise.resolve({ hostId: 'outside' }),
      run: recording => recording.fail('PRECONDITION_FAILED', 'Cannot use the host result.'),
    }, { source: { tool: 'record', target: 'block' }, effects: 'host' });
    const result = await run({ commands: [
      { name: 'record.change', args: { id: 'rec' } },
    ] }, memoryApplier({}, recordDoc), { ctx, log, batchNo: 8 });

    expect(log).toEqual([expect.objectContaining({
      batch: 8, index: 0, name: 'record.change', actorId: 'agent-1',
      error: expect.objectContaining({ code: 'ORPHANED_SIDE_EFFECT' }),
    })]);
    if (result.ok) {
      throw new Error('Expected an orphan failure.');
    }
    expect(log[0]?.error).toEqual(result.error);
  });

  it('routes undo once and reports its post-operation revision without planning or apply', async () => {
    let undoCalls = 0;
    const log: CommandLogEntry[] = [];
    const applier = memoryApplier();

    applier.undo = () => {
      undoCalls++;
      applier.version = 'undone';

      return Promise.resolve();
    };
    const result = await run({ commands: [
      { name: 'history.undo', args: {} },
    ] }, applier, { log });

    expect(result).toMatchObject({
      ok: true, revision: 'undone', results: [{}], refs: {},
      changed: { created: [], updated: [], moved: [], removed: [] }, warnings: [],
    });
    expect(undoCalls).toBe(1);
    expect(applier.events).toEqual([]);
    expect(log).toEqual([{
      batch: 1, index: 0, name: 'history.undo', args: {}, result: {}, actorId: 'agent-1',
    }]);
  });

  it('routes redo once and awaits its post-operation revision', async () => {
    const entered = gate();
    const release = gate();
    const applier = memoryApplier();
    let redoCalls = 0;

    applier.redo = async () => {
      redoCalls++;
      entered.release();
      await release.promise;
      applier.version = 'redone';
    };
    const pending = run({ commands: [{ name: 'history.redo', args: {} }] }, applier);

    await waitForEntry(entered.promise, pending);
    release.release();
    const result = await pending;

    expect(result).toMatchObject({ ok: true, revision: 'redone', results: [{}] });
    expect(redoCalls).toBe(1);
    expect(applier.events).toEqual([]);
  });

  const historyNames = ['history.undo', 'history.redo'];

  it.each(historyNames)('reports %s unavailable when the applier method is absent', async name => {
    const applier = memoryApplier();
    const result = await run({ commands: [{ name, args: {} }] }, applier);

    expect(result).toMatchObject({ ok: false, error: {
      code: 'COMMAND_UNAVAILABLE', commandIndex: 0, details: { reason: 'runtime' },
    } });
    expect(applier.events).toEqual([]);
  });

  it('does not bypass unavailable history contract entries even if the method exists', async () => {
    let calls = 0;
    const applier = memoryApplier({ undo: () => {
      calls++;

      return Promise.resolve();
    } });
    const result = await run({ commands: [{ name: 'history.undo', args: {} }] }, applier, {
      ctx: context({ commands: coreCommandMap({ 'history.undo': 'runtime' }) }),
    });

    expect(result).toMatchObject({ ok: false, error: {
      code: 'COMMAND_UNAVAILABLE', details: { reason: 'runtime' },
    } });
    expect(calls).toBe(0);
  });

  it('requires history to be alone before invoking its method', async () => {
    let calls = 0;
    const applier = memoryApplier({ undo: () => {
      calls++;

      return Promise.resolve();
    } });
    const result = await run({ commands: [
      { name: 'doc.read', args: {} }, { name: 'history.undo', args: {} },
    ] }, applier);

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_ARGS', commandIndex: 1 } });
    expect(calls).toBe(0);
    expect(applier.events).toEqual([]);
  });

  it('guards history writes when read-only', async () => {
    let calls = 0;
    const applier = memoryApplier({
      isReadOnly: () => true,
      undo: () => {
        calls++;

        return Promise.resolve();
      },
    });
    const result = await run({ commands: [{ name: 'history.undo', args: {} }] }, applier);

    expect(result).toMatchObject({ ok: false, error: { code: 'READ_ONLY' } });
    expect(calls).toBe(0);
  });

  it('rejects a stale history batch before calling undo', async () => {
    let calls = 0;
    const applier = memoryApplier({ undo: () => {
      calls++;

      return Promise.resolve();
    } });
    const result = await run({
      commands: [{ name: 'history.undo', args: {} }], expectRevision: 'old',
    }, applier);

    expect(result).toMatchObject({ ok: false, error: { code: 'STALE', retryable: true } });
    expect(calls).toBe(0);
  });

  it('preserves a typed history failure and records it in the log', async () => {
    const log: CommandLogEntry[] = [];
    const applier = memoryApplier({
      undo: () => Promise.reject(failure('UNDO_NOT_OWN', 'The top step belongs to the user.')),
    });
    const result = await run({ commands: [{ name: 'history.undo', args: {} }] }, applier, { log });

    expect(result).toMatchObject({ ok: false, error: { code: 'UNDO_NOT_OWN', retryable: false } });
    expect(log).toEqual([expect.objectContaining({
      name: 'history.undo', error: expect.objectContaining({ code: 'UNDO_NOT_OWN' }),
    })]);
    expect(applier.applied).toBe(0);
  });
});
