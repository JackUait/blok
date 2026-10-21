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
});
