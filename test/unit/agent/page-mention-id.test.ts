import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openJsonSession, openStoreSession } from './harness';

import type { AgentBatch, OutputData } from '../../../types';

/**
 * A page mention names a page by its pageId, as the @ menu writes it
 * (pageReferenceTrigger.ts). A block id renders as an unresolved mention.
 */

const TIMEOUT = 60_000;

const SEED: OutputData = {
  blocks: [
    { id: 'pl', type: 'page', data: { pageId: 'pg-1' } },
    { id: 'p', type: 'paragraph', data: { text: [{ text: 'See ' }] } },
  ],
};

const mention = (id: string): AgentBatch => ({ commands: [{
  name: 'text.insert', args: { id: 'p', at: 4, text: [{ embed: { page: { id } } }] },
}] });

const RUNTIMES = [
  ['json', openJsonSession],
  ['store', openStoreSession],
] as const;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(RUNTIMES)('page mention ids (%s)', (_runtime, open) => {
  const run = async (batch: AgentBatch) => {
    const session = open(SEED);

    try {
      return await session.execute(batch);
    } finally {
      await session.close();
    }
  };

  it('refuses the block id of a page block and names its pageId', async () => {
    const result = await run(mention('pl'));

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_ARGS' } });
    expect(result.ok ? '' : result.error.message).toContain('"pg-1"');
  }, TIMEOUT);

  it('refuses the id of a block that is not a page', async () => {
    expect(await run(mention('p'))).toMatchObject({ ok: false, error: { code: 'INVALID_ARGS' } });
  }, TIMEOUT);

  it('takes the pageId of a page block in this document without a warning', async () => {
    expect(await run(mention('pg-1'))).toMatchObject({ ok: true, warnings: [] });
  }, TIMEOUT);

  it('warns when it cannot check a pageId from here', async () => {
    expect(await run(mention('elsewhere'))).toMatchObject({
      ok: true,
      warnings: [{ code: 'UNVERIFIED_PAGE', blockId: 'p', field: 'text' }],
    });
  }, TIMEOUT);

  it('does not warn about a mention the field already had, sent back as read', async () => {
    const session = open({ blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'See ' }, { embed: { page: { id: 'elsewhere' } } }] } }] });

    try {
      const result = await session.execute({ commands: [{
        name: 'text.replace', args: { id: 'p', range: 'all', with: [{ text: 'Look ' }, { embed: { page: { id: 'elsewhere' } } }] },
      }] });

      expect(result).toMatchObject({ ok: true, warnings: [] });
    } finally {
      await session.close();
    }
  }, TIMEOUT);
});
