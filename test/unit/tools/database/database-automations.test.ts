import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DatabaseAutomationContext, DatabaseAutomationTrigger } from '../../../../src/tools/database/types';
import { DatabaseHostLevers } from '../../../../src/tools/database/database-host-levers';
import type { HostLeverTarget } from '../../../../src/tools/database/database-host-levers';
import { buildTool, commitCell, fakeRow, makeDoc } from './tier3-harness';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

/** propertyEdited waits for edits to settle (500ms). */
const settle = async (): Promise<void> => {
  vi.advanceTimersByTime(500);
  await flush();
};

const clickAddRow = (el: HTMLElement): void => {
  el.querySelector<HTMLElement>('[data-blok-database-table-add-row]')?.click();
};

describe('DatabaseTool — config.automations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('a row added from the view fires pageAdded once, with its id and values', async () => {
    const doc = makeDoc([]);
    const onTrigger = vi.fn();
    const { el } = buildTool(doc, { automations: { onTrigger } });

    clickAddRow(el);
    await flush();

    expect(onTrigger).toHaveBeenCalledTimes(1);
    const [trigger, ctx] = onTrigger.mock.calls[0] as [DatabaseAutomationTrigger, DatabaseAutomationContext];

    expect(trigger.type).toBe('pageAdded');
    expect(trigger.rowId).toBe(doc.order[0]);
    expect(ctx.databaseId).toBe('db');
  });

  it('a value edit fires propertyEdited with the property and the new value', async () => {
    vi.useFakeTimers();
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha' }, 'a0')]);
    const onTrigger = vi.fn();
    const { tool } = buildTool(doc, { automations: { onTrigger } });

    commitCell(tool, 'a', 'notes', 'hello');
    await settle();

    expect(onTrigger).toHaveBeenCalledWith({ type: 'propertyEdited', rowId: 'a', propertyId: 'notes', value: 'hello' }, expect.anything());
  });

  it('drops a pending property trigger when its replacement edit is locked', async () => {
    vi.useFakeTimers();
    let allowed = true;
    const triggers: DatabaseAutomationTrigger[] = [];
    const target = {
      databaseId: 'db',
      isDestroyed: () => false,
      canTriggerAutomations: () => allowed,
      schema: () => [],
      rowValues: () => ({}),
      writeHostValues: () => true,
      addRow: () => true,
      matchesView: () => true,
    };
    const levers = new DatabaseHostLevers(target, {
      onTrigger: (trigger) => { triggers.push(trigger); },
    }, undefined);

    try {
      levers.updated({ rowId: 'a', properties: { notes: 'A' } });
      await vi.advanceTimersByTimeAsync(200);
      allowed = false;
      levers.updated({ rowId: 'a', properties: { notes: 'B' } });
      allowed = true;
      await vi.advanceTimersByTimeAsync(500);

      expect(triggers).toEqual([]);

      levers.updated({ rowId: 'a', properties: { notes: 'C' } });
      await vi.advanceTimersByTimeAsync(500);

      expect(triggers).toEqual([
        { type: 'propertyEdited', rowId: 'a', propertyId: 'notes', value: 'C' },
      ]);
    } finally {
      levers.destroy();
    }
  });

  it('drops an unlocked edit trigger when the database is locked at delivery', async () => {
    vi.useFakeTimers();
    let allowed = true;
    const triggers: DatabaseAutomationTrigger[] = [];
    const target = {
      databaseId: 'db',
      isDestroyed: () => false,
      canTriggerAutomations: () => allowed,
      schema: () => [],
      rowValues: () => ({}),
      writeHostValues: () => true,
      addRow: () => true,
      matchesView: () => true,
    };
    const levers = new DatabaseHostLevers(target, {
      onTrigger: (trigger) => { triggers.push(trigger); },
    }, undefined);

    try {
      levers.updated({ rowId: 'a', properties: { notes: 'A' } });
      await vi.advanceTimersByTimeAsync(200);
      allowed = false;
      await vi.advanceTimersByTimeAsync(500);

      expect(triggers).toEqual([]);
    } finally {
      levers.destroy();
    }
  });

  it('drops a queued pageAdded when the database locks before callback delivery', async () => {
    let allowed = true;
    const triggers: DatabaseAutomationTrigger[] = [];
    const target: HostLeverTarget & { canTriggerAutomations(): boolean } = {
      databaseId: 'db',
      isDestroyed: () => false,
      canTriggerAutomations: () => allowed,
      schema: () => [],
      rowValues: () => ({}),
      writeHostValues: () => true,
      addRow: () => true,
      matchesView: () => true,
    };
    const levers = new DatabaseHostLevers(target, {
      onTrigger: (trigger) => { triggers.push(trigger); },
    }, undefined);

    try {
      levers.created({ id: 'a', properties: { title: 'Before lock' } });
      allowed = false;
      await flush();

      expect(triggers).toEqual([]);

      allowed = true;
      levers.created({ id: 'b', properties: { title: 'After unlock' } });
      await flush();

      expect(triggers).toEqual([
        { type: 'pageAdded', rowId: 'b', properties: { title: 'After unlock' } },
      ]);
    } finally {
      levers.destroy();
    }
  });

  it('typing fires one propertyEdited once the edits settle, with the last value', async () => {
    vi.useFakeTimers();
    const onTrigger = vi.fn();
    const target: HostLeverTarget = {
      databaseId: 'db',
      isDestroyed: () => false,
      schema: () => [],
      rowValues: () => ({}),
      writeHostValues: () => true,
      addRow: () => true,
      matchesView: () => true,
    };
    const levers = new DatabaseHostLevers(target, { onTrigger }, undefined);

    ['H', 'He', 'Hey'].forEach((title) => levers.updated({ rowId: 'a', properties: { title } }));
    await flush();
    expect(onTrigger).not.toHaveBeenCalled();

    await settle();

    expect(onTrigger).toHaveBeenCalledTimes(1);
    expect(onTrigger).toHaveBeenCalledWith({ type: 'propertyEdited', rowId: 'a', propertyId: 'title', value: 'Hey' }, expect.anything());
    levers.destroy();
  });

  it('a row a peer, undo or redo brings in fires nothing', async () => {
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha' }, 'a0')]);
    const onTrigger = vi.fn();

    buildTool(doc, { automations: { onTrigger } });
    const peer = fakeRow('b', 'db', { title: 'From a peer' }, 'a1');

    doc.rows.set('b', peer);
    doc.order.push('b');
    doc.api.events.emit('block changed', { event: { detail: { target: { id: 'b', name: 'database-row', parentId: 'db' } } } });
    await flush();

    expect(onTrigger).not.toHaveBeenCalled();
  });

  it('ctx.run edits the row as a host value and its write fires no trigger', async () => {
    vi.useFakeTimers();
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha' }, 'a0')]);
    const ran: boolean[] = [];
    const onTrigger = vi.fn((trigger: DatabaseAutomationTrigger, ctx: DatabaseAutomationContext) => {
      if (trigger.type === 'propertyEdited' && trigger.propertyId === 'title') {
        ran.push(ctx.run({ type: 'editProperty', rowId: trigger.rowId, propertyId: 'notes', value: 'triaged' }));
      }
    });
    const { tool } = buildTool(doc, { automations: { onTrigger } });

    commitCell(tool, 'a', 'title', 'Renamed');
    await settle();

    expect(ran).toEqual([true]);
    expect(doc.rows.get('a')?.data.properties.notes).toBe('triaged');
    expect(doc.rows.get('a')?.dispatchChange).toHaveBeenLastCalledWith({ derived: true });
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it('ctx.run adds a page, and reports host-only actions as not run', async () => {
    vi.useFakeTimers();
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha' }, 'a0')]);
    const results: boolean[] = [];
    const onTrigger = vi.fn((_trigger: DatabaseAutomationTrigger, ctx: DatabaseAutomationContext) => {
      results.push(ctx.run({ type: 'addPage', properties: { title: 'Follow-up' } }));
      results.push(ctx.run({ type: 'sendWebhook', url: 'https://example.com/hook' }));
    });
    const { tool } = buildTool(doc, { automations: { onTrigger } });

    commitCell(tool, 'a', 'notes', 'x');
    await settle();

    expect(results).toEqual([true, false]);
    expect([...doc.rows.values()].map((row) => row.data.properties.title)).toContain('Follow-up');
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it('ctx.matchesView says whether the row passes a view\'s filters', async () => {
    vi.useFakeTimers();
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha', notes: 'urgent' }, 'a0')]);
    const seen: boolean[] = [];
    const { tool } = buildTool(doc, {
      automations: {
        onTrigger: (trigger, ctx) => {
          seen.push(ctx.matchesView(trigger.rowId, 'v'));
        },
      },
    });

    commitCell(tool, 'a', 'notes', 'urgent now');
    await settle();

    expect(seen).toEqual([true]);
  });
});
