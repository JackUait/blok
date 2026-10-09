// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocSnapshot, runBatch } from '../../../../src/shared/agent';
import { isRichText } from '../../../../src/shared/rich-text/guards';

import type { AgentApplier } from '../../../../src/shared/agent';
import type { AgentActor, AgentCommand, OutputData, RichText } from '../../../../types';

import { plannerContext, stubPorts } from './fixtures';

const document: OutputData = {
  blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'Kept' }] } }],
};
const actor: AgentActor = { id: 'agent-1', name: 'Agent', kind: 'agent' };

const memoryApplier = () => {
  const state: AgentApplier & { current: DocSnapshot; applied: number; snapshots: number } = {
    current: DocSnapshot.fromOutput(document),
    applied: 0,
    snapshots: 0,
    runtime: 'node',
    isReadOnly: () => false,
    revision: () => 'r0',
    snapshot: () => {
      state.snapshots++;

      return state.current;
    },
    apply: (_plan, draft) => {
      state.applied++;
      state.current = draft;

      return Promise.resolve();
    },
  };

  return state;
};

const missingInputs: Array<{ command: AgentCommand; missing: 'text' | 'with' }> = [
  { command: { name: 'text.insert', args: { id: 'p', at: 0 } }, missing: 'text' },
  { command: { name: 'text.replace', args: { id: 'p' } }, missing: 'with' },
];

describe('executor required text and sanitized-empty boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(missingInputs)('$command.name rejects missing $missing before application', async ({ command }) => {
    const applier = memoryApplier();
    const before = applier.current.toOutput();
    const result = await runBatch({
      batch: { commands: [command] }, ctx: plannerContext(), applier, actor, log: [], batchNo: 1, now: () => 7,
    });

    expect(result).toMatchObject({
      ok: false, error: { code: 'INVALID_ARGS', commandIndex: 0, path: '/commands/0/args' },
    });
    expect(applier.applied).toBe(0);
    expect(applier.snapshots).toBe(0);
    expect(applier.current.toOutput()).toEqual(before);
  });

  it('warns when supplied valid rich text is sanitized entirely away', async () => {
    const applier = memoryApplier();
    const supplied: RichText = [{ text: 'Discarded' }];
    const ports = stubPorts({
      sanitizeBlockData: (_type, data) => {
        if (isRichText(data.text) && data.text.some(segment => 'text' in segment && segment.text === 'Discarded')) {
          const clean = { ...data };

          Reflect.deleteProperty(clean, 'text');

          return clean;
        }

        return data;
      },
    });
    const result = await runBatch({
      batch: { commands: [{ name: 'text.insert', args: { id: 'p', at: 0, text: supplied } }] },
      ctx: plannerContext({ ports }), applier, actor, log: [], batchNo: 1, now: () => 7,
    });

    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'SANITIZED', commandIndex: 0, blockId: 'p', field: 'text',
    }));
    expect(result).toMatchObject({ ok: true, results: [{ length: 0 }] });
    expect(applier.current.get('p')?.data.text).toEqual([{ text: 'Kept' }]);
    expect(supplied).toEqual([{ text: 'Discarded' }]);
  });
});
