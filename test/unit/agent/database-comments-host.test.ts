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

describe.each<[string, (seed: OutputData, comments: boolean) => Opened]>([
  ['json', (data, comments) => openJsonSession(data, undefined, undefined, undefined, { comments })],
  ['store', (data, comments) => openStoreSession(data, undefined, undefined, undefined, { comments })],
])('a headless host that does not say it keeps built-in comments (%s session)', (_label, open) => {
  const sessions: Opened[] = [];

  afterEach(async () => {
    await Promise.all(sessions.splice(0).map(session => session.close?.()));
  });

  it.each(WRITES)('refuses %s, so no comment lands that people cannot see', async (name, args) => {
    const session = open(seed(), false);

    sessions.push(session);
    const before = session.output();
    const error = errorOf(await run(session, name, args));

    expect(error?.code).toBe('COMMAND_UNAVAILABLE');
    expect(session.output()).toEqual(before);
  });

  it('lists the comment commands as unavailable, for the host to turn on', async () => {
    const session = open(seed(), false);

    sessions.push(session);
    const tools = await session.describe({ tool: 'database' });
    const listed = 'commands' in tools ? tools.commands.filter(command => command.name.endsWith('Comment')) : [];

    expect(listed.map(command => [command.name, command.available]).sort()).toEqual(WRITES.map(([name]) => [name, false]).sort());
  });

  it('writes comments once the host says it keeps built-in comments', async () => {
    const session = open(seed(), true);

    sessions.push(session);
    expect(errorOf(await run(session, 'database.replyToComment', { id: 'D', threadId: 'theirs', text: 'Seen' }))).toBeUndefined();
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

  it.each(WRITES)('refuses %s unless the host says it keeps built-in comments', async (name, args) => {
    const output = await executeWire({ document: seed(), actor, batch: { commands: [{ name, args }] } });

    expect(output.result).toMatchObject({ ok: false, error: { code: 'COMMAND_UNAVAILABLE' } });
    expect(output.edits ?? []).toEqual([]);
  });

  it('writes a reply when the host says it keeps built-in comments', async () => {
    const output = await executeWire({
      document: seed(), actor, comments: true,
      batch: { commands: [{ name: 'database.replyToComment', args: { id: 'D', threadId: 'theirs', text: 'Seen' } }] },
    });

    expect(output.result).toMatchObject({ ok: true });
  });
});
