import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveDynamicValue, resolveDynamicProperties } from '../../../../src/tools/database/dynamic-values';
import { runButtonActions } from '../../../../src/tools/database/database-button';
import type { ButtonHost } from '../../../../src/tools/database/database-button';
import type { ButtonAction, PropertyValue } from '../../../../src/tools/database/types';

const NOW = new Date(2026, 9, 9, 14, 5);

const host = (): ButtonHost & { log: string[] } => {
  const log: string[] = [];

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
  };
};

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
