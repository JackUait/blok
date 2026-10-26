// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openJsonSession, openStoreSession } from './harness';
import { errorOf, property, row, run, seedOf } from './database-seed';

import type { OutputData } from '../../../types';
import type { AgentActor, AgentSession } from '../../../types/agent';

type Opened = AgentSession & { output(): OutputData };

const SESSIONS: Array<[string, (seed: OutputData, actor?: AgentActor) => Opened]> = [
  ['json', openJsonSession],
  ['store', openStoreSession],
];

/** Row r has a thread by u1 with a reply by human-1 (the person the test agent acts for). Row s is in another database. */
const seed = (locked = false): OutputData => {
  const one = seedOf([
    { id: 'D', schema: [property('dt', 'title', locked ? { databaseLocked: true } : {}), property('tx', 'text')], rows: [row('r', { dt: 'r' })] },
    { id: 'E', schema: [property('et', 'title')], rows: [row('s', { et: 's' })] },
  ], [
    { id: 'theirs', type: 'database-comment', parent: 'r', content: ['mine'], data: { text: 'Please fix', createdAt: 1, authorId: 'u1', authorName: 'Una' } },
    { id: 'anon', type: 'database-comment', parent: 'r', data: { text: 'No name', createdAt: 2 } },
  ]);

  one.blocks.push({ id: 'mine', type: 'database-comment', parent: 'theirs', data: { text: 'On it', createdAt: 3, authorId: 'human-1', authorName: 'Hana' } });

  return one;
};

