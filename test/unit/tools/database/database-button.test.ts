import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveDynamicValue, resolveDynamicProperties } from '../../../../src/tools/database/dynamic-values';
import { askConfirmations, runButtonActions } from '../../../../src/tools/database/database-button';
import { defaultFilterFor } from '../../../../src/tools/database/database-filter-labels';
import type { ButtonHost } from '../../../../src/tools/database/database-button';
import type { ButtonAction, DatabaseRow, PropertyDefinition, PropertyValue } from '../../../../src/tools/database/types';

const NOW = new Date(2026, 9, 9, 14, 5);

const host = (): ButtonHost & { log: string[] } => {
  const log: string[] = [];
  const added = { count: 0 };

  return {
    log,
    oneStep: vi.fn((fn: () => void) => {
      log.push('transact:start');
      fn();
      log.push('transact:end');
    }),
    writeValues: vi.fn((rowId: string, changes: Record<string, PropertyValue>) => log.push(`write:${rowId}:${JSON.stringify(changes)}`)),
    insertBlocks: vi.fn((rowId: string, blocks: Array<{ type: string }>) => log.push(`insert:${rowId}:${blocks.map((b) => b.type).join(',')}`)),
    openRow: vi.fn((rowId: string) => log.push(`open:${rowId}`)),
    openUrl: vi.fn((url: string) => log.push(`url:${url}`)),
    callback: vi.fn((action) => log.push(`callback:${action.name ?? ''}`)),
    me: () => 'u1',
    now: () => NOW,
    addPage: vi.fn((databaseId: string | undefined, name: string, properties: Record<string, PropertyValue>) => {
      log.push(`add:${databaseId ?? 'self'}:${name}:${JSON.stringify(properties)}`);

      added.count += 1;

      return `new-${added.count}`;
    }),
    source: vi.fn(() => undefined),
    rowValues: vi.fn(() => undefined),
    notify: vi.fn((action, to: string[], message: string) => log.push(`notify:${to.join(',')}:${message}`)),
    askAgent: vi.fn((message: string) => log.push(`agent:${message}`)),
  };
};

const OTHER_SCHEMA: PropertyDefinition[] = [
  { id: 't', name: 'Name', type: 'title', position: 'a0' },
  { id: 'done', name: 'Done', type: 'checkbox', position: 'a1' },
];
const OTHER_ROWS: DatabaseRow[] = [
  { id: 'o1', position: 'a0', properties: { t: 'Alpha', done: false } },
  { id: 'o2', position: 'a1', properties: { t: 'Beta', done: true } },
  { id: 'o3', position: 'a2', properties: { t: 'Alpine', done: false } },
];

describe('dynamic values', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fills @today with the local day and @now with the local day and time', () => {
    expect(resolveDynamicValue('@today', { me: null, now: NOW })).toBe('2026-10-09');
    expect(resolveDynamicValue('@now', { me: null, now: NOW })).toBe('2026-10-09T14:05');
  });

  it('fills @me in a person value and drops it when there is no current user', () => {
    expect(resolveDynamicValue([{ id: '@me' }, { id: 'u2' }], { me: 'u1', now: NOW })).toEqual([{ id: 'u1' }, { id: 'u2' }]);
    expect(resolveDynamicValue([{ id: '@me' }], { me: null, now: NOW })).toEqual([]);
  });

  it('leaves every other value alone', () => {
    expect(resolveDynamicValue('Ship', { me: 'u1', now: NOW })).toBe('Ship');
    expect(resolveDynamicValue(3, { me: 'u1', now: NOW })).toBe(3);
    expect(resolveDynamicProperties({ a: '@today', b: 'x' }, { me: null, now: NOW })).toEqual({ a: '2026-10-09', b: 'x' });
  });
});

