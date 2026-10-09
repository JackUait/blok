import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseViewControls } from '../../../../src/tools/database/database-view-controls';
import type { ViewControlsHost } from '../../../../src/tools/database/database-view-controls';
import type { DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'num', name: 'Amount', type: 'number', position: 'a1' },
];

const q = (id: string): HTMLElement | null => document.querySelector(`[data-blok-testid="${id}"]`);

const click = (id: string): void => {
  const el = q(id);

  if (el === null) throw new Error(`no ${id}`);
  el.click();
};

const setup = (options: { rows?: number; readOnly?: boolean; locked?: boolean } = {}): {
  controls: DatabaseViewControls;
  host: ViewControlsHost;
  saved: { view: DatabaseViewConfig };
} => {
  const saved = { view: { id: 'v1', name: 'T', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] } as DatabaseViewConfig };
  const storage = new Map<string, unknown>();
  const host: ViewControlsHost = {
    i18n: { t: (key: string) => key },
    fallback: { get: (key) => storage.get(key), set: (key, value) => { storage.set(key, value); } },
    savedView: () => saved.view,
    schema: () => schema,
    rowCount: () => options.rows ?? 5,
    locked: () => options.locked === true,
    readOnly: () => options.readOnly === true,
    viewCount: () => 1,
    layouts: ['table', 'board', 'list'],
    updateView: vi.fn((changes: Partial<DatabaseViewConfig>) => {
      saved.view = { ...saved.view, ...changes };
    }),
    setLayout: vi.fn(),
    setLocked: vi.fn(),
    duplicateView: vi.fn(),
    deleteView: vi.fn(),
    copyViewLink: vi.fn(),
    groups: () => [],
    rerender: vi.fn(),
  };
  const controls = new DatabaseViewControls(host);

  document.body.append(controls.toolbar, controls.filterBar);

  return { controls, host, saved };
};

describe('DatabaseViewControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('keeps a filter personal until Save for everyone', () => {
    const { controls, host, saved } = setup();
    const anchor = document.createElement('button');

    document.body.appendChild(anchor);
    controls.filterBy('num', anchor);

    expect(saved.view.filters).toEqual([]);
    expect(controls.effective(saved.view).filters).toHaveLength(1);
    expect(host.rerender).toHaveBeenCalled();
    expect(q('database-view-save')).not.toBeNull();
    expect(q('database-view-reset')).not.toBeNull();

    click('database-view-save');

    expect(host.updateView).toHaveBeenCalledWith({ filters: [expect.objectContaining({ propertyId: 'num' })] });
    expect(controls.hasPersonalEdits('v1')).toBe(false);
    expect(q('database-view-save')).toBeNull();
  });

  it('discards personal edits on Reset', () => {
    const { controls, saved } = setup();

    controls.sortBy('num', document.body);
    click('database-header-sort-desc');

    expect(controls.effective(saved.view).sorts).toEqual([expect.objectContaining({ propertyId: 'num', direction: 'desc' })]);
    expect(q('database-sort-pill')?.textContent).toBe('↓ Amount');

    click('database-view-reset');

    expect(controls.effective(saved.view).sorts).toEqual([]);
    expect(q('database-sort-pill')).toBeNull();
  });

  it('replaces the sorts with the one picked from a column header', () => {
    const { controls, saved } = setup();

    saved.view = { ...saved.view, sorts: [{ id: 'a', propertyId: 'title', direction: 'asc' }] };
    controls.sortBy('num', document.body);
    click('database-header-sort-asc');

    expect(controls.effective(saved.view).sorts).toEqual([expect.objectContaining({ propertyId: 'num', direction: 'asc' })]);
  });

  it('shows search from three rows and redraws as the person types', () => {
    const few = setup({ rows: 2 });

    expect(q('database-toolbar-search')?.hidden).toBe(true);
    few.controls.destroy();
    document.body.innerHTML = '';

    const { controls, host } = setup({ rows: 3 });

    expect(q('database-toolbar-search')?.hidden).toBe(false);
    click('database-toolbar-search');
    const input = q('database-search-input') as HTMLInputElement;

    expect(input).toHaveFocus();
    input.value = 'abc';
    input.dispatchEvent(new Event('input'));

    expect(controls.search).toBe('abc');
    expect(host.rerender).toHaveBeenCalled();
  });

  it('hides every control in read-only mode', () => {
    const { controls } = setup({ readOnly: true });

    expect(controls.toolbar.hidden).toBe(true);
    expect(controls.filterBar.hidden).toBe(true);
  });

  it('offers no Save for everyone while locked, and shows the lock', () => {
    const { controls } = setup({ locked: true });

    controls.sortBy('num', document.body);
    click('database-header-sort-asc');

    expect(q('database-view-save')).toBeNull();
    expect(q('database-view-reset')).not.toBeNull();
    expect(q('database-toolbar-locked')?.hidden).toBe(false);
  });

  it('marks an active filter pill only once it has a value', () => {
    const { controls } = setup();

    controls.filterBy('num', document.body);
    const pill = document.querySelector('[data-blok-database-filter-pill][data-filter-id]');

    expect(pill?.hasAttribute('data-active')).toBe(false);
    const input = q('database-filter-value') as HTMLInputElement;

    input.value = '5';
    input.dispatchEvent(new Event('input'));

    expect(document.querySelector('[data-blok-database-filter-pill][data-filter-id]')?.hasAttribute('data-active')).toBe(true);
  });
});
