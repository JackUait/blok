import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { addDays, daysBetween } from '../../../../src/tools/database/calendar-dates';
import { TIMELINE_DAY_WIDTH, timelineWindow } from '../../../../src/tools/database/timeline-dates';
import type { OutputBlockData } from '../../../../types';

/**
 * notion-motion.md Round 46 B: a bar dragged to new dates is left selected,
 * on the chart and in the table panel, after the redraw the write causes.
 */
const quiet = async (): Promise<void> => {
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => {
      requestAnimationFrame(() => resolve(undefined));
    });
  }
};

const today = (): string => {
  const now = new Date();

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const doc = (): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      schema: [
        { id: 't', name: 'Name', type: 'title', position: 'a0' },
        { id: 'due', name: 'Due', type: 'date', position: 'a1' },
      ],
      views: [{ id: 'v', name: 'View', type: 'timeline', timelineBy: 'due', showTimelineTable: true, position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v',
    },
    content: ['r1', 'r2'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One', due: today() }, position: 'a0' } },
  { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Two', due: today() }, position: 'a1' } },
];

const pointer = (type: string, target: EventTarget, x: number): void => {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: 50, button: 0, pointerId: 1 }));
};

let editor: { isReady: Promise<unknown>; destroy: () => void } | undefined;
let holder: HTMLDivElement | undefined;

describe('timeline bar drop selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    vi.restoreAllMocks();
  });

  it('leaves a moved bar selected on the chart and in the table panel', async () => {
    editor = new Blok({
      holder,
      dataModel: 'hierarchical',
      tools: { paragraph: Paragraph, database: { class: DatabaseTool, config: {} }, 'database-row': DatabaseRowTool },
      data: { blocks: doc() },
    } as never);
    await editor.isReady;
    await quiet();

    const canvas = holder?.querySelector<HTMLElement>('[data-blok-database-timeline-canvas]');
    const bar = holder?.querySelector<HTMLElement>('[data-blok-database-timeline-bar][data-row-id="r2"]');

    if (canvas === null || canvas === undefined || bar === null || bar === undefined) throw new Error('no timeline');
    const days = timelineWindow(today(), 'month').days;

    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: days * TIMELINE_DAY_WIDTH.month, height: 400, right: days * TIMELINE_DAY_WIDTH.month, bottom: 400, x: 0, y: 0, toJSON: () => ({}),
    });
    const xOf = (day: string): number => daysBetween(timelineWindow(today(), 'month').start, day) * TIMELINE_DAY_WIDTH.month + 20;

    pointer('pointerdown', bar, xOf(today()));
    pointer('pointermove', document, xOf(addDays(today(), 2)));
    pointer('pointerup', document, xOf(addDays(today(), 2)));
    await quiet();

    expect(holder?.querySelector('[data-blok-database-timeline-row][data-row-id="r2"]')?.hasAttribute('data-blok-database-row-selected')).toBe(true);
    expect(holder?.querySelector('[data-blok-database-timeline-table-row][data-row-id="r2"]')?.hasAttribute('data-blok-database-row-selected')).toBe(true);
    expect(holder?.querySelector('[data-blok-database-timeline-row][data-row-id="r1"]')?.hasAttribute('data-blok-database-row-selected')).toBe(false);
  });

  // notion-motion.md Round 49 B5: Notion keeps the scroll across a drop. Blok went back to its open place (Day 2393 → 3396, Month 2953 → 2721).
  it('keeps the chart where it was scrolled after a moved bar is dropped', async () => {
    editor = new Blok({
      holder,
      dataModel: 'hierarchical',
      tools: { paragraph: Paragraph, database: { class: DatabaseTool, config: {} }, 'database-row': DatabaseRowTool },
      data: { blocks: doc() },
    } as never);
    await editor.isReady;
    await quiet();

    const canvas = holder?.querySelector<HTMLElement>('[data-blok-database-timeline-canvas]');
    const scroller = holder?.querySelector<HTMLElement>('[data-blok-database-timeline-scroller]');
    const bar = holder?.querySelector<HTMLElement>('[data-blok-database-timeline-bar][data-row-id="r2"]');

    if (canvas === null || canvas === undefined || scroller === null || scroller === undefined || bar === null || bar === undefined) throw new Error('no timeline');
    const days = timelineWindow(today(), 'month').days;

    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: days * TIMELINE_DAY_WIDTH.month, height: 400, right: days * TIMELINE_DAY_WIDTH.month, bottom: 400, x: 0, y: 0, toJSON: () => ({}),
    });
    const xOf = (day: string): number => daysBetween(timelineWindow(today(), 'month').start, day) * TIMELINE_DAY_WIDTH.month + 20;

    scroller.scrollLeft = 1234;
    pointer('pointerdown', bar, xOf(today()));
    pointer('pointermove', document, xOf(addDays(today(), 2)));
    pointer('pointerup', document, xOf(addDays(today(), 2)));
    await quiet();

    const redrawn = holder?.querySelector<HTMLElement>('[data-blok-database-timeline-scroller]');

    expect(redrawn).not.toBe(scroller);
    expect(redrawn?.scrollLeft).toBe(1234);
  });

  // Round 49 B5 measured drops only; a row made from "+ New" is the same date write and keeps the scroll too.
  it('keeps the chart where it was scrolled after a row is made from "+ New"', async () => {
    editor = new Blok({
      holder,
      dataModel: 'hierarchical',
      tools: { paragraph: Paragraph, database: { class: DatabaseTool, config: {} }, 'database-row': DatabaseRowTool },
      data: { blocks: doc() },
    } as never);
    await editor.isReady;
    await quiet();

    const scroller = holder?.querySelector<HTMLElement>('[data-blok-database-timeline-scroller]');
    const add = holder?.querySelector<HTMLElement>('[data-blok-database-timeline-table-new]');

    if (scroller === null || scroller === undefined || add === null || add === undefined) throw new Error('no timeline');
    scroller.scrollLeft = 1234;
    add.click();
    await quiet();

    const redrawn = holder?.querySelector<HTMLElement>('[data-blok-database-timeline-scroller]');

    expect(holder?.querySelectorAll('[data-blok-database-timeline-row]').length).toBe(3);
    expect(redrawn?.scrollLeft).toBe(1234);
  });
});
