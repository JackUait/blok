// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { invoke } from '../../../src/view/server-runtime';
import { isObject } from '../../../src/shared/type-guards';
import { openJsonSession, openStoreSession } from './harness';
import { errorOf, property, row, run, seedOf } from './database-seed';

import type { OutputData } from '../../../types';
import type { AgentSession } from '../../../types/agent';

type Opened = AgentSession & { output(): OutputData };

/** Row r with a thread by u1 and a reply by human-1, the person the test agent acts for. */
const seed = (): OutputData => {
  const data = seedOf([{ id: 'D', schema: [property('dt', 'title')], rows: [row('r', { dt: 'r' })] }], [
    { id: 'theirs', type: 'database-comment', parent: 'r', content: ['mine'], data: { text: 'Please fix', createdAt: 1, authorId: 'u1' } },
  ]);

  data.blocks.push({ id: 'mine', type: 'database-comment', parent: 'theirs', data: { text: 'On it', createdAt: 2, authorId: 'human-1' } });

  return data;
};

const WRITES: Array<[string, Record<string, unknown>]> = [
  ['database.addComment', { id: 'D', rowId: 'r', text: 'Hidden from people' }],
  ['database.replyToComment', { id: 'D', threadId: 'theirs', text: 'Hidden reply' }],
  ['database.editComment', { id: 'D', commentId: 'mine', text: 'Changed' }],
  ['database.resolveComment', { id: 'D', threadId: 'theirs' }],
  ['database.deleteComment', { id: 'D', commentId: 'mine' }],
];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each<[string, (seed: OutputData, where?: { comments?: boolean }) => Opened]>([
  ['json', (data, where) => openJsonSession(data, undefined, undefined, undefined, where)],
  ['store', (data, where) => openStoreSession(data, undefined, undefined, undefined, where)],
])('built-in comments in a headless host (%s session)', (_label, open) => {
  const sessions: Opened[] = [];
  const start = (where?: { comments?: boolean }): Opened => {
    const session = open(seed(), where);

    sessions.push(session);

    return session;
  };

  afterEach(async () => {
    await Promise.all(sessions.splice(0).map(session => session.close?.()));
  });

  it.each(WRITES)('runs %s by default', async (name, args) => {
    expect(errorOf(await run(start(), name, args))).toBeUndefined();
  });

  it.each(WRITES)('refuses %s once the host opts out, so no comment lands that people cannot see', async (name, args) => {
    const session = start({ comments: false });
    const before = session.output();
    const result = await run(session, name, args);

    expect(result).toMatchObject({ ok: false, error: { code: 'COMMAND_UNAVAILABLE', details: { reason: 'host' } } });
    expect(session.output()).toEqual(before);
  });

  it('lists the comment commands as unavailable once the host opts out', async () => {
    const tools = await start({ comments: false }).describe({ tool: 'database' });
    const listed = 'commands' in tools ? tools.commands.filter(command => command.name.endsWith('Comment')) : [];

    expect(listed.map(command => [command.name, command.available]).sort()).toEqual(WRITES.map(([name]) => [name, false]).sort());
  });

  it('shows no threads and no count once the host opts out, so nothing reads as yours to edit', async () => {
    const row = (await start({ comments: false }).read({ ids: ['r'], detail: 'full' })).blocks[0];

    expect(row).not.toHaveProperty('comments');
    expect(row).not.toHaveProperty('commentCount');
  });
});

const executeWire = async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const response: unknown = JSON.parse(await invoke('agentExecute', JSON.stringify(input)));

  if (!isObject(response)) {
    throw new TypeError('agentExecute must return a JSON object.');
  }

  return response;
};

describe('the Jint runtime and built-in comments', () => {
  const actor = { id: 'agent-jint', name: 'Server agent', kind: 'agent', onBehalfOf: 'human-1' };

  it.each(WRITES)('runs %s by default', async (name, args) => {
    const output = await executeWire({ document: seed(), actor, batch: { commands: [{ name, args }] } });

    expect(output.result).toMatchObject({ ok: true });
  });

  it.each(WRITES)('refuses %s once the host opts out', async (name, args) => {
    const output = await executeWire({ document: seed(), actor, comments: false, batch: { commands: [{ name, args }] } });

    expect(output.result).toMatchObject({ ok: false, error: { code: 'COMMAND_UNAVAILABLE', details: { reason: 'host' } } });
    expect(output.edits ?? []).toEqual([]);
  });
});
