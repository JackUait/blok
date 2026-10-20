import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DatabaseData, PropertyDefinition } from '../../../../src/tools/database/types';
import { buildTool as buildHarnessTool, fakeRow, makeDoc, tableData } from './tier3-harness';
import type { Doc } from './tier3-harness';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

const built: Array<{ destroy: () => void }> = [];

/** A picked row's key listener sits on the document; a tool left alive would take the next test's keys. */
const buildTool = (...args: Parameters<typeof buildHarnessTool>): ReturnType<typeof buildHarnessTool> => {
  const result = buildHarnessTool(...args);

  built.push(result.tool);

  return result;
};

const SCHEMA: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'due', name: 'Due', type: 'date', position: 'a1' },
];

const calendarData = (): DatabaseData => tableData(SCHEMA, { type: 'calendar' });

// research/22 §1: Delta and Bravo on Oct 20, Charlie on Oct 22.
const doc = (): Doc => makeDoc([
  fakeRow('delta', 'db', { title: 'Delta', due: '2026-10-20' }, 'a0'),
  fakeRow('bravo', 'db', { title: 'Bravo', due: '2026-10-20' }, 'a1'),
  fakeRow('charlie', 'db', { title: 'Charlie', due: '2026-10-22' }, 'a2'),
]);

const eventOf = (el: HTMLElement, rowId: string): HTMLElement => {
  const found = el.querySelector<HTMLElement>(`[data-blok-database-calendar-event][data-row-id="${rowId}"]`);

  if (found === null) throw new Error(`no event ${rowId}`);

  return found;
};

const click = (target: Element, init: MouseEventInit = {}): void => {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
};

const selected = (el: HTMLElement): string[] =>
  [...el.querySelectorAll('[data-blok-database-calendar-event][data-blok-database-row-selected]')].map((node) => node.getAttribute('data-row-id') ?? '');

type Opener = { handleRowClick: (rowId: string) => void };

describe('DatabaseTool — calendar event selection (research/22 §1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 20, 12));
  });

  afterEach(() => {
    built.splice(0).forEach((tool) => tool.destroy());
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('Shift-click selects the event without opening it', () => {
    const { el, tool } = buildTool(doc(), {}, calendarData());
    const open = vi.spyOn(tool as unknown as Opener, 'handleRowClick');

    click(eventOf(el, 'delta'), { shiftKey: true });

    expect(selected(el)).toEqual(['delta']);
    expect(eventOf(el, 'delta').getAttribute('aria-selected')).toBe('true');
    expect(open).not.toHaveBeenCalled();
  });

  it('Shift-click adds an event on the same day and replaces the selection on another day', () => {
    const { el } = buildTool(doc(), {}, calendarData());

    click(eventOf(el, 'delta'), { shiftKey: true });
    click(eventOf(el, 'bravo'), { shiftKey: true });

    expect(selected(el).sort()).toEqual(['bravo', 'delta']);

    click(eventOf(el, 'charlie'), { shiftKey: true });

    expect(selected(el)).toEqual(['charlie']);
  });

  it.each([['metaKey'], ['ctrlKey']] as const)('a %s click neither selects nor opens', (key) => {
    const { el, tool } = buildTool(doc(), {}, calendarData());
    const open = vi.spyOn(tool as unknown as Opener, 'handleRowClick');

    click(eventOf(el, 'delta'), { [key]: true });

    expect(selected(el)).toEqual([]);
    expect(open).not.toHaveBeenCalled();
  });

  it('a plain click opens the row and selects nothing', () => {
    const { el, tool } = buildTool(doc(), {}, calendarData());
    const open = vi.spyOn(tool as unknown as Opener, 'handleRowClick');

    click(eventOf(el, 'delta'));

    expect(open).toHaveBeenCalledWith('delta');
    expect(selected(el)).toEqual([]);
  });

  it('shows no bulk selection bar, and Escape clears the selection', () => {
    const { el } = buildTool(doc(), {}, calendarData());

    click(eventOf(el, 'delta'), { shiftKey: true });

    expect(el.querySelector('[data-blok-database-table-selection-bar]')).toBeNull();
    expect(el.querySelector('[data-blok-database-selecting]')).toBeNull();

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    expect(selected(el)).toEqual([]);
  });

  it('leaves Cmd+/ alone: there is no bulk bar to edit from', () => {
    const { el } = buildTool(doc(), {}, calendarData());

    click(eventOf(el, 'delta'), { shiftKey: true });
    const key = new KeyboardEvent('keydown', { key: '/', metaKey: true, bubbles: true, cancelable: true });

    document.body.dispatchEvent(key);

    expect(key.defaultPrevented).toBe(false);
  });

  it('read-only: Shift-click selects nothing', () => {
    const { el } = buildTool(doc(), {}, calendarData(), true);

    click(eventOf(el, 'delta'), { shiftKey: true });

    expect(selected(el)).toEqual([]);
  });
});

