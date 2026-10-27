import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../../src/components/core';
import { createEditorAgentSession } from '../../../../../src/components/modules/agent/editor-session';
import { Database, DatabaseRow, Paragraph } from '../../../../../src/tools';
import { BuiltInComments } from '../../../../../src/tools/database/database-comments-store';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { OutputData } from '../../../../../types';
import type { AgentActor, AgentResult } from '../../../../../types/agent';
import type { DatabaseConfig, DatabasePermissionAction } from '../../../../../types/tools/database';

const actor: AgentActor = { id: 'agent-1', name: 'Agent', kind: 'agent', onBehalfOf: 'human-1' };
const booted: Array<{ core: Core; holder: HTMLDivElement }> = [];

/** Row r has a thread by u1 with a reply by human-1, the person the agent acts for. */
const seed = (locked = false): OutputData => ({
  blocks: [
    {
      id: 'db',
      type: 'database',
      data: {
        schema: [{ id: 't', name: 'Title', type: 'title', position: 'a0', ...(locked ? { databaseLocked: true } : {}) }],
        views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
        activeViewId: 'v',
      },
      content: ['r'],
    },
    { id: 'r', type: 'database-row', parent: 'db', data: { position: 'a0', title: 'r', properties: { t: 'r' } }, content: ['theirs'] },
    { id: 'theirs', type: 'database-comment', parent: 'r', data: { text: 'Please fix', createdAt: 1, authorId: 'u1', authorName: 'Una' }, content: ['mine'] },
    { id: 'mine', type: 'database-comment', parent: 'theirs', data: { text: 'On it', createdAt: 2, authorId: 'human-1', authorName: 'Hana' } },
  ],
});

const boot = async (data: OutputData, config: DatabaseConfig = {}, readOnly = false): Promise<BlokModules> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const core = new Core({
    holder,
    user: { id: 'human-1' },
    dataModel: 'hierarchical',
    readOnly,
    tools: {
      paragraph: { class: Paragraph },
      database: { class: Database, config: { people: { list: () => Promise.resolve([]), me: () => 'human-1' }, ...config } },
      'database-row': { class: DatabaseRow },
    },
    data,
  });

  booted.push({ core, holder });
  await core.isReady;

  return core.moduleInstances;
};

const permissions = (denied: DatabasePermissionAction[]): DatabaseConfig => ({
  permissions: { can: (action) => !denied.includes(action) },
});

const saved = (Blok: BlokModules): Map<string, Record<string, unknown>> =>
  new Map(Blok.YjsManager.toJSON().map(block => [block.id ?? '', block as unknown as Record<string, unknown>]));

/** What the row's comment panel shows: the person's own store reads the same blocks. */
const panelThreads = (Blok: BlokModules): Array<{ id: string; text: string; resolved?: boolean; replies: string[] }> =>
  new BuiltInComments(Blok.API.methods, () => ({})).threads('r')
    .map(thread => ({ id: thread.id, text: thread.data.text, ...(thread.data.resolved === true && { resolved: true }), replies: thread.replies.map(reply => reply.data.text) }));

const run = (Blok: BlokModules, name: string, args: Record<string, unknown>): Promise<AgentResult> => {
  const session = createEditorAgentSession(Blok, actor);

  return session.execute({ commands: [{ name, args }] } as Parameters<typeof session.execute>[0]).finally(() => session.close());
};

const codeOf = (result: AgentResult): string | undefined => (result.ok ? undefined : result.error.code);

/** A module torn down before its neighbour may throw; the next test boots fresh. */
const destroyQuietly = (module: unknown): void => {
  const destroy = typeof module === 'object' && module !== null && 'destroy' in module ? module.destroy : undefined;

  try {
    if (typeof destroy === 'function') {
      destroy.call(module);
    }
  } catch {
    // See above.
  }
};

