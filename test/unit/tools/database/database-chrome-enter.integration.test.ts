import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { API } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  blocks: API['blocks'];
}

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

const schema = (locked: boolean): unknown[] => [
  { id: 't', name: 'Name', type: 'title', position: 'a0', ...(locked ? { databaseLocked: true } : {}) },
  {
    id: 'st', name: 'Status', type: 'select', position: 'a1',
    config: { options: [{ id: 's1', label: 'Todo', color: 'gray', position: 'a0' }] },
  },
  { id: 'd', name: 'Date', type: 'date', position: 'a2' },
  { id: 'n', name: 'Number', type: 'number', position: 'a3' },
];

const view = (type: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'v1', name: type, type, position: 'a0', sorts: [], filters: [], ...extra,
});

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const mount = async (views: unknown[], locked = false): Promise<void> => {
  holder = document.createElement('div');
  document.body.appendChild(holder);
  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
    data: {
      id: 'doc',
      blocks: [
        { id: 'db', type: 'database', content: ['r1'], data: { title: 'Tasks', schema: schema(locked), views, activeViewId: 'v1' } },
        { id: 'r1', type: 'database-row', parent: 'db', data: { position: 'a0', properties: { t: 'Alpha', st: 's1', d: '2026-11-18', n: 1 } } },
      ],
    },
  }) as unknown as TestEditor;
  await editor.isReady;
  await quiet();
};

/** Enter on a focused control, as the keyboard sends it: the browser turns an unprevented Enter into a click. */
const pressEnterOn = (control: HTMLElement): KeyboardEvent => {
  control.focus();
  const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });

  control.dispatchEvent(event);

  return event;
};

const cases: Array<{ name: string; views: unknown[]; locked?: boolean; selector: string }> = [
  { name: 'the "Locked" button', views: [view('table')], locked: true, selector: '[data-blok-testid="database-toolbar-locked"]' },
  { name: 'the toolbar filter button', views: [view('table')], selector: '[data-blok-testid="database-toolbar-filter"]' },
  { name: 'the toolbar New button', views: [view('table')], selector: '[data-blok-testid="database-toolbar-new"]' },
  {
    name: 'a sort pill in the filter bar',
    views: [view('table', { sorts: [{ id: 's1', propertyId: 'n', direction: 'desc' }] })],
    selector: '[data-blok-testid="database-sort-pill"]',
  },
  {
    name: '"+ Add filter" in the filter bar',
    views: [view('table', { filters: [{ id: 'f1', propertyId: 't', operator: 'contains', value: 'a' }] })],
    selector: '[data-blok-testid="database-filter-bar-add"]',
  },
  { name: 'the calendar\'s next-month button', views: [view('calendar', { calendarBy: 'd' })], selector: '[data-blok-database-calendar-next]' },
  { name: 'the timeline\'s zoom button', views: [view('timeline', { timelineBy: 'd' })], selector: '[data-blok-database-timeline-zoom]' },
  { name: 'a board column\'s menu button', views: [view('board', { groupBy: 'st' })], selector: '[data-blok-database-column-menu]' },
  { name: 'a feed post\'s more-actions button', views: [view('feed')], selector: '[data-blok-database-feed-more-actions]' },
];

describe('Enter on a focused database control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    vi.restoreAllMocks();
  });

  it.each(cases)('activates $name and inserts no block', async ({ views, locked, selector }) => {
    await mount(views, locked === true);
    const control = holder?.querySelector<HTMLElement>(selector);

    expect(control).toBeInstanceOf(HTMLElement);
    if (!(control instanceof HTMLElement)) return;
    const before = editor?.blocks.getBlocksCount();
    const event = pressEnterOn(control);

    await quiet();

    expect(event.defaultPrevented).toBe(false);
    expect(editor?.blocks.getBlocksCount()).toBe(before);
    expect(editor?.blocks.getBlockByIndex(0)?.name).toBe('database');
  });
});