describe('DatabaseTool — calendar event comments (research/22 §11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 20, 12));
  });

  afterEach(() => {
    built.splice(0).forEach((tool) => tool.destroy());
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const menuOutline = (): string[] => {
    const menu = document.querySelector('[data-blok-popover-opened]');

    if (menu === null) throw new Error('no open menu');

    return Array.from(menu.querySelectorAll('[data-blok-testid="popover-item-title"], [data-blok-testid="popover-item-separator"], [data-blok-database-row-menu-heading], [data-blok-database-row-menu-footer]'))
      .map((node) => {
        if (node.hasAttribute('data-blok-database-row-menu-heading')) return 'heading';
        if (node.hasAttribute('data-blok-database-row-menu-footer')) return 'footer';
        if (node.getAttribute('data-blok-testid') === 'popover-item-separator') return '|';

        return node.textContent ?? '';
      });
  };

  it('a right-click on an event opens the row menu with Comment ⌘⇧M after Open in', () => {
    const open = vi.fn();
    const { el } = buildTool(doc(), { comments: { open } }, calendarData());
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });

    eventOf(el, 'delta').dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(menuOutline()).toEqual([
      'heading',
      'tools.database.tableEditIcon',
      'tools.database.tableEditProperty',
      '|',
      'tools.database.tableOpenIn',
      'tools.database.tableComment',
      '|',
      'tools.database.tableCopyLink',
      'tools.database.tableDuplicate',
      'tools.database.tableMoveToTrash',
      '|',
      'footer',
    ]);

    document.querySelector<HTMLElement>('[data-blok-popover-item][data-blok-item-name="database-row-comment"]')?.click();

    expect(open).toHaveBeenCalledWith({ databaseId: 'db', rowId: 'delta' }, eventOf(el, 'delta'));
  });

  it('one picked event opens its comments on ⌘⇧M', () => {
    const open = vi.fn();
    const { el } = buildTool(doc(), { comments: { open } }, calendarData());

    click(eventOf(el, 'delta'), { shiftKey: true });
    const key = new KeyboardEvent('keydown', { key: 'M', metaKey: true, shiftKey: true, bubbles: true, cancelable: true });

    document.body.dispatchEvent(key);

    expect(open).toHaveBeenCalledWith({ databaseId: 'db', rowId: 'delta' }, eventOf(el, 'delta'));
    expect(key.defaultPrevented).toBe(true);
  });

  it('an event shows its comment count; the badge opens the thread, not the row', () => {
    const open = vi.fn();
    const { el, tool } = buildTool(doc(), { comments: { open, count: ({ rowId }) => (rowId === 'delta' ? 2 : 0) } }, calendarData());
    const openRow = vi.spyOn(tool as unknown as Opener, 'handleRowClick');
    const badge = eventOf(el, 'delta').querySelector<HTMLElement>('[data-blok-database-comment-badge]');

    expect(badge?.querySelector('[data-blok-database-comment-count]')?.textContent).toBe('2');
    expect(badge?.tabIndex).toBe(-1);
    expect(eventOf(el, 'bravo').querySelector('[data-blok-database-comment-badge]')).toBeNull();

    badge?.click();

    expect(open).toHaveBeenCalledWith({ databaseId: 'db', rowId: 'delta' }, badge);
    expect(openRow).not.toHaveBeenCalled();
  });
});
