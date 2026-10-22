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

import { openMenu, rowMenuFooter } from '../../../../src/tools/database/database-table-menus';

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
