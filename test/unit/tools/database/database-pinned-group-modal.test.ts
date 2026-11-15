import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPinnedGroupModal, pinnedGroupChips, pinnedGroupRule } from '../../../../src/tools/database/database-pinned-group-modal';
import type { PinnedGroupModalHandle } from '../../../../src/tools/database/database-pinned-group-modal';
import { filterPillLabel } from '../../../../src/tools/database/database-filter-labels';
import { NO_VALUE_GROUP_KEY } from '../../../../src/tools/database/group-keys';
import type { DatabaseViewConfig, FilterRule, PropertyDefinition } from '../../../../src/tools/database/types';

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

  // Round 39 §1 (r39-pm-nrules.raw): a 2-rule view filter is one wrapped group, so the chip still reads "2 rules".
  it('counts the view\'s rules as one group beside the group rule', () => {
    const rule = { id: 'r', propertyId: 'title', operator: 'is_not_empty', value: null };
    const chips = pinnedGroupChips(view({ filterTree: { id: 'root', conjunction: 'and', filterRules: [rule, { ...rule, id: 'r2' }] } }), schema, i18n);

    expect(texts(chips)).toEqual(['tools.database.filterRuleCount(count=2)']);
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

  // notion-motion.md Round 39 §1: "2 sorts" is 94 wide and "1 rule" 83.8. Their glyphs are narrow: arrowUpDownSmall
  // 12.7×16 (r35-sort2.raw) and filterSmall 12.6×16 (r26-pm-modal.raw). A property glyph keeps its 16 box.
  it('marks the sort-count and rule-count glyphs so they take Notion\'s narrow boxes', () => {
    const chips = pinnedGroupChips(view({
      sorts: [{ id: 's', propertyId: 'title', direction: 'asc' }, { id: 's2', propertyId: 'sel', direction: 'asc' }],
      filters: [{ id: 'f', propertyId: 'title', operator: 'contains', value: 'a' }],
    }), schema, i18n).filter((chip) => chip.tagName === 'BUTTON');
    const glyphs = chips.map((chip) => chip.querySelector('[data-blok-database-chip-glyph]')?.getAttribute('data-blok-database-chip-glyph'));

    expect(glyphs).toEqual(['sort', 'filter', '']);
  });

  it('keeps the one-sort arrow glyph unmarked', () => {
    const [chip] = pinnedGroupChips(view({ sorts: [{ id: 's', propertyId: 'title', direction: 'asc' }] }), schema, i18n);

    expect(chip.querySelector('[data-blok-database-chip-glyph]')?.getAttribute('data-blok-database-chip-glyph')).toBe('');
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

  const open = (start: DatabaseViewConfig, groupRule?: FilterRule): { views: DatabaseViewConfig[]; onClose: ReturnType<typeof vi.fn> } => {
    const views: DatabaseViewConfig[] = [];
    const onClose = vi.fn();

    state.handle = openPinnedGroupModal({
      pill: document.createElement('span'),
      label: 'Todo',
      view: start,
      schema,
      i18n,
      directionSource: null,
      ...(groupRule === undefined ? {} : { groupRule }),
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

  // notion-motion.md Round 27 §2 (r27-pm-sortpop.raw) and Round 38 §1 (r38-pm-sort-za.png): the modal's sort editor is
  // 290×107 with Name at +12. It has no drag handle and no × on the rule; the toolbar's 304 editor keeps both.
  it('opens the sort editor without a drag handle or a × on the rule, at least 290 wide', () => {
    open(view({ sorts: [{ id: 's', propertyId: 'title', direction: 'asc' }] }));

    q('database-group-modal-sort-chip')?.click();
    const panel = q('database-sort-panel');

    expect(panel?.querySelector('[data-blok-database-panel-handle]')).toBeNull();
    expect(q('database-sort-remove-s')).toBeNull();
    expect(q('database-sort-property-s')).not.toBeNull();
    expect(panel?.hasAttribute('data-blok-database-sort-compact')).toBe(true);
    expect(panel?.style.minWidth).toBe('290px');
  });

  // notion-motion.md Round 27 §2 (r27-pm-rulepop.raw): the "1 rule" chip opens the advanced rule editor under it,
  // holding the group's own rule. Round 38 §1: edits stay in the modal.
  it('opens the advanced rule editor from the rules chip, on the modal\'s own copy', () => {
    const groupRule: FilterRule = { id: 'g', propertyId: 'sel', operator: 'equals', value: ['red'] };
    const start = view({});
    const before = structuredClone(start);
    const { views } = open(start, groupRule);
    const chip = q('database-group-modal-rules-chip');

    expect(chip?.hasAttribute('aria-disabled')).toBe(false);
    expect(views[views.length - 1].filterTree?.filterRules).toEqual([groupRule]);
    chip?.click();

    expect(q('database-advanced-filter')).not.toBeNull();
    expect(q('database-filter-delete-advanced')).not.toBeNull();
    expect(chip?.hasAttribute('data-popover-open')).toBe(true);

    q('database-filter-delete-advanced')?.click();

    expect(views[views.length - 1].filterTree?.filterRules).toEqual([]);
    expect(q('database-group-modal-rules-chip')).toBeNull();
    expect(q('database-advanced-filter')).toBeNull();
    expect(document.querySelector('[data-blok-database-group-modal-panel]')).not.toBeNull();
    expect(start).toEqual(before);
  });

  // notion-motion.md Round 39 §1 (r39-pm-nrules.raw): the view's rules come first, wrapped in one group, and the
  // group's rule is last at the top level. The chip counts top-level items: "2 rules".
  it('wraps the view\'s own rules in a group and puts the group rule last', () => {
    const groupRule: FilterRule = { id: 'g', propertyId: 'sel', operator: 'equals', value: ['red'] };
    const own: FilterRule = { id: 'r', propertyId: 'title', operator: 'is_not_empty', value: null };

    for (const conjunction of ['and', 'or'] as const) {
      const tree = { id: 'root', conjunction, filterRules: [own, { ...own, id: 'r2' }] };
      const { views } = open(view({ filterTree: tree }), groupRule);
      const local = views[views.length - 1].filterTree;

      expect(local?.conjunction).toBe('and');
      expect(local?.filterRules).toEqual([tree, groupRule]);
      expect(q('database-group-modal-rules-chip')?.getAttribute('aria-label')).toBe('tools.database.filterRuleCount(count=2)');
      state.handle?.close();
    }
  });

  // Round 39 §1: removing the group rule leaves the view's own rules in force (the modal shows what the view allows).
  it('keeps the view\'s rules after the group rule is removed', () => {
    const groupRule: FilterRule = { id: 'g', propertyId: 'sel', operator: 'equals', value: ['red'] };
    const tree = { id: 'root', conjunction: 'and' as const, filterRules: [{ id: 'r', propertyId: 'title', operator: 'is_not_empty', value: null }] };
    const { views } = open(view({ filterTree: tree }), groupRule);

    q('database-group-modal-rules-chip')?.click();
    q('database-filter-rule-more-g')?.click();
    document.querySelector<HTMLElement>('[data-blok-testid="database-filter-remove"]')?.click();

    expect(views[views.length - 1].filterTree?.filterRules).toEqual([tree]);
    expect(q('database-group-modal-rules-chip')?.getAttribute('aria-label')).toBe('tools.database.filterRuleCount(count=1)');
  });

  // The wrapped group is the view's own tree; an edit to one of its rules must stay in the modal.
  it('leaves the view untouched when a wrapped view rule is removed', () => {
    const rule: FilterRule = { id: 'r', propertyId: 'title', operator: 'is_not_empty', value: null };
    const start = view({ filterTree: { id: 'root', conjunction: 'and', filterRules: [rule, { ...rule, id: 'r2' }] } });
    const before = structuredClone(start);
    const { views } = open(start, { id: 'g', propertyId: 'sel', operator: 'equals', value: ['red'] });

    q('database-group-modal-rules-chip')?.click();
    q('database-filter-rule-more-r')?.click();
    document.querySelector<HTMLElement>('[data-blok-testid="database-filter-remove"]')?.click();

    expect(views[views.length - 1].filterTree?.filterRules[0]).toMatchObject({ filterRules: [{ ...rule, id: 'r2' }] });
    expect(start).toEqual(before);
  });

  // notion-motion.md Round 27 §2 (r27-pm-rulepop.raw): a click on the modal's body closes the open editor, not the modal.
  it('closes a chip editor on a press in the modal body', () => {
    open(view({}), { id: 'g', propertyId: 'sel', operator: 'equals', value: ['red'] });

    q('database-group-modal-rules-chip')?.click();
    expect(q('database-advanced-filter')).not.toBeNull();
    document.querySelector('[data-test-row]')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(q('database-advanced-filter')).toBeNull();
    expect(document.querySelector('[data-blok-database-group-modal-panel]')).not.toBeNull();
  });

  it('keeps the rules chip read-only when the group\'s rule cannot be written as a filter', () => {
    const { views } = open(view({}));

    expect(q('database-group-modal-rules-chip')?.getAttribute('aria-disabled')).toBe('true');
    expect(views[views.length - 1].filterTree).toBeUndefined();
    q('database-group-modal-rules-chip')?.click();
    expect(q('database-advanced-filter')).toBeNull();
  });
});

describe('pinnedGroupRule', () => {
  const groups = [{ id: 'todo', kind: 'todo' as const, name: 'To-do', position: 'a0' }, { id: 'done', kind: 'complete' as const, name: 'Done', position: 'a1' }];
  const status: PropertyDefinition = {
    id: 'st', name: 'Status', type: 'status', position: 'a2', status: { groups },
    config: { options: [{ id: 's1', label: 'Not started', groupId: 'todo', position: 'a0' }, { id: 's2', label: 'Later', groupId: 'todo', position: 'a1' }, { id: 's3', label: 'Done', groupId: 'done', position: 'a2' }] },
  };
  const strip = (rule: FilterRule | null): Omit<FilterRule, 'id'> | null => {
    if (rule === null) return null;
    const { id: _id, ...rest } = rule;

    return rest;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes an option group as "is" that option, and the empty group as "is empty"', () => {
    expect(strip(pinnedGroupRule(schema[1], 'red', undefined))).toEqual({ propertyId: 'sel', operator: 'equals', value: ['red'] });
    expect(strip(pinnedGroupRule(schema[1], NO_VALUE_GROUP_KEY, undefined))).toEqual({ propertyId: 'sel', operator: 'is_empty', value: null });
    expect(strip(pinnedGroupRule(status, 's1', undefined))).toEqual({ propertyId: 'st', operator: 'equals', value: ['s1'] });
  });

  it('writes a status group as its member options', () => {
    expect(strip(pinnedGroupRule(status, 'todo', 'group'))).toEqual({ propertyId: 'st', operator: 'equals', value: ['s1', 's2'] });
  });

  it('writes a multi-select or person group as "contains"', () => {
    const multi: PropertyDefinition = { id: 'ms', name: 'Tags', type: 'multiSelect', position: 'a3' };
    const person: PropertyDefinition = { id: 'p', name: 'Owner', type: 'person', position: 'a4' };

    expect(strip(pinnedGroupRule(multi, 'm1', undefined))).toEqual({ propertyId: 'ms', operator: 'contains', value: ['m1'] });
    expect(strip(pinnedGroupRule(person, 'u1', undefined))).toEqual({ propertyId: 'p', operator: 'contains', value: ['u1'] });
    expect(strip(pinnedGroupRule(person, NO_VALUE_GROUP_KEY, undefined))).toEqual({ propertyId: 'p', operator: 'is_empty', value: null });
  });

  it('has no rule for groups keyed by a bucket or a letter', () => {
    const date: PropertyDefinition = { id: 'd', name: 'Due', type: 'date', position: 'a5' };
    const text: PropertyDefinition = { id: 'tx', name: 'Text', type: 'text', position: 'a6' };

    expect(pinnedGroupRule(date, '2026-11', undefined)).toBeNull();
    expect(pinnedGroupRule(text, 'A', undefined)).toBeNull();
  });
});