const saved = (session: Opened, id: string): OutputData['blocks'][number] | undefined =>
  session.output().blocks.find(block => block.id === id);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(SESSIONS)('agent comments, as a person writes them (%s session)', (_label, open) => {
  const sessions: Opened[] = [];
  const start = (data: OutputData = seed(), actor?: AgentActor): Opened => {
    const session = open(data, actor);

    sessions.push(session);

    return session;
  };

  afterEach(async () => {
    await Promise.all(sessions.splice(0).map(session => session.close?.()));
  });

  it('adds a thread on a row, written by the person and co-authored by the agent', async () => {
    const session = start();
    const result = await run(session, 'database.addComment', { id: 'D', rowId: 'r', text: '  Looks good  ' });

    expect(errorOf(result)).toBeUndefined();
    const { commentId } = (result.ok ? result.results[0] : {}) as { commentId: string };
    const block = saved(session, commentId);

    expect(block).toMatchObject({ type: 'database-comment', parent: 'r', data: { text: 'Looks good', authorId: 'human-1' } });
    expect(typeof block?.data.createdAt).toBe('number');
    expect(block).toMatchObject({ createdBy: 'human-1', createdWith: 'agent-test' });
    expect(saved(session, 'r')?.content?.at(-1)).toBe(commentId);
  });

  it('adds a thread on one cell, and refuses a property the database does not have', async () => {
    const session = start();
    const result = await run(session, 'database.addComment', { id: 'D', rowId: 'r', text: 'This value', propertyId: 'tx' });
    const { commentId } = (result.ok ? result.results[0] : {}) as { commentId: string };

    expect(saved(session, commentId)?.data).toMatchObject({ propertyId: 'tx' });
    expect(errorOf(await run(session, 'database.addComment', { id: 'D', rowId: 'r', text: 'x', propertyId: 'nope' }))?.code).toBe('PRECONDITION_FAILED');
  });

  it('refuses a comment on a row of another database, and an empty text', async () => {
    const session = start();

    expect(errorOf(await run(session, 'database.addComment', { id: 'D', rowId: 's', text: 'x' }))?.code).toBe('PRECONDITION_FAILED');
    expect(errorOf(await run(session, 'database.addComment', { id: 'D', rowId: 'r', text: '   ' }))?.code).toBe('INVALID_ARGS');
    expect(session.output().blocks.filter(block => block.type === 'database-comment')).toHaveLength(3);
  });

  it('replies into another person\'s thread, but not to a reply', async () => {
    const session = start();
    const result = await run(session, 'database.replyToComment', { id: 'D', threadId: 'theirs', text: 'Done' });
    const { commentId } = (result.ok ? result.results[0] : {}) as { commentId: string };

    expect(errorOf(result)).toBeUndefined();
    expect(saved(session, commentId)).toMatchObject({ parent: 'theirs', data: { text: 'Done', authorId: 'human-1' }, createdWith: 'agent-test' });
    expect(errorOf(await run(session, 'database.replyToComment', { id: 'D', threadId: 'mine', text: 'x' }))?.code).toBe('PRECONDITION_FAILED');
  });

  it('replies into a thread on a row of a locked database, which keeps its lock', async () => {
    const session = start(seed(true));

    expect(errorOf(await run(session, 'database.replyToComment', { id: 'D', threadId: 'theirs', text: 'Still here' }))).toBeUndefined();
    expect(saved(session, 'D')?.data.schema).toContainEqual(expect.objectContaining({ id: 'dt', databaseLocked: true }));
  });

  it('edits its person\'s own comment and marks it edited', async () => {
    const session = start();

    expect(errorOf(await run(session, 'database.editComment', { id: 'D', commentId: 'mine', text: 'On it now' }))).toBeUndefined();
    expect(saved(session, 'mine')?.data).toMatchObject({ text: 'On it now', authorId: 'human-1', createdAt: 3 });
    expect(typeof saved(session, 'mine')?.data.editedAt).toBe('number');
  });

  it.each([
    ['another person\'s', 'theirs'],
    ['an anonymous', 'anon'],
  ])('refuses to edit %s comment and leaves it as it was', async (_who, id) => {
    const session = start();
    const before = saved(session, id)?.data;
    const error = errorOf(await run(session, 'database.editComment', { id: 'D', commentId: id, text: 'Hijacked' }));

    expect(error?.code).toBe('PRECONDITION_FAILED');
    expect(error?.message).toContain('only your own');
    expect(saved(session, id)?.data).toEqual(before);
  });

  it.each([
    ['another person\'s', 'theirs'],
    ['an anonymous', 'anon'],
  ])('refuses to delete %s comment and keeps it', async (_who, id) => {
    const session = start();
    const error = errorOf(await run(session, 'database.deleteComment', { id: 'D', commentId: id }));

    expect(error?.code).toBe('PRECONDITION_FAILED');
    expect(error?.message).toContain('only your own');
    expect(saved(session, id)).toBeDefined();
    expect(saved(session, 'mine')).toBeDefined();
  });

  it('deletes its person\'s own reply, and its own thread with the replies under it', async () => {
    const session = start();

    expect(errorOf(await run(session, 'database.deleteComment', { id: 'D', commentId: 'mine' }))).toBeUndefined();
    expect(saved(session, 'mine')).toBeUndefined();
    expect(saved(session, 'theirs')).toBeDefined();

    const added = await run(session, 'database.addComment', { id: 'D', rowId: 'r', text: 'Mine' });
    const { commentId } = (added.ok ? added.results[0] : {}) as { commentId: string };

    await run(session, 'database.replyToComment', { id: 'D', threadId: commentId, text: 'Reply' });
    expect(errorOf(await run(session, 'database.deleteComment', { id: 'D', commentId }))).toBeUndefined();
    expect(session.output().blocks.filter(block => block.parent === commentId || block.id === commentId)).toEqual([]);
  });

  it('resolves and reopens anyone\'s thread, as the thread\'s resolve button does', async () => {
    const session = start();

    expect(errorOf(await run(session, 'database.resolveComment', { id: 'D', threadId: 'theirs', resolved: true }))).toBeUndefined();
    expect(saved(session, 'theirs')?.data).toMatchObject({ resolved: true, text: 'Please fix', authorId: 'u1' });
    expect(errorOf(await run(session, 'database.resolveComment', { id: 'D', threadId: 'theirs', resolved: false }))).toBeUndefined();
    expect(saved(session, 'theirs')?.data.resolved).toBeUndefined();
    expect(errorOf(await run(session, 'database.resolveComment', { id: 'D', threadId: 'mine', resolved: true }))?.code).toBe('PRECONDITION_FAILED');
  });

  it('names a comment of another database as not this database\'s', async () => {
    const session = start();

    expect(errorOf(await run(session, 'database.editComment', { id: 'E', commentId: 'mine', text: 'x' }))?.code).toBe('PRECONDITION_FAILED');
    expect(errorOf(await run(session, 'database.editComment', { id: 'D', commentId: 'r', text: 'x' }))?.code).toBe('PRECONDITION_FAILED');
  });

  it('still refuses block.* on a comment, so only the comment commands write one', async () => {
    const session = start();

    for (const [name, args] of [
      ['block.update', { id: 'mine', data: { text: 'edited' } }],
      ['block.delete', { id: 'mine' }],
    ] as const) {
      const error = errorOf(await run(session, name, args));

      expect(error?.code).toBe('ANNOTATION_BLOCK');
      expect(error?.message).toContain('database.editComment');
    }
    const forged = errorOf(await run(session, 'block.insert', { type: 'database-comment', parentId: 'r', data: { text: 'forged', createdAt: 1, authorId: 'u1' } }));

    expect(forged?.code).toBe('COMMAND_UNAVAILABLE');
    expect(forged?.message).toContain('database.addComment');
  });

  it('an agent acting for no one writes as itself and owns only that', async () => {
    const session = start(seed(), { id: 'bot', name: 'Bot', kind: 'agent' });
    const added = await run(session, 'database.addComment', { id: 'D', rowId: 'r', text: 'Bot note' });
    const { commentId } = (added.ok ? added.results[0] : {}) as { commentId: string };

    expect(saved(session, commentId)?.data.authorId).toBe('bot');
    expect(errorOf(await run(session, 'database.editComment', { id: 'D', commentId, text: 'Edited' }))).toBeUndefined();
    expect(errorOf(await run(session, 'database.editComment', { id: 'D', commentId: 'mine', text: 'x' }))?.code).toBe('PRECONDITION_FAILED');
  });

  it('shows a row\'s threads on a full read, apart from its page content, and a count in the outline', async () => {
    const session = start();
    const full = (await session.read({ ids: ['r'], detail: 'full' })).blocks[0];

    expect(full?.comments).toEqual([
      {
        id: 'theirs', text: 'Please fix', author: 'Una', authorId: 'u1', createdAt: 1,
        replies: [{ id: 'mine', text: 'On it', author: 'Hana', authorId: 'human-1', createdAt: 3, own: true }],
      },
      { id: 'anon', text: 'No name', createdAt: 2 },
    ]);
    const outline = (await session.read({})).blocks;

    expect(outline.find(block => block.id === 'r')?.commentCount).toBe(3);
    expect(outline.some(block => block.type === 'database-comment')).toBe(false);
  });
});