describe('runButtonActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs every row write inside one transact, in order', () => {
    const h = host();
    const actions: ButtonAction[] = [
      { id: '1', type: 'editProperty', propertyId: 'status', value: 'done' },
      { id: '2', type: 'insertBlocks', blocks: [{ id: 'b', type: 'paragraph', data: { text: 'Hi' } }] },
      { id: '3', type: 'editProperty', propertyId: 'due', value: '@today' },
    ];

    runButtonActions(actions, 'r1', h);

    expect(h.oneStep).toHaveBeenCalledTimes(1);
    expect(h.log).toEqual([
      'transact:start',
      'write:r1:{"status":"done"}',
      'insert:r1:paragraph',
      'write:r1:{"due":"2026-10-09"}',
      'transact:end',
    ]);
  });

  it('opens a page and calls the host only after the writes', () => {
    const h = host();

    runButtonActions([
      { id: '1', type: 'openPage' },
      { id: '2', type: 'callback', name: 'webhook' },
      { id: '3', type: 'openPage', url: 'https://example.com' },
      { id: '4', type: 'editProperty', propertyId: 'owner', value: [{ id: '@me' }] },
    ], 'r1', h);

    expect(h.log).toEqual([
      'transact:start',
      'write:r1:{"owner":[{"id":"u1"}]}',
      'transact:end',
      'open:r1',
      'callback:webhook',
      'url:https://example.com',
    ]);
  });

  it('skips the transact when no action writes', () => {
    const h = host();

    runButtonActions([{ id: '1', type: 'openPage' }], 'r1', h);

    expect(h.oneStep).not.toHaveBeenCalled();
    expect(h.log).toEqual(['open:r1']);
  });

  it('ignores an action it does not know, from a newer client', () => {
    const h = host();

    runButtonActions([{ id: '1', type: 'sendMail' } as unknown as ButtonAction], 'r1', h);

    expect(h.log).toEqual([]);
  });
});

