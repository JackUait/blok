// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dataOf, errorOf, property, row, run, seedOf, SESSIONS, valuesOf } from './database-seed';

import type { OutputData } from '../../../types';

const seed = (locked: boolean): OutputData => seedOf([{
  id: 'D',
  schema: [property('dt', 'title', locked ? { databaseLocked: true } : {}), property('tx', 'text')],
  rows: [row('r', { dt: 'r' }, { 'reactions:human-1': { '👍': 1 }, 'reactions:u1': { '🎉': 2 } })],
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
    const before = (await dataOf(session, 'D'))?.[field];
    const error = errorOf(await run(session, 'block.update', { id: 'D', data: { [field]: value } }));

    expect(error?.code).toBe('DATA_REJECTED');
    expect(error?.message).toContain('locked');
    expect((await dataOf(session, 'D'))?.[field]).toEqual(before);
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
  ])('%s on a comment thread is refused with ANNOTATION_BLOCK', async (name, args) => {
    const session = open(seed(false));

    expect(errorOf(await run(session, name, args))?.code).toBe('ANNOTATION_BLOCK');
    expect(await dataOf(session, 'thread')).toBeUndefined();
    await session.close();
  });

  it.each([
    ['block.insert at the top level', 'block.insert', { type: 'database-row', data: { properties: {}, position: 'a9', 'reactions:u1': { '🎉': 3 } } }],
    ['block.insert into a row page', 'block.insert', { type: 'paragraph', parentId: 'r', data: { text: 'x', 'reactions:u1': { '🎉': 3 } } }],
    ['setRowValues', 'database.setRowValues', { id: 'D', rowId: 'r', values: { 'reactions:u1': { '🎉': 3 } } }],
    ['addRow', 'database.addRow', { id: 'D', values: { 'reactions:u1': { '🎉': 3 } } }],
  ])('%s cannot write another person\'s reactions', async (_path, name, args) => {
    const session = open(seed(false));

    expect(errorOf(await run(session, name, args))).toBeDefined();
    const forged = (await session.read({ detail: 'full' })).blocks.filter(block => block.id !== 'r' && block.data !== undefined && 'reactions:u1' in block.data);

    expect(forged).toEqual([]);
    expect(await dataOf(session, 'r')).toMatchObject({ 'reactions:u1': { '🎉': 2 } });
    await session.close();
  });

  it.each([
    ['block.move', { id: 'thread', parentId: null, position: 'end' }],
    ['block.duplicate', { id: 'thread' }],
    ['database.setRowValues', { id: 'D', rowId: 'thread', values: { tx: 'x' } }],
    ['database.deleteRow', { id: 'D', rowId: 'thread' }],
  ])('%s on a comment thread is refused', async (name, args) => {
    const session = open(seed(false));

    expect(errorOf(await run(session, name, args))).toBeDefined();
    await session.close();
  });

  it('copying a row leaves its comment thread behind', async () => {
    const session = open(seed(false));
    const before = (await session.read({ detail: 'full' })).blocks.length;

    expect(errorOf(await run(session, 'block.duplicate', { id: 'r' }))).toBeUndefined();
    expect((await session.read({ detail: 'full' })).blocks).toHaveLength(before + 1);
    await session.close();
  });

  it('writes the agent\'s own feed reactions and refuses another person\'s', async () => {
    const session = open(seed(false));

    expect(errorOf(await run(session, 'block.update', { id: 'r', data: { 'reactions:human-1': { '👍': 1, '🚀': 3 } } }))).toBeUndefined();
    const error = errorOf(await run(session, 'block.update', { id: 'r', data: { 'reactions:u1': null } }));

    expect(error?.code).toBe('FIELD_NOT_WRITABLE');
    expect(await dataOf(session, 'r')).toMatchObject({ 'reactions:u1': { '🎉': 2 }, 'reactions:human-1': { '🚀': 3 } });
    expect(await valuesOf(session, 'r')).toEqual({ dt: 'r' });
    await session.close();
  });
});
