import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DatabaseData, PropertyDefinition } from '../../../../src/tools/database/types';
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

vi.mock('../../../../src/components/utils/popover', () => {
  class MockPopoverDesktop {
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

const pair = (shift?: 'overlap' | 'maintain' | 'none'): PropertyDefinition[] => [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'date', name: 'When', type: 'date', position: 'a1' },
  {
    id: 'blockedBy', name: 'Blocked by', type: 'relation', position: 'a2',
    relation: { targetDatabaseId: 'db', twoWay: true, syncedPropertyId: 'blocking', role: 'blockedBy' },
    ...(shift !== undefined ? { dependency: { shift } } : {}),
  },
  { id: 'blocking', name: 'Blocking', type: 'relation', position: 'a3', relation: { targetDatabaseId: 'db', twoWay: true, syncedPropertyId: 'blockedBy', role: 'blocking' } },
];

const data = (schema: PropertyDefinition[]): DatabaseData => ({
  schema,
  views: [{ id: 'v', name: 'Timeline', type: 'timeline', position: 'a0', sorts: [], filters: [], visibleProperties: [], timelineBy: 'date', timelineZoom: 'week' }],
  activeViewId: 'v',
});

const chain = (): ReturnType<typeof makeDoc> => makeDoc([
  { id: 'db', name: 'database', parentId: null, data: {} },
  rowSeed('a', 'db', { properties: { title: 'Design', date: '2026-10-05/2026-10-07', blocking: [{ id: 'b' }] }, position: 'a0' }),
  rowSeed('b', 'db', { properties: { title: 'Build', date: '2026-10-08/2026-10-09', blockedBy: [{ id: 'a' }] }, position: 'a1' }),
  rowSeed('c', 'db', { properties: { title: 'Ship', date: '2026-10-12/2026-10-13' }, position: 'a2' }),
]);

const bar = (el: HTMLElement, rowId: string): HTMLElement | null =>
  el.querySelector<HTMLElement>(`[data-blok-database-timeline-bar][data-row-id="${rowId}"]`);

describe('DatabaseTool — dependencies', () => {
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

  it('turns dependencies on with a "Blocked by" / "Blocking" pair', () => {
    const doc = makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }]);
    const { tool } = buildDatabase(doc, 'db', data(pair().slice(0, 2)));

    tool.setDependenciesEnabled(true);

    const schema = tool.save(document.createElement('div')).schema;
    const blockedBy = schema.find((p) => p.relation?.role === 'blockedBy');
    const blocking = schema.find((p) => p.relation?.role === 'blocking');

    expect(blockedBy?.relation).toMatchObject({ targetDatabaseId: 'db', twoWay: true, syncedPropertyId: blocking?.id });
    expect(blocking?.relation).toMatchObject({ targetDatabaseId: 'db', twoWay: true, syncedPropertyId: blockedBy?.id });
  });

  it('draws an arrow from each blocking item to the item it blocks', () => {
    const { el } = buildDatabase(chain(), 'db', data(pair()));
    const arrows = [...el.querySelectorAll('[data-blok-database-timeline-arrow]')].map((a) => `${a.getAttribute('data-from')}>${a.getAttribute('data-to')}`);

    expect(arrows).toEqual(['a>b']);
  });

  it('drawing from a bar\'s link handle to another bar makes it blocked, both sides in one step', () => {
    const doc = chain();
    const { el } = buildDatabase(doc, 'db', data(pair()));
    const handle = bar(el, 'b')?.querySelector<HTMLElement>('[data-blok-database-timeline-link-handle]');
    const target = bar(el, 'c');

    expect(handle).not.toBeNull();
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
    handle?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 60, clientY: 40 }));
    doc.transact.mockClear();
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 60, clientY: 40 }));

    expect(doc.row('c').properties.blockedBy).toEqual([{ id: 'b' }]);
    expect(doc.row('b').properties.blocking).toEqual([{ id: 'c' }]);
    expect(doc.transact).toHaveBeenCalledTimes(1);
    Reflect.deleteProperty(document, 'elementFromPoint');
  });

  // findings C16: Notion shows the connector on every bar, before any dependency exists.
  it('with dependencies off, a bar still has the link handle, and drawing a link turns them on and links', () => {
    const doc = chain();
    const { el, tool } = buildDatabase(doc, 'db', data(pair().slice(0, 2)));
    const handle = bar(el, 'b')?.querySelector<HTMLElement>('[data-blok-database-timeline-link-handle]');
    const target = bar(el, 'c');

    expect(handle).not.toBeNull();
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
    handle?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 60, clientY: 40 }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 60, clientY: 40 }));
    Reflect.deleteProperty(document, 'elementFromPoint');

    const schema = tool.save(document.createElement('div')).schema;
    const blockedBy = schema.find((p) => p.relation?.role === 'blockedBy');
    const blocking = schema.find((p) => p.relation?.role === 'blocking');

    expect(blockedBy).toBeDefined();
    expect(doc.row('c').properties[blockedBy?.id ?? '']).toEqual([{ id: 'b' }]);
    expect(doc.row('b').properties[blocking?.id ?? '']).toEqual([{ id: 'c' }]);
  });

  it('moving a blocker shifts what it blocks in the same undo step', () => {
    const doc = chain();
    const { tool } = buildDatabase(doc, 'db', data(pair('maintain')));

    doc.transact.mockClear();
    (tool as unknown as { writeTimelineDates: (r: string, w: { start?: string }, s: string, e: undefined) => void })
      .writeTimelineDates('a', { start: '2026-10-05/2026-10-08' }, 'date', undefined);

    expect(doc.transact).toHaveBeenCalledTimes(1);
    expect(doc.row('a').properties.date).toBe('2026-10-05/2026-10-08');
    expect(doc.row('b').properties.date).toBe('2026-10-09/2026-10-10');
  });

  it('does not shift with the default rule', () => {
    const doc = chain();
    const { tool } = buildDatabase(doc, 'db', data(pair()));

    (tool as unknown as { writeTimelineDates: (r: string, w: { start?: string }, s: string, e: undefined) => void })
      .writeTimelineDates('a', { start: '2026-10-05/2026-10-08' }, 'date', undefined);

    expect(doc.row('b').properties.date).toBe('2026-10-08/2026-10-09');
  });
});
