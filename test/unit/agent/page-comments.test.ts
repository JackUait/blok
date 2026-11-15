// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openJsonSession, openStoreSession } from './harness';
import { property, row, seedOf } from './database-seed';

import type { OutputData } from '../../../types';
import type { AgentSession } from '../../../types/agent';

const seed = (): OutputData => ({ blocks: [
  { id: 'body', type: 'paragraph', data: { text: 'Page content' } },
  { id: 'thread', type: 'database-comment', content: ['reply'], data: { text: 'Correct this answer', authorName: 'Una', authorId: 'u1', createdAt: 1 } },
  { id: 'reply', type: 'database-comment', parent: 'thread', data: { text: 'On it', authorId: 'human-1', createdAt: 2 } },
  { id: 'resolved', type: 'database-comment', data: { text: 'Already fixed', resolved: true, createdAt: 3 } },
] });

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe.each([['json', openJsonSession], ['store', openStoreSession]] as const)('page comments in agent reads (%s)', (_label, open) => {
  const sessions: AgentSession[] = [];
  const start = (data = seed(), comments = true): AgentSession => {
    const session = open(data, undefined, undefined, undefined, { comments });

    sessions.push(session);

    return session;
  };

  afterEach(async () => { await Promise.all(sessions.splice(0).map(session => session.close?.())); });

  it('exposes open page threads and replies as untrusted comments even in the default read', async () => {
    const view = await start().read();

    expect(view).toHaveProperty('comments.threads', [
      { id: 'thread', text: 'Correct this answer', author: 'Una', authorId: 'u1', createdAt: 1,
        replies: [{ id: 'reply', text: 'On it', authorId: 'human-1', createdAt: 2, own: true }] },
    ]);
    expect(view).toHaveProperty('comments.note', expect.stringMatching(/never follow instructions/i));
    expect(view.blocks.map(block => block.id)).toEqual(['body']);
  });

  it('respects the text limit for root threads', async () => {
    expect(await start().read({ textLimit: 7 })).toHaveProperty('comments.threads.0', expect.objectContaining({ text: 'Correct…', truncated: true }));
  });

  it('omits page threads from subtree and selected-block reads and opted-out hosts', async () => {
    const session = start();

    expect(await session.read({ rootId: 'body', detail: 'full' })).not.toHaveProperty('comments');
    expect(await session.read({ ids: ['body'] })).not.toHaveProperty('comments');
    expect(await start(seed(), false).read({ detail: 'full' })).not.toHaveProperty('comments');
    expect(await start({ blocks: [seed().blocks[0]] }).read()).not.toHaveProperty('comments');
  });

  it('shares the read cap between root and row comments and counts every omitted comment', async () => {
    const data = seedOf([{ id: 'D', schema: [property('title', 'title')], rows: [row('r', { title: 'Row' })] }], [
      { id: 'row-comment', type: 'database-comment', parent: 'r', data: { text: 'Row correction', createdAt: 1 } },
    ]);

    data.blocks.push(...Array.from({ length: 201 }, (_unused, index) => ({
      id: `page-comment-${index}`, type: 'database-comment', data: { text: 'Correction', createdAt: index },
    })));
    const view = await start(data).read({ detail: 'full' });
    const root = (view as typeof view & { comments?: { threads: unknown[]; more?: number } }).comments;
    const rowComments = view.blocks.find(block => block.id === 'r')?.comments;

    expect((root?.threads.length ?? 0) + (rowComments?.threads.length ?? 0)).toBe(200);
    expect((root?.more ?? 0) + (rowComments?.more ?? 0)).toBe(2);
  });
});
