import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openViewSettings } from '../../../../src/tools/database/database-view-settings-panel';
import type { ViewSettingsContext } from '../../../../src/tools/database/database-view-settings-panel';
import type { DatabasePanel } from '../../../../src/tools/database/database-panel';
import type { DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'home', name: 'Home', type: 'place', position: 'a1' },
  { id: 'note', name: 'Note', type: 'text', position: 'a2' },
  { id: 'office', name: 'Office', type: 'place', position: 'a3' },
];

const el = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-blok-testid="${id}"]`);

const click = (id: string): void => {
  const target = el(id);

  if (target === null) throw new Error(`no ${id}`);
  target.click();
};

/** The test ids of the open page's rows, in order. */
const rowIds = (): string[] => [...document.querySelectorAll('[data-blok-database-panel-row]')]
  .map((row) => row.getAttribute('data-blok-testid') ?? '');

const harness = (view: Partial<DatabaseViewConfig> = {}): { ctx: ViewSettingsContext; state: { view: DatabaseViewConfig }; open: () => DatabasePanel } => {
  const state = {
    view: { id: 'v', name: 'Map', type: 'map', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...view } satisfies DatabaseViewConfig,
  };
  const holder: { panel: DatabasePanel | null } = { panel: null };
  const apply = (changes: Partial<DatabaseViewConfig>): void => {
    state.view = { ...state.view, ...changes };
    holder.panel?.refresh();
  };
  const ctx: ViewSettingsContext = {
    i18n: { t: (key: string) => key },
    view: () => state.view,
    schema: () => schema,
    locked: () => false,
    layouts: ['table', 'board', 'map'],
    canDeleteView: () => true,
    updateView: vi.fn((changes: Partial<DatabaseViewConfig>) => apply(changes)),
    updatePersonal: vi.fn((patch: Partial<DatabaseViewConfig>) => apply(patch)),
    setLayout: vi.fn((type: DatabaseViewConfig['type']) => apply({ type })),
    setLocked: vi.fn(),
    duplicateView: vi.fn(),
    deleteView: vi.fn(),
    copyViewLink: vi.fn(),
    groups: () => [],
  };
  const anchor = document.createElement('button');

  document.body.appendChild(anchor);

  return {
    ctx,
    state,
    open: () => {
      holder.panel = openViewSettings(anchor, ctx, 'root');

      return holder.panel;
    },
  };
};

describe('map view settings (research/20 §1f)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('lists Layout, Style › Height, Filter, Conditional color, Copy link, Lock, in that order, with no Sort, Group or Property visibility', () => {
    harness().open();

    expect(rowIds().filter((id) => id !== 'database-settings-duplicate' && id !== 'database-settings-delete')).toEqual([
      'database-settings-layout',
      'database-settings-map-height',
      'database-settings-filter',
      'database-settings-color',
      'database-settings-copy-link',
      'database-settings-lock',
    ]);
    const style = el('database-settings-map-height')?.previousElementSibling;

    expect(style?.hasAttribute('data-blok-database-panel-section')).toBe(true);
    expect(style?.textContent).toBe('tools.database.settingsStyle');
  });

  it('offers Small, Medium, Large and Extra large heights, Medium by default', () => {
    const h = harness();

    h.open();
    expect(el('database-settings-map-height')?.textContent).toContain('tools.database.chartHeightMedium');
    click('database-settings-map-height');

    expect(rowIds()).toEqual(['database-map-height-small', 'database-map-height-medium', 'database-map-height-large', 'database-map-height-extraLarge']);
    expect(el('database-map-height-medium')?.getAttribute('aria-checked')).toBe('true');

    click('database-map-height-large');

    expect(h.ctx.updateView).toHaveBeenCalledWith({ mapHeight: 'large' });
    expect(el('database-map-height-large')?.getAttribute('aria-checked')).toBe('true');
  });

  it('the Layout page lists Show page icon, Map by, Open pages in (Center peek) and Load limit (50), with no Wrap', () => {
    harness().open();
    click('database-settings-layout');

    const ids = rowIds();

    expect(ids.slice(ids.indexOf('database-layout-map') + 1)).toEqual([
      'database-settings-page-icon',
      'database-settings-map-by',
      'database-settings-open-pages',
      'database-settings-load-limit',
    ]);
    expect(el('database-settings-map-by')?.textContent).toContain('Home');
    expect(el('database-settings-open-pages')?.textContent).toContain('tools.database.openPagesCenter');
    expect(el('database-settings-load-limit')?.textContent).toContain('50');
  });

  it('Map by lists the place properties only and saves the pick', () => {
    const h = harness();

    h.open();
    click('database-settings-layout');
    click('database-settings-map-by');

    expect(rowIds()).toEqual(['database-map-by-home', 'database-map-by-office']);
    expect(el('database-map-by-home')?.getAttribute('aria-checked')).toBe('true');

    click('database-map-by-office');

    expect(h.ctx.updateView).toHaveBeenCalledWith({ mapBy: 'office' });
    expect(el('database-map-by-office')?.getAttribute('aria-checked')).toBe('true');
  });

  it('marks Center peek as the default for Map', () => {
    harness().open();
    click('database-settings-layout');
    click('database-settings-open-pages');

    expect(el('database-open-pages-center')?.getAttribute('aria-checked')).toBe('true');
    const notes = [...document.querySelectorAll('[data-blok-database-panel-note]')].map((note) => note.textContent);

    expect(notes.indexOf('tools.database.openPagesDefaultFor')).toBe(notes.indexOf('tools.database.openPagesCenterDescription') + 1);
  });
});
