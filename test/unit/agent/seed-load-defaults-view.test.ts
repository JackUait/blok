// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OutputData } from '../../../types';
import type { ViewBlock } from '../../../types/agent';
import { openJsonSession, openStoreSession } from './harness';

/*
 * The editor fills a tool's load defaults when it loads a block, so Ask AI shows them to the
 * model. A stored document from MCP can lack them; the headless engines must show the same.
 */
const seed: OutputData = {
  blocks: [
    { id: 'q', type: 'quote', data: { text: [{ text: 'Q' }] } },
    { id: 'c', type: 'code', data: { code: 'x = 1', language: 'python' } },
    { id: 'co', type: 'callout', data: { emoji: '💡' } },
  ],
};

const engines = [
  ['json', () => openJsonSession(seed)],
  ['store', () => openStoreSession(seed)],
] as const;

const byId = (rows: ViewBlock[] | undefined, id: string): ViewBlock | undefined => rows?.find((row) => row.id === id);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(engines)('%s engine: a seed block without its load defaults', (_name, open) => {
  it('reads with the defaults the editor would fill', async () => {
    const session = open();

    try {
      const view = await session.read({ detail: 'full' });

      expect(byId(view.blocks, 'q')).toMatchObject({ attrs: { size: 'default' }, data: { size: 'default' } });
      expect(byId(view.blocks, 'c')?.data).toMatchObject({ lineNumbers: true });
      expect(byId(view.blocks, 'co')?.data).toMatchObject({ textColor: null, backgroundColor: null });
    } finally {
      await session.close();
    }
  });

  it('shows them in the changed rows of a batch that moves the block', async () => {
    const session = open();

    try {
      const result = await session.execute({ commands: [{ name: 'block.move', args: { id: 'q', position: 'end' } }] });

      expect(result.ok).toBe(true);
      expect(result.ok && byId(result.blocks, 'q')).toMatchObject({ attrs: { size: 'default' }, data: { size: 'default' } });
    } finally {
      await session.close();
    }
  });

  it('does not write them on a read', async () => {
    const session = open();

    try {
      await session.read({ detail: 'full' });

      expect(session.output().blocks.find((block) => block.id === 'q')?.data).not.toHaveProperty('size');
    } finally {
      await session.close();
    }
  });
});
