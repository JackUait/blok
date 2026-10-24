// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COMMANDS } from '../../../../src/shared/agent/commands';
import { BUILT_IN_INLINE_DESCRIPTIONS } from '../../../../src/shared/tool-descriptions/inline';
import { openJsonSession } from '../../agent/harness';

import type { OutputData } from '../../../../types';

const seed: OutputData = { blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'Hello world' }] } }] };

const textOf = async (session: ReturnType<typeof openJsonSession>, id: string): Promise<unknown> =>
  (await session.read({ ids: [id], detail: 'full' })).blocks.find(block => block.id === id)?.data?.text;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('what the model is told about inline formats is true', () => {
  it('tells the model that unset removes a mark and "tag:*" clears custom marks', () => {
    const unset = JSON.stringify(COMMANDS['text.format'].argsSchema);

    expect(unset).toContain('tag:*');
    expect(unset).toMatch(/remove a mark/i);
  });

  it('refuses false in text.format set, so the model is pointed at unset instead', async () => {
    const session = openJsonSession(seed);

    try {
      const result = await session.execute({ commands: [{ name: 'text.format', args: { id: 'p', range: { find: 'world' }, set: { bold: false } } }] });

      expect(result.ok).toBe(false);
    } finally {
      await session.close();
    }
  });

  it('does not promise any CSS colour on the marker, because oklch is dropped', async () => {
    const summary = BUILT_IN_INLINE_DESCRIPTIONS.marker().summary;

    expect(summary).not.toMatch(/any CSS colou?r/i);

    const session = openJsonSession(seed);

    try {
      await session.execute({ commands: [{ name: 'text.format', args: { id: 'p', range: { find: 'world' }, set: { color: 'oklch(0.6 0.2 30)' } } }] });

      expect(await textOf(session, 'p')).toEqual([{ text: 'Hello world' }]);
    } finally {
      await session.close();
    }
  });
});
