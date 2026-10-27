import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { headerViewItems } from '../../../../src/tools/database/database-table-menus';
import type { PropertyDefinition } from '../../../../src/tools/database/types';

const titles = (property: PropertyDefinition): string[] => headerViewItems({
  i18n: { t: (key: string) => key },
  property,
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
}).map((item) => (item as { title?: string }).title ?? '');

describe('column header menu — button property', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has no Filter, Sort, Group or Calculate for a button', () => {
    const shown = titles({ id: 'act', name: 'Act', type: 'button', position: 'a0' });

    for (const key of ['tools.database.tableFilter', 'tools.database.tableSort', 'tools.database.tableGroup', 'tools.database.tableCalculate']) {
      expect(shown).not.toContain(key);
    }
    expect(shown).toContain('tools.database.tableHide');
  });

  it('has no Wrap for a button (research/08)', () => {
    const shown = titles({ id: 'act', name: 'Act', type: 'button', position: 'a0' });

    expect(shown).not.toContain('tools.database.tableWrap');
    expect(shown).not.toContain('tools.database.tableUnwrap');
  });

  it.each(['files', 'uniqueId'] as const)('offers no Group for %s, which cannot group (research/08)', (type) => {
    const shown = titles({ id: 'x', name: 'X', type, position: 'a0' });

    expect(shown).not.toContain('tools.database.tableGroup');
    expect(shown).toContain('tools.database.tableFilter');
  });

  it('offers no Group for Place, whose column menu has none (research/20 §1d)', () => {
    const shown = titles({ id: 'p', name: 'Place', type: 'place', position: 'a0' });

    expect(shown).not.toContain('tools.database.tableGroup');
    expect(shown).toContain('tools.database.tableFilter');
    expect(shown).toContain('tools.database.tableSort');
  });

  it('keeps them for other types', () => {
    expect(titles({ id: 'n', name: 'N', type: 'number', position: 'a0' })).toEqual(expect.arrayContaining(['tools.database.tableFilter', 'tools.database.tableSort']));
  });
});
