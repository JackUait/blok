import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { constructed } = vi.hoisted(() => ({ constructed: [] as Array<Record<string, unknown>> }));

vi.mock('../../../../src/components/utils/popover', () => {
  class MockPopoverDesktop {
    constructor(params: Record<string, unknown>) {
      constructed.push(params);
    }

    on(): void { /* no-op */ }

    show(): void { /* no-op */ }

    destroy(): void { /* no-op */ }
  }

  return { PopoverDesktop: MockPopoverDesktop };
});

import { openMenu, rowMenuFooter, headerViewItems } from '../../../../src/tools/database/database-table-menus';
import type { HeaderMenuContext } from '../../../../src/tools/database/database-table-menus';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';
import type { PropertyDefinition } from '../../../../src/tools/database/types';
import en from '../../../../src/components/i18n/locales/en.json';
import { IconColumnInsertLeft, IconColumnInsertRight, IconGroup } from '../../../../src/components/icons';

describe('table view menus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    constructed.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('open with the database menu motion, like every other database menu', () => {
    openMenu(document.createElement('button'), []);

    expect(constructed[0]?.class).toBe('blok-database-menu');
  });

  it('opens a row menu to the left of its handle, centred on it, with the row menu size', () => {
    openMenu(document.createElement('button'), [], { kind: 'row' });

    expect(String(constructed[0]?.class).split(' ')).toEqual(['blok-database-menu', 'blok-database-row-menu']);
    expect(constructed[0]?.placeLeftOfAnchor).toBe(true);
  });

  it('marks a column header menu, so only it takes the header row size', () => {
    openMenu(document.createElement('button'), [], { kind: 'header' });

    expect(String(constructed[0]?.class).split(' ')).toEqual(['blok-database-menu', 'blok-database-header-menu']);
  });

  // feel findings B15: a card's row menu is Notion's 265 wide, keeps the row size, and CSS lifts its height cap.
  it('opens a card menu 265 wide with the row menu size, marked so CSS lifts its height cap', () => {
    openMenu(document.createElement('button'), [], { kind: 'card' });

    expect(String(constructed[0]?.class).split(' ')).toEqual(['blok-database-menu', 'blok-database-row-menu', 'blok-database-card-menu']);
    expect(constructed[0]?.minWidth).toBe('265px');
    expect(constructed[0]?.placeLeftOfAnchor).toBeUndefined();
  });

  // 09-notion-card-menu.png: the menu opens over its "•••" at the button's left and shifts up to fit.
  it('opens a card menu over its button, kept inside the window; the table row menu does not', () => {
    openMenu(document.createElement('button'), [], { kind: 'card' });
    openMenu(document.createElement('button'), [], { kind: 'row' });

    expect(constructed[0]?.cover).toBe(true);
    expect(constructed[1]?.cover).toBeUndefined();
  });
});

// research/30 B6 measured the date cell only; the row menu's last-edited time keeps "N days ago".
describe('row menu footer time', () => {
  it('writes an edit three days back as "3 days ago"', () => {
    const now = new Date(2026, 9, 21, 12);
    const footer = rowMenuFooter({
      row: { properties: {}, meta: { lastEditedAt: new Date(2026, 9, 18, 12).getTime() } },
      titlePropertyId: 'p-title',
      locale: 'en-US',
      now,
      hourCycle: 'h12',
    });

    expect(footer.lastEdited?.time).toBe('3 days ago 12:00 PM');
  });

  it('writes an edit from today as "Today at 4:54 AM" through one translated phrase (research/35 §19)', () => {
    const at = new Date(2026, 9, 22, 4, 54);
    const t = vi.fn((key: string, vars?: Record<string, string | number>) => `${key}|${String(vars?.time)}`);
    const footer = rowMenuFooter({
      row: { properties: {}, meta: { lastEditedAt: at.getTime() } },
      titlePropertyId: 'p-title',
      locale: 'en-US',
      now: new Date(2026, 9, 22, 5, 10),
      hourCycle: 'h12',
      i18n: { t },
    });
    const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hourCycle: 'h12' }).format(at);

    expect(footer.lastEdited?.time).toBe(`tools.database.rowEditedTodayAt|${time}`);
    expect(time.replace(/\s/g, ' ')).toBe('4:54 AM');
  });

  it('keeps yesterday as it was: only "Today at" is measured', () => {
    const t = vi.fn((key: string) => key);
    const footer = rowMenuFooter({
      row: { properties: {}, meta: { lastEditedAt: new Date(2026, 9, 21, 12).getTime() } },
      titlePropertyId: 'p-title',
      locale: 'en-US',
      now: new Date(2026, 9, 22, 5),
      hourCycle: 'h12',
      i18n: { t },
    });

    expect(footer.lastEdited?.time).toBe('Yesterday 12:00 PM');
    expect(t).not.toHaveBeenCalled();
  });
});

