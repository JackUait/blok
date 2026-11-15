import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPinnedGroupModal, pinnedGroupChips } from '../../../../src/tools/database/database-pinned-group-modal';
import type { PinnedGroupModalHandle } from '../../../../src/tools/database/database-pinned-group-modal';
import { filterPillLabel } from '../../../../src/tools/database/database-filter-labels';
import type { DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

const i18n = {
  t: (key: string, vars?: Record<string, string | number>): string =>
    vars === undefined ? key : `${key}(${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(',')})`,
};

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'sel', name: 'Select', type: 'select', position: 'a1' },
];

const view = (overrides: Partial<DatabaseViewConfig>): DatabaseViewConfig => ({
  id: 'v', name: 'Board', type: 'board', position: 'a0', groupBy: 'sel', sorts: [], filters: [], visibleProperties: [], ...overrides,
});

const texts = (chips: HTMLElement[]): Array<string | null> => chips.map((chip) => chip.getAttribute('aria-label'));

describe('pinnedGroupChips', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // notion-motion.md Round 25 §1 (r25-pinmodal.raw): with no view filter the group's own rule reads "1 rule".
  it('shows the group rule as "1 rule" when the view has no filter', () => {
    expect(texts(pinnedGroupChips(view({}), schema, i18n))).toEqual(['tools.database.filterRuleCount(count=1)']);
  });

  // Round 25 §1 (r25-modal-inherit.raw): the board's sort, then its advanced filter plus the group rule as "2 rules".
  it('shows the view\'s sort, then its rules plus the group rule', () => {
    const chips = pinnedGroupChips(view({
      sorts: [{ id: 's', propertyId: 'title', direction: 'asc' }],
      filterTree: { id: 'root', conjunction: 'and', filterRules: [{ id: 'r', propertyId: 'title', operator: 'is_not_empty', value: null }] },
    }), schema, i18n);

    expect(texts(chips)).toEqual(['Name: tools.database.sortAZ', null, 'tools.database.filterRuleCount(count=2)']);
    expect(chips[0].getAttribute('data-direction')).toBe('asc');
  });

  // notion-motion.md Round 27 §2 "Rule count with a simple filter" (r27-pm-filtered.raw): the count stays 1 and the
  // simple filter keeps its own chip after it, as the toolbar draws it.
  it('keeps a simple filter as its own chip, out of the rule count', () => {
    const filter = { id: 'f', propertyId: 'title', operator: 'contains', value: 'a' };
    const chips = pinnedGroupChips(view({ filters: [filter] }), schema, i18n);
    const name = schema[0];

    expect(texts(chips)).toEqual(['tools.database.filterRuleCount(count=1)', filterPillLabel(filter, name, i18n.t)]);
    expect(chips[1].hasAttribute('aria-disabled')).toBe(false);
    expect(chips[1].hasAttribute('data-active')).toBe(true);
  });

  // Round 27 §2 "Chip row layout" (r27-pm-open.png): a divider parts the sort chip from the filter chips.
  it('parts the sort chip from the filter chips with a divider', () => {
    const chips = pinnedGroupChips(view({ sorts: [{ id: 's', propertyId: 'title', direction: 'asc' }] }), schema, i18n);

    expect(chips.map((chip) => chip.hasAttribute('data-blok-database-chip-divider'))).toEqual([false, true, false]);
    expect(chips[1].hasAttribute('aria-disabled')).toBe(false);
  });

  // Round 26 §1 (r26-pm-key-*.raw): Tab reaches the chips. notion-motion.md Round 38 §1: the sort and filter chips
  // open their editors; the group's "N rules" chip stays read-only here.
  it('draws the sort and filter chips as live buttons, the rules chip read-only', () => {
    const chips = pinnedGroupChips(view({
      sorts: [{ id: 's', propertyId: 'title', direction: 'asc' }],
      filters: [{ id: 'f', propertyId: 'title', operator: 'contains', value: 'a' }],
    }), schema, i18n).filter((chip) => chip.tagName === 'BUTTON');

    expect(chips.every((chip) => !chip.hasAttribute('disabled'))).toBe(true);
    expect(chips.map((chip) => chip.getAttribute('aria-disabled'))).toEqual([null, 'true', null]);
  });
});

/**
 * notion-motion.md Round 38 §1 (r38-pm-chips.raw): the modal's sort and filter chips open the same editors as the
 * toolbar. Edits re-sort and re-filter only the modal's rows and are dropped when it closes.
 */