describe('runButtonActions — Notion actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adds a page to a database with its name and property edits, in the same transact', () => {
    const h = host();

    runButtonActions([
      { id: '1', type: 'editProperty', propertyId: 'status', value: 'done' },
      { id: '2', type: 'addPage', databaseId: 'other', name: 'Follow-up', edits: [{ id: 'e', propertyId: 'due', value: '@today' }] },
      { id: '3', type: 'addPage' },
    ], 'r1', h);

    expect(h.oneStep).toHaveBeenCalledTimes(1);
    expect(h.log).toEqual([
      'transact:start',
      'write:r1:{"status":"done"}',
      'add:other:Follow-up:{"due":"2026-10-09"}',
      'add:self::{}',
      'transact:end',
    ]);
  });

  it('edits this page, the page an earlier step added, and the pages of a database that match its filters', () => {
    const h = host();

    vi.mocked(h.source).mockImplementation((databaseId) => (databaseId === 'other' ? { schema: OTHER_SCHEMA, rows: OTHER_ROWS } : undefined));
    runButtonActions([
      { id: 'add', type: 'addPage', databaseId: 'other' },
      { id: '2', type: 'editPages', target: { type: 'thisPage' }, edits: [{ id: 'e1', propertyId: 'status', value: 'x' }] },
      { id: '3', type: 'editPages', target: { type: 'addedPage', stepId: 'add' }, edits: [{ id: 'e2', propertyId: 'done', value: true }] },
      {
        id: '4', type: 'editPages',
        target: { type: 'database', databaseId: 'other', filters: [{ propertyId: 't', operator: 'contains', value: 'Alp' }] },
        edits: [{ id: 'e3', propertyId: 'done', value: true }],
      },
    ], 'r1', h);

    expect(h.writeValues).toHaveBeenCalledWith('r1', { status: 'x' }, undefined);
    expect(h.writeValues).toHaveBeenCalledWith('new-1', { done: true }, 'other');
    expect(h.writeValues).toHaveBeenCalledWith('o1', { done: true }, 'other');
    expect(h.writeValues).toHaveBeenCalledWith('o3', { done: true }, 'other');
    expect(h.writeValues).not.toHaveBeenCalledWith('o2', expect.anything(), 'other');
    expect(h.oneStep).toHaveBeenCalledTimes(1);
  });

  it('edits every page of a database when it has no filter', () => {
    const h = host();

    vi.mocked(h.source).mockReturnValue({ schema: OTHER_SCHEMA, rows: OTHER_ROWS });
    runButtonActions([
      { id: '1', type: 'editPages', target: { type: 'database', databaseId: 'other' }, edits: [{ id: 'e', propertyId: 'done', value: true }] },
    ], 'r1', h);

    expect(vi.mocked(h.writeValues).mock.calls.map((call) => call[0])).toEqual(['o1', 'o2', 'o3']);
  });

  it('edits every page while each filter rule still has no value, as the "All pages" label says (research/17 §3c)', () => {
    const h = host();
    const schema: PropertyDefinition[] = [
      ...OTHER_SCHEMA,
      { id: 'stage', name: 'Stage', type: 'select', position: 'a2', config: { options: [{ id: 's1', label: 'One', position: 'a0' }] } },
      { id: 'hours', name: 'Hours', type: 'number', position: 'a3' },
    ];

    vi.mocked(h.source).mockReturnValue({ schema, rows: OTHER_ROWS });
    runButtonActions([{
      id: '1', type: 'editPages',
      target: { type: 'database', databaseId: 'other', filters: [defaultFilterFor(schema[0]), defaultFilterFor(schema[2]), defaultFilterFor(schema[3])] },
      edits: [{ id: 'e', propertyId: 'done', value: true }],
    }], 'r1', h);

    expect(vi.mocked(h.writeValues).mock.calls.map((call) => call[0])).toEqual(['o1', 'o2', 'o3']);
  });

  it('skips an edit-pages step whose added page never came: its step is gone', () => {
    const h = host();

    runButtonActions([
      { id: '2', type: 'editPages', target: { type: 'addedPage', stepId: 'missing' }, edits: [{ id: 'e', propertyId: 'done', value: true }] },
    ], 'r1', h);

    expect(h.writeValues).not.toHaveBeenCalled();
  });

  it('asks each confirmation in order and keeps every action when all are confirmed', async () => {
    const confirm = vi.fn(() => Promise.resolve(true));
    const actions: ButtonAction[] = [
      { id: '1', type: 'editProperty', propertyId: 'a', value: 'x' },
      { id: '2', type: 'showConfirmation', message: 'Sure?' },
      { id: '3', type: 'showConfirmation', message: 'Really?' },
    ];

    expect(await askConfirmations(actions, confirm)).toEqual(actions);
    expect(confirm.mock.calls.map((call: unknown[]) => (call[0] as { message?: string }).message)).toEqual(['Sure?', 'Really?']);
  });

  it('drops the cancelled confirmation and every action after it, asking nothing more', async () => {
    const confirm = vi.fn(() => Promise.resolve(false));
    const kept = await askConfirmations([
      { id: '1', type: 'editProperty', propertyId: 'a', value: 'x' },
      { id: '2', type: 'showConfirmation' },
      { id: '3', type: 'editProperty', propertyId: 'b', value: 'y' },
      { id: '4', type: 'showConfirmation' },
    ], confirm);

    expect(kept.map((action) => action.id)).toEqual(['1']);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('runs a kept confirmation as nothing: it only gates', () => {
    const h = host();

    runButtonActions([{ id: '1', type: 'showConfirmation' }, { id: '2', type: 'editProperty', propertyId: 'a', value: 'x' }], 'r1', h);

    expect(h.log).toEqual(['transact:start', 'write:r1:{"a":"x"}', 'transact:end']);
  });

  it('sends a notification to specific people or to the people of a person property, after the writes', () => {
    const h = host();

    vi.mocked(h.rowValues).mockReturnValue({ owner: [{ id: 'u7' }, { id: 'u8' }] });
    runButtonActions([
      { id: '1', type: 'sendNotification', recipients: { type: 'people', people: [{ id: 'u2' }] }, message: 'Hi' },
      { id: '2', type: 'sendNotification', recipients: { type: 'property', propertyId: 'owner' } },
      { id: '3', type: 'editProperty', propertyId: 'a', value: 'x' },
    ], 'r1', h);

    expect(h.log).toEqual(['transact:start', 'write:r1:{"a":"x"}', 'transact:end', 'notify:u2:Hi', 'notify:u7,u8:']);
  });

  it('sends no notification without recipients', () => {
    const h = host();

    runButtonActions([
      { id: '1', type: 'sendNotification' },
      { id: '2', type: 'sendNotification', recipients: { type: 'people', people: [] } },
    ], 'r1', h);

    expect(h.notify).not.toHaveBeenCalled();
  });

  it('messages the agent only after the writes commit', () => {
    const h = host();

    runButtonActions([
      { id: '1', type: 'sendAgentMessage', message: 'Summarize this page' },
      { id: '2', type: 'editProperty', propertyId: 'a', value: 'x' },
    ], 'r1', h);

    expect(h.log).toEqual(['transact:start', 'write:r1:{"a":"x"}', 'transact:end', 'agent:Summarize this page']);
  });

  it('sends the agent no empty message', () => {
    const h = host();

    runButtonActions([{ id: '1', type: 'sendAgentMessage' }, { id: '2', type: 'sendAgentMessage', message: '  ' }], 'r1', h);

    expect(h.askAgent).not.toHaveBeenCalled();
  });

  it('opens the page an earlier step added', () => {
    const h = host();

    runButtonActions([{ id: 'add', type: 'addPage' }, { id: '2', type: 'openPage', stepId: 'add' }], 'r1', h);

    expect(h.openRow).toHaveBeenCalledWith('new-1', undefined);
  });

  it('only stores variables: running them writes nothing', () => {
    const h = host();

    runButtonActions([{ id: '1', type: 'defineVariables', variables: [{ id: 'v', name: 'Variable 1', kind: 'formula', value: '1 + 1' }] }], 'r1', h);

    expect(h.log).toEqual([]);
  });
});
