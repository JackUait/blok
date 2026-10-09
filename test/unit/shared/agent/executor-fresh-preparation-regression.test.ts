// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runBatch } from '../../../../src/shared/agent/executor';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';

import type { AgentApplier } from '../../../../src/shared/agent/executor';
import type { AgentActor, CommandLogEntry, OutputData } from '../../../../types';

import { plannerContext, stubPorts, TOOLS, tool } from './fixtures';

describe('runBatch preparation requirements after settle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses a fresh host-required fallback when the disposable insert needed no preparation', async () => {
    const initial: OutputData = {
      blocks: [{ id: 'parent', type: 'paragraph_parent', data: {} }],
    };
    const peerDoc: OutputData = {
      blocks: [{ id: 'parent', type: 'record_parent', data: {} }],
    };
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
    tools.set('paragraph_parent', tool('paragraph_parent', {
      children: {
        accepts: true, allow: ['paragraph'], ownedByTool: false,
        layout: false, deletedWithParent: false,
      },
    }));
    tools.set('record_parent', tool('record_parent', {
      children: {
        accepts: true, allow: ['record'], ownedByTool: false,
        layout: false, deletedWithParent: false,
      },
    }));
    const prepareCalls: string[] = [];
    const sanitizedTypes: string[] = [];
    const applier: AgentApplier & {
      current: DocSnapshot;
      version: string;
      applied: number;
    } = {
      current: DocSnapshot.fromOutput(initial),
      version: 'r0',
      applied: 0,
      runtime: 'node',
      isReadOnly: () => false,
      snapshot: () => applier.current,
      revision: () => applier.version,
      prepareInsert: type => {
        prepareCalls.push(type);

        return Promise.resolve({ count: 2 });
      },
      settle: () => {
        applier.current = DocSnapshot.fromOutput(peerDoc);
        applier.version = 'peer';

        return Promise.resolve();
      },
      apply: (_plan, draft) => {
        applier.current = draft;
        applier.applied++;
        applier.version = `r${applier.applied}`;

        return Promise.resolve();
      },
    };
    const { prepared: _prepared, ...ctx } = plannerContext({
      tools,
      ports: stubPorts({
        sanitizeBlockData: (type, data) => {
          sanitizedTypes.push(type);

          return data;
        },
      }),
    });
    const actor: AgentActor = { id: 'agent-1', name: 'Agent', kind: 'agent' };
    const log: CommandLogEntry[] = [];
    const result = await runBatch({
      batch: { commands: [
        { name: 'doc.read', args: {} },
        {
          name: 'block.insert',
          args: { id: 'child', type: 'paragraph', parentId: 'parent', demote: true },
        },
      ] },
      ctx, applier, actor, log, batchNo: 1, now: () => 7,
    });

    expect(result).toMatchObject({
      ok: false, revision: 'peer',
      error: { code: 'STALE', commandIndex: 1, retryable: true },
    });
    expect(applier.current.toOutput()).toEqual(peerDoc);
    if (result.ok) {
      throw new Error('Expected the new preparation requirement to be refused.');
    }
    expect(result.error).not.toHaveProperty('details.orphaned');
    expect(log).toEqual([
      { batch: 1, index: 0, name: 'doc.read', args: {}, actorId: 'agent-1' },
      {
        batch: 1, index: 1, name: 'block.insert',
        args: { id: 'child', type: 'paragraph', parentId: 'parent', demote: true },
        error: result.error, actorId: 'agent-1',
      },
    ]);
    expect(applier.applied).toBe(0);
    expect(prepareCalls).toEqual([]);
    expect(sanitizedTypes).toEqual(['paragraph', 'record']);
  });
});