describe('openPinnedGroupModal chip editors', () => {
  const rows = [{ id: 'r1', title: 'Alpha' }, { id: 'r2', title: 'Gamma' }];
  const q = (id: string): HTMLElement | null => document.querySelector(`[data-blok-testid="${id}"]`);
  const escape = (): void => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  };
  const shown = (): string[] => [...document.querySelectorAll('[data-test-row]')].map((el) => el.textContent ?? '');
  const state: { handle: PinnedGroupModalHandle | null } = { handle: null };

  const open = (start: DatabaseViewConfig): { views: DatabaseViewConfig[]; onClose: ReturnType<typeof vi.fn> } => {
    const views: DatabaseViewConfig[] = [];
    const onClose = vi.fn();

    state.handle = openPinnedGroupModal({
      pill: document.createElement('span'),
      label: 'Todo',
      view: start,
      schema,
      i18n,
      directionSource: null,
      table: (search, local) => {
        const root = document.createElement('div');
        const filter = local.filters.find((f) => f.propertyId === 'title');
        const needle = typeof filter?.value === 'string' ? filter.value : '';
        const sorted = [...rows]
          .filter((row) => row.title.toLowerCase().includes(needle.toLowerCase()) && row.title.includes(search))
          .sort((a, b) => (local.sorts[0]?.direction === 'desc' ? b.title.localeCompare(a.title) : a.title.localeCompare(b.title)));

        views.push(local);
        root.append(...sorted.map((row) => {
          const el = document.createElement('div');

          el.setAttribute('data-test-row', '');
          el.textContent = row.title;

          return el;
        }));

        return { root, destroy: () => undefined };
      },
      onClose,
    });

    return { views, onClose };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    state.handle?.close();
    state.handle = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('re-sorts the modal rows from the sort chip and never touches the view it was given', () => {
    const start = view({ sorts: [{ id: 's', propertyId: 'title', direction: 'asc' }] });
    const before = structuredClone(start);
    const { views } = open(start);

    expect(shown()).toEqual(['Alpha', 'Gamma']);
    q('database-group-modal-sort-chip')?.click();
    expect(q('database-sort-panel')).not.toBeNull();
    q('database-sort-direction-s')?.click();
    // The direction list is a flyout over the editor; the modal stays open under both.
    expect(q('database-sort-direction-picker')).not.toBeNull();
    expect(q('database-sort-direction-picker')?.contains(document.activeElement)).toBe(true);
    q('database-sort-direction-desc')?.click();

    expect(shown()).toEqual(['Gamma', 'Alpha']);
    expect(views[views.length - 1].sorts[0].direction).toBe('desc');
    expect(q('database-group-modal-sort-chip')?.getAttribute('data-direction')).toBe('desc');
    expect(q('database-sort-panel')).not.toBeNull();
    expect(document.querySelector('[data-blok-database-group-modal-panel]')).not.toBeNull();
    expect(start).toEqual(before);
  });

  it('filters the modal rows from a filter chip', () => {
    open(view({ filters: [{ id: 'f', propertyId: 'title', operator: 'contains', value: '' }] }));

    q('database-group-modal-filter-chip-f')?.click();
    const input = document.querySelector<HTMLInputElement>('[data-blok-testid="database-filter-popover"] input');

    expect(input).not.toBeNull();
    if (input === null) return;
    input.value = 'gam';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(shown()).toEqual(['Gamma']);
    expect(document.querySelector('[data-blok-database-group-modal-panel]')).not.toBeNull();
  });

  // Round 27 §2: Escape closes only the editor; the next Escape closes the modal.
  it('peels the editor first on Escape, then the modal', () => {
    const { onClose } = open(view({ sorts: [{ id: 's', propertyId: 'title', direction: 'asc' }] }));

    q('database-group-modal-sort-chip')?.click();
    escape();

    expect(q('database-sort-panel')).toBeNull();
    expect(document.querySelector('[data-blok-database-group-modal-panel]')).not.toBeNull();
    expect(q('database-group-modal-sort-chip')).toHaveFocus();

    escape();

    expect(document.querySelector('[data-blok-database-group-modal-panel]')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Round 26 §1 (r26-pm-key-*.raw): Tab walks the header and the chips. The editor's own Tab handling must stand down.
  it('owns its keyboard, so the editor\'s Tab handling leaves the modal alone', () => {
    open(view({}));

    expect(document.querySelector('[data-blok-database-group-modal]')?.hasAttribute('data-blok-keyboard-owner')).toBe(true);
  });

  it('keeps the modal open on a press inside the editor', () => {
    open(view({ sorts: [{ id: 's', propertyId: 'title', direction: 'asc' }] }));

    q('database-group-modal-sort-chip')?.click();
    const panel = q('database-sort-panel');

    panel?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(document.querySelector('[data-blok-database-group-modal-panel]')).not.toBeNull();
    expect(q('database-sort-panel')).not.toBeNull();
  });
});
