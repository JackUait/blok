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

import { openMenu } from '../../../../src/tools/database/database-table-menus';

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
