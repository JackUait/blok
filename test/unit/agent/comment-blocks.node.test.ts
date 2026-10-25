// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openJsonSession, openStoreSession } from './harness';
import type { OutputData } from '../../../types';
import type { AgentSession } from '../../../types/agent';

const COMMENT = /^Block "c1" is a database-comment block, a comment people left\. Agents do not read or write comments\.$/;

/** A database with one row, and a comment thread on that row, as the row panel saves it. */
const seed = async (): Promise<OutputData> => {
  const session = openJsonSession({ blocks: [] });
  const made = await session.execute({ commands: [{ name: 'database.create', args: { title: 'Tasks', view: 'table' } }] });

  if (!made.ok) throw new Error(made.error.message);
  const dbId = (made.results[0] as { id: string }).id;
  const added = await session.execute({ commands: [{ name: 'database.addRow', args: { id: dbId, values: {} } }] });

  if (!added.ok) throw new Error(added.error.message);
  const rowId = (added.results[0] as { rowId: string }).rowId;
  const doc = structuredClone(session.output());
  const row = doc.blocks.find((block) => block.id === rowId);

  if (row === undefined) throw new Error('no row');
  row.content = [...row.content ?? [], 'c1'];
  doc.blocks.push({ id: 'c1', type: 'database-comment', parent: rowId, data: { text: 'Please fix this' } });

  return doc;
};

describe.each([
  ['json', openJsonSession],
  ['store', openStoreSession],
] as const)('a comment thread named by id (%s session)', (_runtime, open) => {
  const sessions: AgentSession[] = [];
  const start = async (): Promise<AgentSession> => {
    const session = open(await seed());

    sessions.push(session);

    return session;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await Promise.all(sessions.splice(0).map((session) => session.close?.()));
    vi.restoreAllMocks();
  });

  it('refuses a read of it as a comment, not an empty answer', async () => {
    const session = await start();
    const result = await session.execute({ commands: [{ name: 'doc.read', args: { ids: ['c1'] } }] });

    expect(result).toMatchObject({ ok: false, error: { code: 'ANNOTATION_BLOCK', message: expect.stringMatching(COMMENT) } });
  });

  it.each<[`${string}.${string}`, Record<string, unknown>]>([
    ['block.update', { id: 'c1', data: { text: 'edited' } }],
    ['block.delete', { id: 'c1' }],
  ])('refuses %s on it as a comment, not a missing block', async (name, args) => {
    const session = await start();
    const result = await session.execute({ commands: [{ name, args }] });

    expect(result).toMatchObject({ ok: false, error: { code: 'ANNOTATION_BLOCK', message: expect.stringMatching(COMMENT), details: { id: 'c1' } } });
  });
});