// research/08 shots-08/22: every row of Notion's column header menu has a glyph.
describe('column header menu glyphs', () => {
  const ctx = (type: PropertyDefinition['type'], over: Partial<HeaderMenuContext> = {}): HeaderMenuContext => ({
    i18n: { t: (key: string) => key },
    property: { id: 'p', name: 'P', type } as PropertyDefinition,
    frozenHere: false,
    wrapped: false,
    showPageIcon: true,
    calculation: undefined,
    onFilter: vi.fn(),
    onSort: vi.fn(),
    onGroup: vi.fn(),
    onCalculate: vi.fn(),
    onFreeze: vi.fn(),
    onUnfreeze: vi.fn(),
    onHide: vi.fn(),
    onWrap: vi.fn(),
    onShowPageIcon: vi.fn(),
    onInsert: vi.fn(),
    ...over,
  });
  const untitled = (items: PopoverItemParams[]): string[] => items
    .filter((item) => !('icon' in item) || typeof item.icon !== 'string' || item.icon === '')
    .map((item) => ('title' in item ? String(item.title) : String(item.type)));

  it.each([
    ['text', {}],
    ['title', {}],
    ['number', { frozenHere: true, wrapped: true }],
    ['checkbox', {}],
  ] as const)('gives every %s row an icon', (type, over) => {
    expect(untitled(headerViewItems(ctx(type, over)))).toEqual([]);
  });

  // notion-spec-2 §25.5: the row reads "Freeze" on every column.
  it('labels the freeze row "Freeze", as Notion', () => {
    const messages: Record<string, string> = en;
    const items = headerViewItems(ctx('number', { i18n: { t: (key: string) => messages[key] ?? key } }));
    const freeze = items.find((item) => 'name' in item && item.name === 'database-header-freeze');

    expect(freeze && 'title' in freeze ? freeze.title : undefined).toBe('Freeze');
  });

  // notion-live-7/80-menu-text.png, 81-menu-*.png: Sort carries a "›"; Filter and Group do not.
  it('draws a "›" on Sort only, since Sort opens its two choices', () => {
    const items = headerViewItems(ctx('text'));
    const chevron = (name: string): unknown => {
      const found = items.find((item) => 'name' in item && item.name === name);

      return found !== undefined && 'chevron' in found ? found.chevron : undefined;
    };

    expect(chevron('database-header-sort')).toBe(true);
    expect(chevron('database-header-filter')).toBeUndefined();
    expect(chevron('database-header-group')).toBeUndefined();
  });

  // notion-live-8/80-menu-number.png: Group is a dot grid; Insert left and right push an arrow into a bar.
  it('draws Notion\'s Group and Insert glyphs', () => {
    const items = headerViewItems(ctx('text'));
    const icon = (name: string): unknown => {
      const found = items.find((item) => 'name' in item && item.name === name);

      return found !== undefined && 'icon' in found ? found.icon : undefined;
    };

    expect(icon('database-header-group')).toBe(IconGroup);
    expect(icon('database-header-insert-left')).toBe(IconColumnInsertLeft);
    expect(icon('database-header-insert-right')).toBe(IconColumnInsertRight);
  });
});
