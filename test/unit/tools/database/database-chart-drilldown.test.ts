import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { openChartDrilldown } from '../../../../src/tools/database/database-chart-drilldown';
import type { DatabaseRow, PropertyDefinition } from '../../../../src/tools/database/types';

const columns: PropertyDefinition[] = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-pts', name: 'Points', type: 'number', position: 'a1' },
];

const rows: DatabaseRow[] = [
  { id: 'r1', position: 'a0', properties: { 'p-title': 'Write', 'p-pts': 3 } },
  { id: 'r2', position: 'a1', properties: { 'p-title': '', 'p-pts': 5 } },
];

const dialog = (): HTMLElement | null => document.querySelector('[data-blok-database-drilldown]');

describe('openChartDrilldown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.textContent = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const open = (openRow = vi.fn()): ReturnType<typeof openChartDrilldown> => openChartDrilldown({
    title: 'Done',
    rows,
    columns,
    titlePropertyId: 'p-title',
    cellText: (property, row) => {
      const value = row.properties[property.id];

      return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
    },
    i18n: { t: (key: string, vars?: Record<string, string | number>) => (vars === undefined ? key : `${key}:${String(vars.count)}`) },
    openRow,
  });

  it('opens a modal table of the group\'s rows, read-only', () => {
    open();
    const surface = document.querySelector('[role="dialog"]');

    expect(surface?.getAttribute('aria-modal')).toBe('true');
    expect(dialog()?.querySelector('[data-blok-database-drilldown-title]')?.textContent).toBe('Done');
    expect(dialog()?.querySelector('[data-blok-database-drilldown-count]')?.textContent).toBe('tools.database.chartDrilldownCount:2');
    expect([...(dialog()?.querySelectorAll('th') ?? [])].map((th) => th.textContent)).toEqual(['Name', 'Points']);
    expect([...(dialog()?.querySelectorAll('tbody tr') ?? [])].map((tr) => [...tr.children].map((td) => td.textContent))).toEqual([
      ['Write', '3'],
      ['tools.database.cardTitlePlaceholder', '5'],
    ]);
    expect(dialog()?.querySelector('[contenteditable], input')).toBeNull();
  });

  it('opens a row page from its title, and closes itself', () => {
    const openRow = vi.fn();

    open(openRow);
    dialog()?.querySelector<HTMLButtonElement>('[data-blok-database-drilldown-open][data-row-id="r1"]')?.click();

    expect(openRow).toHaveBeenCalledWith('r1');
    expect(dialog()).toBeNull();
  });

  it('closes from its close button', () => {
    open();
    dialog()?.querySelector<HTMLButtonElement>('[data-blok-database-drilldown-close]')?.click();

    expect(dialog()).toBeNull();
  });
});
