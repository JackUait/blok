import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DatabaseData, DatabaseRow, PropertyDefinition } from '../../../../src/tools/database/types';
import { buildDatabase, makeDoc, rowSeed } from './structure-harness';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

interface MockItem { name?: string; element?: HTMLElement; onActivate?: () => void }

const popovers = vi.hoisted(() => ({ items: [] as MockItem[][], made: [] as Array<{ escapeClosesSubmenuFirst: boolean; arrowLeftClosesSubmenu: boolean }> }));

vi.mock('../../../../src/components/utils/popover', () => {
  class MockPopoverDesktop {
    escapeClosesSubmenuFirst = false;

    arrowLeftClosesSubmenu = true;

    constructor(params?: { items?: MockItem[] }) {
      popovers.items.push(params?.items ?? []);
      popovers.made.push(this);
    }

    show(): void {}

    hide(): void {}

    destroy(): void {}

    on(): void {}

    off(): void {}

    getElement(): HTMLElement {
      return document.createElement('div');
    }
  }

  return { PopoverDesktop: MockPopoverDesktop, PopoverMobile: MockPopoverDesktop, PopoverItemType: { Default: 'default', Separator: 'separator', Html: 'html' } };
});

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'due', name: 'Due', type: 'date', position: 'a1' },
  { id: 'owner', name: 'Owner', type: 'person', position: 'a2' },
  { id: 'code', name: 'Code', type: 'uniqueId', position: 'a3' },
];

const data = (titlePatch: Partial<PropertyDefinition> = {}): DatabaseData => ({
  schema: [{ ...schema[0], ...titlePatch }, ...schema.slice(1)],
  views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['due', 'owner', 'code'] }],
  activeViewId: 'v',
});

const seed = (): ReturnType<typeof makeDoc> => makeDoc([
  { id: 'db', name: 'database', parentId: null, data: {} },
  rowSeed('r1', 'db', { properties: { title: 'Real row' }, position: 'a1' }),
  rowSeed('tpl', 'db', { properties: { title: 'Bug report', due: '@today', owner: [{ id: '@me' }] }, position: 'a0', template: true, icon: '🐞', cover: 'https://x.io/c.png' }),
  { id: 'tpl-body', name: 'paragraph', parentId: 'tpl', data: { text: 'Steps to reproduce' } },
]);

const rowIds = (el: HTMLElement): string[] =>
  [...el.querySelectorAll('[data-blok-database-table-row]')].map((row) => row.getAttribute('data-row-id') ?? '');

const people = { list: async () => [{ id: 'u1', name: 'Ann' }], me: () => 'u1' };

