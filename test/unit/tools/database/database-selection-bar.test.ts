import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bulkCloseClearsSelection, createSelectionBar } from '../../../../src/tools/database/database-selection-bar';
import type { PropertyDefinition } from '../../../../src/tools/database/types';

const properties: PropertyDefinition[] = [
  { id: 't', name: 'Name', type: 'title', position: 'a0' },
  { id: 'n', name: 'Notes', type: 'text', position: 'a1' },
  { id: 'c', name: 'Created', type: 'createdTime', position: 'a2' },
  { id: 'd', name: 'Done', type: 'checkbox', position: 'a3' },
];

const i18n = { t: (key: string, vars?: Record<string, string | number>): string => (vars?.count !== undefined ? `${vars.count} selected` : key) };

describe('selection bar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('shows the count, one button per editable property, trash and more', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const onMore = vi.fn();
    const bar = createSelectionBar({ count: 2, properties, i18n, onEdit, onDelete, onMore });

    expect(bar.getAttribute('role')).toBe('toolbar');
    expect(bar.querySelector('[data-blok-database-table-selection-count]')?.textContent).toBe('2 selected');
    const buttons = [...bar.querySelectorAll<HTMLElement>('[data-blok-database-table-selection-property]')];

    expect(buttons.map((button) => button.textContent)).toEqual(['Notes', 'Done']);
    buttons[1].click();
    bar.querySelector<HTMLElement>('[data-blok-database-table-selection-delete]')?.click();
    bar.querySelector<HTMLElement>('[data-blok-database-table-selection-more]')?.click();

    expect(onEdit).toHaveBeenCalledWith('d', buttons[1]);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onMore).toHaveBeenCalledTimes(1);
  });
});

// research/35 §3 (and research/31 §4b): which close of a bulk edit clears the row selection.
describe('bulkCloseClearsSelection', () => {
  it('clears after a Text write closed by Escape, Enter or a press outside, and after Enter on a URL', () => {
    expect([bulkCloseClearsSelection('text', 'Escape', true), bulkCloseClearsSelection('text', 'Enter', true), bulkCloseClearsSelection('text', null, true)])
      .toEqual([true, true, true]);
    expect(bulkCloseClearsSelection('url', 'Enter', true)).toBe(true);
  });

  it('keeps it after a Number Escape, a Select click, and any close with nothing written', () => {
    expect(bulkCloseClearsSelection('number', 'Escape', true)).toBe(false);
    expect(bulkCloseClearsSelection('select', null, true)).toBe(false);
    expect(bulkCloseClearsSelection('text', 'Escape', false)).toBe(false);
  });
});
