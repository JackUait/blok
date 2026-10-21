import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PopoverDesktop } from '../../../../../src/components/utils/popover/popover-desktop';
import type { PopoverItemDefaultBaseParams } from '../../../../../types/utils/popover/popover-item';

const item = (overrides: Partial<PopoverItemDefaultBaseParams> & { title: string }): PopoverItemDefaultBaseParams => ({
  icon: '<svg></svg>',
  onActivate: () => {},
  ...overrides,
});

const row = (popover: PopoverDesktop, name: string): HTMLElement | null =>
  popover.getElement().querySelector<HTMLElement>(`[data-blok-item-name="${name}"]`);

const suffixOf = (popover: PopoverDesktop, name: string): HTMLElement | null =>
  row(popover, name)?.querySelector<HTMLElement>('[data-blok-popover-item-search-suffix]') ?? null;

describe('popover item searchSuffix (research/28 §1b)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const build = (): PopoverDesktop => new PopoverDesktop({
    searchable: true,
    items: [
      item({ title: 'Table view', name: 'tableView', searchSuffix: 'Database' }),
      item({ title: 'Text', name: 'text' }),
    ],
  });

  it('is hidden while the menu shows its sections', () => {
    const popover = build();

    expect(suffixOf(popover, 'tableView')?.hidden).toBe(true);
  });

  it('shows "· <suffix>" after the title in search results', () => {
    const popover = build();

    popover.filterItems('table');

    const suffix = suffixOf(popover, 'tableView');

    expect(suffix?.hidden).toBe(false);
    expect(suffix?.textContent).toBe('· Database');
    expect(suffix?.previousElementSibling?.hasAttribute('data-blok-popover-item-title')).toBe(true);
  });

  it('hides again when the query is cleared', () => {
    const popover = build();

    popover.filterItems('table');
    popover.filterItems('');

    expect(suffixOf(popover, 'tableView')?.hidden).toBe(true);
  });

  it('stays out of the title text and the search: "/database" does not match a row by its suffix', () => {
    const popover = build();

    expect(row(popover, 'tableView')?.querySelector('[data-blok-popover-item-title]')?.textContent).toBe('Table view');
    popover.filterItems('database');

    expect(row(popover, 'tableView')?.hasAttribute('data-blok-hidden')).toBe(true);
  });

  it('renders nothing for an item without one', () => {
    const popover = build();

    popover.filterItems('text');

    expect(suffixOf(popover, 'text')).toBeNull();
  });
});

// research/28 §2: "/list" highlights List view and "/database" Database - Inline, though both tie with an alias.
describe('popover search tie-break', () => {
  const visibleNames = (popover: PopoverDesktop): Array<string | null> =>
    [...popover.getElement().querySelectorAll('[data-blok-item-name]:not([data-blok-hidden])')].map((el) => el.getAttribute('data-blok-item-name'));

  it('at the same score, a title match ranks above an alias match', () => {
    const popover = new PopoverDesktop({
      searchable: true,
      items: [
        item({ title: 'Bulleted list', name: 'bulleted', searchTerms: ['list'] }),
        item({ title: 'List view', name: 'listView', searchTerms: ['list'] }),
      ],
    });

    popover.filterItems('list');

    expect(visibleNames(popover)).toEqual(['listView', 'bulleted']);
  });

  it('the title match goes first; the alias-only matches keep the menu order', () => {
    const popover = new PopoverDesktop({
      searchable: true,
      items: [
        item({ title: 'Table view', name: 'tableView', searchTerms: ['database'] }),
        item({ title: 'Board view', name: 'board', searchTerms: ['database'] }),
        item({ title: 'Database - Inline', name: 'database', searchTerms: ['database'] }),
      ],
    });

    popover.filterItems('database');

    expect(visibleNames(popover)).toEqual(['database', 'tableView', 'board']);
  });
});

describe('the "· Database" suffix ink (research/28 §1b light, research/30 B4 dark)', () => {
  const colors = readFileSync(resolve(__dirname, '../../../../../src/styles/colors.css'), 'utf-8');

  it('paints the suffix with its own token', () => {
    const popover = new PopoverDesktop({ searchable: true, items: [item({ title: 'Table view', name: 'tableView', searchSuffix: 'Database' })] });

    expect(suffixOf(popover, 'tableView')?.className).toContain('[color:var(--blok-popover-search-suffix-text)]');
  });

  it('is rgb(161, 158, 153) in light and rgb(125, 122, 117) in both dark blocks', () => {
    const values = [...colors.matchAll(/--blok-popover-search-suffix-text:\s*([^;]+);/g)].map((match) => match[1]);

    expect(values).toEqual([ 'rgb(161, 158, 153)', 'rgb(125, 122, 117)', 'rgb(125, 122, 117)' ]);
  });
});