describe('DatabaseTool — templates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-09T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('keeps a template out of the view, the relation source and the ID numbering', () => {
    const doc = seed();
    const { tool, el } = buildDatabase(doc, 'db', data());
    const source: DatabaseRow[][] = [];

    tool.readRelationSource({ receive: (s) => source.push(s.rows) });

    expect(rowIds(el)).toEqual(['r1']);
    expect(source[0].map((r) => r.id)).toEqual(['r1']);
    expect(doc.row('tpl').properties.code).toBeUndefined();
    expect(doc.row('r1').properties.code).toBe(1);
    expect(tool.templateList().map((t) => t.id)).toEqual(['tpl']);
  });

  it('makes a row from a template in one undo step: values filled in, icon, cover and body copied', () => {
    const doc = seed();
    const { tool } = buildDatabase(doc, 'db', data(), { people });

    doc.transact.mockClear();
    const id = tool.newFromTemplate('tpl');

    expect(doc.transact).toHaveBeenCalledTimes(1);
    expect(id).not.toBeNull();
    const row = doc.row(id ?? '');

    expect(row.template).toBeUndefined();
    expect(row.properties).toMatchObject({ title: 'Bug report', due: '2026-10-09', owner: [{ id: 'u1' }] });
    expect(row.icon).toBe('🐞');
    expect(row.cover).toBe('https://x.io/c.png');
    const body = doc.childrenOf(id ?? '');

    expect(body).toHaveLength(1);
    expect(body[0]).not.toBe('tpl-body');
    expect(doc.blocks.get(body[0])?.data).toEqual({ text: 'Steps to reproduce' });
    // The template keeps its own body.
    expect(doc.childrenOf('tpl')).toEqual(['tpl-body']);
  });

  it('starts every new row from the default template', () => {
    const doc = seed();
    const { tool } = buildDatabase(doc, 'db', data(), { people });

    tool.setDefaultTemplate('tpl');
    expect(tool.save(document.createElement('div')).schema.find((p) => p.type === 'title')?.defaultTemplateId).toBe('tpl');

    const id = tool.newRow();

    expect(doc.row(id ?? '').properties.due).toBe('2026-10-09');
    expect(doc.childrenOf(id ?? '')).toHaveLength(1);
  });

  it('adds a new template as a hidden row and opens it with a banner', () => {
    const doc = seed();
    const { tool, el } = buildDatabase(doc, 'db', data());

    const id = tool.addTemplate();

    expect(doc.row(id ?? '').template).toBe(true);
    expect(rowIds(el)).toEqual(['r1']);
    expect(document.querySelector('[data-blok-database-template-banner]')).not.toBeNull();
  });

  describe('the banner\'s "Duplicate every…" button', () => {
    const repeatButton = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>('[data-blok-database-template-banner] [data-blok-database-template-repeat]');

    it('sums up the template\'s schedule and follows a change', () => {
      const doc = seed();
      const { tool } = buildDatabase(doc, 'db', data());

      tool.openTemplate('tpl');
      expect(repeatButton()?.textContent).toBe('tools.database.templateRepeatSummaryNone');
      const button = repeatButton();

      tool.setTemplateRepeat('tpl', { frequency: 'weekly', interval: 2, start: '2026-10-09T12:00:00.000Z' });

      expect(repeatButton()?.textContent).toBe('tools.database.templateRepeatSummaryWeeks {"count":2}');
      // The same button: a popover anchored on it stays put while the interval is typed.
      expect(repeatButton()).toBe(button);
    });

    it('leaves the banner\'s status alone when a sync changes nothing it shows', async () => {
      const doc = seed();
      const { tool } = buildDatabase(doc, 'db', data());

      tool.openTemplate('tpl');
      tool.setTemplateRepeat('tpl', { frequency: 'weekly', start: '2026-10-09T12:00:00.000Z' });
      const banner = document.querySelector('[data-blok-database-template-banner]');
      const records: MutationRecord[] = [];
      const observer = new MutationObserver((list) => records.push(...list));

      if (banner === null) throw new Error('no banner');
      observer.observe(banner, { childList: true, subtree: true, characterData: true });
      tool.setTemplateRepeat('tpl', { frequency: 'weekly', start: '2026-10-10T12:00:00.000Z' });
      await Promise.resolve();
      observer.disconnect();

      // A live region that is rewritten is read out again on every keystroke.
      expect(records).toEqual([]);
    });

    it('follows a schedule a peer or undo writes', async () => {
      const doc = seed();
      const { tool } = buildDatabase(doc, 'db', data());
      const entry = doc.blocks.get('tpl');

      if (entry === undefined) throw new Error('no template');
      tool.openTemplate('tpl');
      entry.data = { ...entry.data, repeat: { frequency: 'daily', start: '2026-10-09T12:00:00.000Z' } };
      doc.api.events.emit('block changed', { event: { detail: { target: entry.block } } });
      await Promise.resolve();

      expect(repeatButton()?.textContent).toBe('tools.database.templateRepeatSummaryDay');
    });

    it('has a chevron after its label', () => {
      const { tool } = buildDatabase(seed(), 'db', data());

      tool.openTemplate('tpl');

      expect(repeatButton()?.querySelector('svg') ?? null).not.toBeNull();
      expect(repeatButton()?.textContent).toBe('tools.database.templateRepeatSummaryNone');
    });

    it('a preset opens Edit cadence; only Save stores the schedule', async () => {
      const doc = seed();
      const { tool } = buildDatabase(doc, 'db', data());
      const item = (name: string): MockItem | undefined => popovers.items.at(-1)?.find((entry) => entry.name === name);

      tool.openTemplate('tpl');
      repeatButton()?.click();
      item('template-repeat-weekday')?.onActivate?.();
      await Promise.resolve();
      const cadence = item('template-repeat-cadence')?.element;

      expect(cadence?.hasAttribute('data-blok-database-template-cadence')).toBe(true);
      expect((doc.blocks.get('tpl')?.data as { repeat?: unknown }).repeat).toBeUndefined();
      expect(repeatButton()?.textContent).toBe('tools.database.templateRepeatSummaryNone');
      cadence?.querySelector<HTMLButtonElement>('[data-blok-database-template-cadence-save]')?.click();

      expect((doc.blocks.get('tpl')?.data as { repeat?: unknown }).repeat).toMatchObject({ frequency: 'weekly', weekdays: [1, 2, 3, 4, 5] });
      expect(repeatButton()?.textContent).toBe('tools.database.templateRepeatSummaryWeekday');
    });

    it('is not on a row page', () => {
      const doc = seed();
      const { tool } = buildDatabase(doc, 'db', data());

      tool.openTemplate('tpl');
      tool.openRow({ rowId: 'r1' });

      expect(repeatButton()).toBeNull();
    });
  });

  it('the toolbar "New" makes a row from the default template and opens it', () => {
    const doc = seed();
    const { el } = buildDatabase(doc, 'db', data({ defaultTemplateId: 'tpl' }), { people });
    const before = doc.childrenOf('db').length;

    el.querySelector<HTMLButtonElement>('[data-blok-testid="database-toolbar-new"]')?.click();

    const made = doc.childrenOf('db').slice(before);

    expect(made).toHaveLength(1);
    expect(doc.row(made[0]).properties.title).toBe('Bug report');
    expect(el.querySelector('[data-blok-testid="database-toolbar-new-menu"]')).not.toBeNull();
  });

  // research/35 §14: Escape in a template's "…" submenu closes only that submenu; the templates menu stays.
  it('the New menu closes a template\'s submenu first on Escape', () => {
    const { el } = buildDatabase(seed(), 'db', data(), { people });

    popovers.made.length = 0;
    el.querySelector<HTMLButtonElement>('[data-blok-testid="database-toolbar-new-menu"]')?.click();

    expect(popovers.made.at(-1)?.escapeClosesSubmenuFirst).toBe(true);
  });

  // research/36 §3.1: ArrowLeft leaves a template's "…" submenu open; only Escape closes it.
  it('ArrowLeft does not close a template\'s submenu in the New menu', () => {
    const { el } = buildDatabase(seed(), 'db', data(), { people });

    popovers.made.length = 0;
    el.querySelector<HTMLButtonElement>('[data-blok-testid="database-toolbar-new-menu"]')?.click();

    expect(popovers.made.at(-1)?.arrowLeftClosesSubmenu).toBe(false);
  });

  it('deleting the default template clears the default', () => {
    const doc = seed();
    const { tool } = buildDatabase(doc, 'db', data({ defaultTemplateId: 'tpl' }));

    tool.deleteTemplate('tpl');

    expect(doc.deleted).toContain('tpl');
    expect(tool.save(document.createElement('div')).schema.find((p) => p.type === 'title')?.defaultTemplateId).toBeUndefined();
  });

  it('asks the host to run a repeating template that is due, and stamps the run', () => {
    const doc = makeDoc([
      { id: 'db', name: 'database', parentId: null, data: {} },
      rowSeed('tpl', 'db', { properties: { title: 'Standup' }, template: true, repeat: { frequency: 'daily', start: '2026-10-01T09:00:00.000Z', lastRunAt: '2026-10-07T09:00:00.000Z' } }),
    ]);
    const onRepeatDue = vi.fn();

    buildDatabase(doc, 'db', data(), { templates: { onRepeatDue } });

    expect(onRepeatDue).toHaveBeenCalledTimes(1);
    const call = onRepeatDue.mock.calls[0][0] as { templateId: string; dueAt: string; createRow: () => string | null };

    expect(call.templateId).toBe('tpl');
    expect(call.dueAt).toBe('2026-10-09T09:00:00.000Z');
    const made = call.createRow();

    expect(doc.row(made ?? '').properties.title).toBe('Standup');
    expect(doc.row('tpl').repeat?.lastRunAt).toBe('2026-10-09T09:00:00.000Z');
  });

  it('does not ask again for a run already made', () => {
    const doc = makeDoc([
      { id: 'db', name: 'database', parentId: null, data: {} },
      rowSeed('tpl', 'db', { properties: { title: 'Standup' }, template: true, repeat: { frequency: 'weekly', start: '2026-10-05T09:00:00.000Z', lastRunAt: '2026-10-05T09:00:00.000Z' } }),
    ]);
    const onRepeatDue = vi.fn();

    buildDatabase(doc, 'db', data(), { templates: { onRepeatDue } });

    expect(onRepeatDue).not.toHaveBeenCalled();
  });
});