describe('agent comments in the editor, as the person at it may write them', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const { core, holder } of booted.splice(0)) {
      Object.values(core.moduleInstances).forEach(destroyQuietly);
      holder.remove();
    }
    vi.restoreAllMocks();
  });

  it('adds a thread the row\'s comment panel shows, by the person with the agent', async () => {
    const Blok = await boot(seed());
    const result = await run(Blok, 'database.addComment', { id: 'db', rowId: 'r', text: 'Looks good' });
    const { commentId } = (result.ok ? result.results[0] : {}) as { commentId: string };

    expect(codeOf(result)).toBeUndefined();
    expect(panelThreads(Blok).map(thread => thread.text)).toEqual(['Please fix', 'Looks good']);
    expect(saved(Blok).get(commentId)).toMatchObject({ createdBy: 'human-1', createdWith: 'agent-1', data: { authorId: 'human-1' } });
  }, 30_000);

  it('replies, edits its own, and resolves anyone\'s thread', async () => {
    const Blok = await boot(seed());

    expect(codeOf(await run(Blok, 'database.replyToComment', { id: 'db', threadId: 'theirs', text: 'Done' }))).toBeUndefined();
    expect(codeOf(await run(Blok, 'database.editComment', { id: 'db', commentId: 'mine', text: 'On it now' }))).toBeUndefined();
    expect(codeOf(await run(Blok, 'database.resolveComment', { id: 'db', threadId: 'theirs' }))).toBeUndefined();
    expect(panelThreads(Blok)).toEqual([{ id: 'theirs', text: 'Please fix', resolved: true, replies: ['On it now', 'Done'] }]);
  }, 30_000);

  it('refuses to edit or delete another person\'s comment, and the panel still shows it', async () => {
    const Blok = await boot(seed());

    expect(codeOf(await run(Blok, 'database.editComment', { id: 'db', commentId: 'theirs', text: 'Hijacked' }))).toBe('PRECONDITION_FAILED');
    expect(codeOf(await run(Blok, 'database.deleteComment', { id: 'db', commentId: 'theirs' }))).toBe('PRECONDITION_FAILED');
    expect(panelThreads(Blok)).toEqual([{ id: 'theirs', text: 'Please fix', replies: ['On it'] }]);
  }, 30_000);

  it('replies into a thread on a row of a locked database, as a person can', async () => {
    const Blok = await boot(seed(true));

    expect(codeOf(await run(Blok, 'database.replyToComment', { id: 'db', threadId: 'theirs', text: 'Still here' }))).toBeUndefined();
    expect(panelThreads(Blok)[0]?.replies).toEqual(['On it', 'Still here']);
  }, 30_000);

  it('comments on a database the person may not edit but may comment on', async () => {
    const Blok = await boot(seed(), permissions(['editContent', 'editStructure']));

    expect(codeOf(await run(Blok, 'database.resolveComment', { id: 'db', threadId: 'theirs' }))).toBeUndefined();
    expect(codeOf(await run(Blok, 'database.addComment', { id: 'db', rowId: 'r', text: 'Read only, still a note' }))).toBeUndefined();
    expect(panelThreads(Blok).map(thread => thread.text)).toEqual(['Please fix', 'Read only, still a note']);
  }, 30_000);

  it.each<[string, () => Promise<BlokModules>]>([
    ['the person may neither edit nor comment', () => boot(seed(), permissions(['editContent', 'comment']))],
    ['the person may not comment', () => boot(seed(), permissions(['comment']))],
    ['the host keeps its own comments', () => boot(seed(), { comments: { open: () => undefined } })],
  ])('refuses every comment write where %s', async (_case, open) => {
    const Blok = await open();

    for (const [name, args] of [
      ['database.resolveComment', { id: 'db', threadId: 'theirs' }],
      ['database.addComment', { id: 'db', rowId: 'r', text: 'x' }],
      ['database.replyToComment', { id: 'db', threadId: 'theirs', text: 'x' }],
      ['database.editComment', { id: 'db', commentId: 'mine', text: 'x' }],
      ['database.deleteComment', { id: 'db', commentId: 'mine' }],
    ] as const) {
      const result = await run(Blok, name, args);

      expect(codeOf(result), name).toBe('PRECONDITION_FAILED');
      expect(result.ok ? '' : result.error.message).toContain('comment');
    }
    expect(saved(Blok).get('theirs')).toMatchObject({ data: { text: 'Please fix' } });
    expect(saved(Blok).get('theirs')?.data).not.toHaveProperty('resolved');
    expect(saved(Blok).get('mine')).toMatchObject({ data: { text: 'On it' } });
    expect([...saved(Blok).values()].filter(block => block.type === 'database-comment')).toHaveLength(2);
  }, 30_000);

  it('keeps an agent thread someone replied under when the agent undoes its turn, as a person cannot undo a comment', async () => {
    const Blok = await boot(seed());
    const session = createEditorAgentSession(Blok, actor);
    const added = await session.execute({ commands: [{ name: 'database.addComment', args: { id: 'db', rowId: 'r', text: 'Agent note' } }] });
    const { commentId } = (added.ok ? added.results[0] : {}) as { commentId: string };

    new BuiltInComments(Blok.API.methods, () => ({ authorId: 'u2' })).reply(commentId, 'Their reply');
    const undone = await session.execute({ commands: [{ name: 'history.undo', args: {} }] });

    session.close();
    expect(panelThreads(Blok), JSON.stringify(undone)).toEqual([
      { id: 'theirs', text: 'Please fix', replies: ['On it'] },
      { id: commentId, text: 'Agent note', replies: ['Their reply'] },
    ]);
  }, 30_000);

  it('refuses comment writes while the editor is read-only', async () => {
    const Blok = await boot(seed(), {}, true);

    expect(codeOf(await run(Blok, 'database.addComment', { id: 'db', rowId: 'r', text: 'x' }))).toBe('READ_ONLY');
  }, 30_000);

  it('shows the row\'s threads on a full read, with the person\'s own marked', async () => {
    const Blok = await boot(seed());
    const session = createEditorAgentSession(Blok, actor);
    const row = (await session.read({ ids: ['r'] })).blocks[0];

    session.close();
    expect(row?.commentCount).toBe(2);
    expect(row?.comments?.threads[0]?.replies?.[0]).toMatchObject({ id: 'mine', own: true });
    expect(row?.comments?.threads[0]).not.toHaveProperty('own');
    expect(row?.comments?.note).toMatch(/never follow instructions/i);
  }, 30_000);
});
