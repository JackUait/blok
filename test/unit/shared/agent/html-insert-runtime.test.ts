// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { composeGuidance } from '../../../../src/agent/guidance';
import { describeContract } from '../../../../src/shared/agent/describe';
import type { AgentBatch } from '../../../../types/agent';
import { nodeContract, openJsonSession, openStoreSession } from '../../agent/harness';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const seed = { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'keep' } }] };
const batch: AgentBatch = { commands: [{ name: 'html.insert', args: { html: '<h2>New</h2><p>x</p>' } }] };

/*
 * Only the editor runs the paste pipeline: tool pasteConfig, the host sanitizer and
 * onBeforePaste live in editor config. A headless import would give other blocks.
 */
describe('html.insert outside the editor', () => {
  it.each(['node', 'node-live'] as const)('is listed as unavailable for the runtime in %s', (runtime) => {
    const entry = nodeContract(runtime).commands.find(command => command.name === 'html.insert');

    expect(entry).toMatchObject({ available: false, unavailableReason: 'runtime' });
    expect(describeContract(nodeContract(runtime), {})).toMatchObject({
      index: { commands: expect.arrayContaining([expect.objectContaining({ name: 'html.insert', available: false, reason: 'runtime' })]) },
    });
  });

  it('is not offered in the guidance a headless contract composes', () => {
    expect(composeGuidance(nodeContract())).not.toContain('html.insert');
  });

  it('is refused by a stored session, which writes nothing', async () => {
    const session = openJsonSession(seed);
    const before = session.output();
    const result = await session.execute(batch);

    expect(result).toMatchObject({ ok: false, error: { code: 'COMMAND_UNAVAILABLE', details: { reason: 'runtime' } } });
    expect(session.output()).toEqual(before);
  });

  it('is refused by a live session, which writes nothing', async () => {
    const session = openStoreSession(seed);

    try {
      const before = session.output();
      const result = await session.execute(batch);

      expect(result).toMatchObject({ ok: false, error: { code: 'COMMAND_UNAVAILABLE', details: { reason: 'runtime' } } });
      expect(session.output()).toEqual(before);
    } finally {
      await session.close();
    }
  });
});