describe('DatabaseTool — a repeating template that comes due while open', () => {
  const standup = (): ReturnType<typeof makeDoc> => makeDoc([
    { id: 'db', name: 'database', parentId: null, data: {} },
    rowSeed('tpl', 'db', { properties: { title: 'Standup' }, template: true, repeat: { frequency: 'daily', start: '2026-10-01T09:00:00.000Z', lastRunAt: '2026-10-08T09:00:00.000Z' } }),
  ]);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-09T08:55:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('is offered at its run time, without a re-render', () => {
    const onRepeatDue = vi.fn();

    buildDatabase(standup(), 'db', data(), { templates: { onRepeatDue } });
    expect(onRepeatDue).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5 * 60_000);

    expect(onRepeatDue).toHaveBeenCalledTimes(1);
    expect(onRepeatDue.mock.calls[0][0]).toMatchObject({ templateId: 'tpl', dueAt: '2026-10-09T09:00:00.000Z' });
  });

  it('is not offered after the block is destroyed', () => {
    const onRepeatDue = vi.fn();
    const { tool } = buildDatabase(standup(), 'db', data(), { templates: { onRepeatDue } });

    tool.destroy();
    vi.advanceTimersByTime(60 * 60_000);

    expect(onRepeatDue).not.toHaveBeenCalled();
  });

  it('offers each run once, and the next run on the next day', () => {
    const onRepeatDue = vi.fn();

    buildDatabase(standup(), 'db', data(), { templates: { onRepeatDue } });
    vi.advanceTimersByTime(5 * 60_000 + 60 * 60_000);
    expect(onRepeatDue).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(24 * 60 * 60_000);

    expect(onRepeatDue.mock.calls.map((call) => (call[0] as { dueAt: string }).dueAt))
      .toEqual(['2026-10-09T09:00:00.000Z', '2026-10-10T09:00:00.000Z']);
  });

  it('after createRow, offers the next run when it comes', () => {
    const onRepeatDue = vi.fn((input: { createRow: () => string | null }) => {
      input.createRow();
    });
    const doc = standup();

    buildDatabase(doc, 'db', data(), { templates: { onRepeatDue } });
    vi.advanceTimersByTime(5 * 60_000 + 24 * 60 * 60_000);

    expect(onRepeatDue).toHaveBeenCalledTimes(2);
    expect(doc.row('tpl').repeat?.lastRunAt).toBe('2026-10-10T09:00:00.000Z');
  });

  it('a template with a broken repeat does not stop another from running', () => {
    const onRepeatDue = vi.fn();
    const doc = makeDoc([
      { id: 'db', name: 'database', parentId: null, data: {} },
      rowSeed('bad', 'db', { properties: { title: 'Broken' }, position: 'a0', template: true, repeat: { frequency: 'hourly' as 'daily', start: '2026-10-01T09:00:00.000Z' } }),
      rowSeed('tpl', 'db', { properties: { title: 'Standup' }, position: 'a1', template: true, repeat: { frequency: 'daily', start: '2026-10-01T09:00:00.000Z', lastRunAt: '2026-10-08T09:00:00.000Z' } }),
    ]);

    buildDatabase(doc, 'db', data(), { templates: { onRepeatDue } });
    vi.advanceTimersByTime(5 * 60_000);

    expect(onRepeatDue.mock.calls.map((call) => (call[0] as { templateId: string }).templateId)).toEqual(['tpl']);
  });
});
