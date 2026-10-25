// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dataOf, errorOf, property, row, run, seedOf, SESSIONS, valuesOf } from './database-seed';

import type { OutputData } from '../../../types';

const seed = (locked: boolean): OutputData => seedOf([{
  id: 'D',
  schema: [property('dt', 'title', locked ? { databaseLocked: true } : {}), property('tx', 'text')],
  rows: [row('r', { dt: 'r' }, { 'reactions:agent-test': { '👍': 1 }, 'reactions:u1': { '🎉': 2 } })],
}], [
  { id: 'thread', type: 'database-comment', data: { text: 'hello', createdAt: 1, authorId: 'u1', authorName: 'Jack' }, parent: 'r' },
]);

const AUTOMATION = { version: 1, definitions: [{ id: 'a1', name: 'New', status: 'active', scope: { type: 'database' }, triggerMode: 'any', triggers: [{ id: 't1', type: 'pageAdded' }], actions: [] }] };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(SESSIONS)('database lock, comments and reactions (%s session)', (_label, open) => {
  it.each([
    ['automations', AUTOMATION],
    ['hideDataSourceTitles', true],
  ])('a locked database refuses a block.update of %s', async (field, value) => {
    const session = open(seed(true));
    const error = errorOf(await run(session, 'block.update', { id: 'D', data: { [field]: value } }));

    expect(error?.code).toBe('DATA_REJECTED');
    expect(error?.message).toContain('locked');
    expect(await dataOf(session, 'D')).not.toHaveProperty(field);
    await session.close();
  });

  it('an unlocked database takes automations, and a locked one still takes its title and row values', async () => {
    const unlocked = open(seed(false));

    expect(errorOf(await run(unlocked, 'block.update', { id: 'D', data: { automations: AUTOMATION } }))).toBeUndefined();
    await unlocked.close();

    const locked = open(seed(true));

    expect(errorOf(await run(locked, 'block.update', { id: 'D', data: { title: 'Tasks' } }))).toBeUndefined();
    expect(errorOf(await run(locked, 'database.setRowValues', { id: 'D', rowId: 'r', values: { tx: 'still writable' } }))).toBeUndefined();
    await locked.close();
  });

  it('refuses an agent comment, so no comment claims a person wrote it', async () => {
    const session = open(seed(false));
    const error = errorOf(await run(session, 'block.insert', {
      type: 'database-comment', parentId: 'r', data: { text: 'forged', createdAt: 1, authorId: 'u1', authorName: 'Jack' },
    }));

    expect(error?.code).toBe('COMMAND_UNAVAILABLE');
    expect(error?.message).toContain('people write');
    await session.close();
  });

  it.each([
    ['block.update', { id: 'thread', data: { text: 'edited' } }],
    ['block.delete', { id: 'thread' }],
    ['block.insert', { type: 'database-comment', parentId: 'thread', data: { text: 'reply', createdAt: 1 } }],
  ])('%s on a comment thread is refused: agents cannot see comments', async (name, args) => {
    const session = open(seed(false));

    expect(errorOf(await run(session, name, args))?.code).toBe('BLOCK_NOT_FOUND');
    expect(await dataOf(session, 'thread')).toBeUndefined();
    await session.close();
  });

  it('writes the agent\'s own feed reactions and refuses another person\'s', async () => {
    const session = open(seed(false));

    expect(errorOf(await run(session, 'block.update', { id: 'r', data: { 'reactions:agent-test': { '👍': 1, '🚀': 3 } } }))).toBeUndefined();
    const error = errorOf(await run(session, 'block.update', { id: 'r', data: { 'reactions:u1': null } }));

    expect(error?.code).toBe('FIELD_NOT_WRITABLE');
    expect(await dataOf(session, 'r')).toMatchObject({ 'reactions:u1': { '🎉': 2 }, 'reactions:agent-test': { '🚀': 3 } });
    expect(await valuesOf(session, 'r')).toEqual({ dt: 'r' });
    await session.close();
  });
});
