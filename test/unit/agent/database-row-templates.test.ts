// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dataOf, errorOf, property, row, run, seedOf, SESSIONS, valuesOf } from './database-seed';

import type { AgentResult, AgentSession, OutputData } from '../../../types';

const OPTIONS = { options: [{ id: 'o-a', label: 'A', position: 'a0' }, { id: 'o-b', label: 'B', position: 'a1' }] };

const seed = (): OutputData => seedOf([{
  id: 'T',
  schema: [
    property('tt', 'title', { defaultTemplateId: 'tpl' }),
    property('st', 'status', { config: OPTIONS, status: { defaultOptionId: 'o-b' } }),
    property('pp', 'person', { person: { default: 'createdBy' } }),
    property('tx', 'text'),
    property('dd', 'date'),
  ],
  rows: [
    row('r1', { tt: '', st: 'o-a', pp: [], tx: 'keep' }),
    row('r2', { tt: 'Busy', st: 'o-a', pp: [] }),
    row('tpl', { tt: 'Bug', tx: 'from template', dd: '@today', pp: [] }, {
      template: true, title: 'Bug', icon: '🐞', cover: 'https://example.com/c.png', reminders: { dd: { remind: 'on_day_of_event', sentFor: '2020-01-01T09:00:00.000Z' } },
    }),
    row('tpl2', { tt: 'Task', st: 'o-a', pp: [] }, { template: true, title: 'Task' }),
  ],
}], [
  { id: 'body', type: 'paragraph', data: { text: 'Template body' }, parent: 'tpl' },
  { id: 'note', type: 'database-comment', data: { text: 'a comment', createdAt: 1 }, parent: 'tpl' },
  { id: 'r2-body', type: 'paragraph', data: { text: 'Already written' }, parent: 'r2' },
]);

const rowIdOf = (result: AgentResult): string => {
  const value = result.ok ? result.results[0] : undefined;

  return typeof value === 'object' && value !== null && 'rowId' in value ? String(value.rowId) : '';
};

const childrenOf = async (session: AgentSession, id: string): Promise<Array<{ type: string; text?: string }>> =>
  (await session.read({ detail: 'full' })).blocks.filter(block => block.parentId === id).map(block => ({ type: block.type, text: block.text }));

const DAY = /^\d{4}-\d{2}-\d{2}$/;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(SESSIONS)('database row templates (%s session)', (_label, open) => {
  it('addRow starts from the default template, as the toolbar New does', async () => {
    const session = open(seed());
    const result = await run(session, 'database.addRow', { id: 'T' });

    expect(errorOf(result)).toBeUndefined();
    const rowId = rowIdOf(result);
    const data = await dataOf(session, rowId);

    expect(data).toMatchObject({ title: 'Bug', icon: '🐞', cover: 'https://example.com/c.png', reminders: { dd: { remind: 'on_day_of_event' } } });
    expect(data?.reminders).toEqual({ dd: { remind: 'on_day_of_event' } });
    expect(await valuesOf(session, rowId)).toMatchObject({ tt: 'Bug', tx: 'from template', st: 'o-b', pp: [{ id: 'human-1' }] });
    expect((await valuesOf(session, rowId)).dd).toMatch(DAY);
    expect(await childrenOf(session, rowId)).toEqual([{ type: 'paragraph', text: 'Template body' }]);
    await session.close();
  });

  it('values the caller gives win over the template, except an empty title', async () => {
    const session = open(seed());
    const named = rowIdOf(await run(session, 'database.addRow', { id: 'T', values: { tt: 'Mine', st: 'o-a' } }));
    const untitled = rowIdOf(await run(session, 'database.addRow', { id: 'T', values: { tt: '' } }));

    expect(await dataOf(session, named)).toMatchObject({ title: 'Mine', properties: { tt: 'Mine', st: 'o-a', tx: 'from template' } });
    expect(await dataOf(session, untitled)).toMatchObject({ title: 'Bug' });
    await session.close();
  });

  it('template null makes an empty page with the defaults and an empty title', async () => {
    const session = open(seed());
    const rowId = rowIdOf(await run(session, 'database.addRow', { id: 'T', template: null }));
    const data = await dataOf(session, rowId);

    expect(data).toMatchObject({ title: '', properties: { st: 'o-b', pp: [{ id: 'human-1' }] } });
    expect(data).not.toHaveProperty('icon');
    expect(await childrenOf(session, rowId)).toEqual([]);
    await session.close();
  });

  it('template names the template to start from', async () => {
    const session = open(seed());
    const rowId = rowIdOf(await run(session, 'database.addRow', { id: 'T', template: 'tpl2' }));

    expect(await dataOf(session, rowId)).toMatchObject({ title: 'Task', properties: { tt: 'Task', st: 'o-a' } });
    expect(errorOf(await run(session, 'database.addRow', { id: 'T', template: 'r1' }))?.code).toBe('PRECONDITION_FAILED');
    await session.close();
  });

  it('applyTemplate fills only what the row leaves empty and copies the body', async () => {
    const session = open(seed());

    expect(errorOf(await run(session, 'database.applyTemplate', { id: 'T', rowId: 'r1', templateId: 'tpl' }))).toBeUndefined();
    expect(await dataOf(session, 'r1')).toMatchObject({ title: 'Bug', icon: '🐞', properties: { tt: 'Bug', tx: 'keep', st: 'o-a' } });
    expect(await childrenOf(session, 'r1')).toEqual([{ type: 'paragraph', text: 'Template body' }]);
    await session.close();
  });

  it('applyTemplate refuses a row whose page already has content', async () => {
    const session = open(seed());

    expect(errorOf(await run(session, 'database.applyTemplate', { id: 'T', rowId: 'r2', templateId: 'tpl' }))?.code).toBe('PRECONDITION_FAILED');
    await session.close();
  });
});
