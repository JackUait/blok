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
const cases: Array<{ name: string; views: unknown[]; selector: string }> = [
  { name: 'the calendar\'s next button', views: [view('calendar', { calendarBy: 'd' })], selector: '[data-blok-database-calendar-next]' },
  { name: 'the calendar\'s previous button', views: [view('calendar', { calendarBy: 'd' })], selector: '[data-blok-database-calendar-prev]' },
  { name: 'the calendar\'s Today button', views: [view('calendar', { calendarBy: 'd' })], selector: '[data-blok-database-calendar-today]' },
  { name: 'the timeline\'s table toggle', views: [view('timeline', { timelineBy: 'd' })], selector: '[data-blok-database-timeline-table-toggle]' },
];

describe('a database control that redraws its view', () => {
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

  it.each(cases)('keeps focus on $name after the redraw', async ({ views, selector }) => {
    await mount(views);
    const control = holder?.querySelector<HTMLElement>(selector);

    expect(control).toBeInstanceOf(HTMLElement);
    if (!(control instanceof HTMLElement)) return;
    control.focus();
    control.click();
    await quiet();

    const redrawn = holder?.querySelector<HTMLElement>(selector);

    expect(redrawn).not.toBe(control);
    expect(redrawn).toHaveFocus();
  });

  it('leaves focus alone when the redraw did not start on a control', async () => {
    await mount([view('calendar', { calendarBy: 'd' })]);
    const control = holder?.querySelector<HTMLElement>('[data-blok-database-calendar-next]');

    expect(control).toBeInstanceOf(HTMLElement);
    if (!(control instanceof HTMLElement)) return;
    control.blur();
    control.click();
    await quiet();

    expect(holder?.querySelector('[data-blok-database-calendar-next]')).not.toHaveFocus();
  });
});
