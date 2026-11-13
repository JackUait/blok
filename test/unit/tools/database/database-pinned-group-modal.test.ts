import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pinnedGroupChips } from '../../../../src/tools/database/database-pinned-group-modal';
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
  id: 'v', name: 'Board', type: 'board', position: 'a0', groupBy: 'sel', sorts: [], filters: [], ...overrides,
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

    expect(texts(chips)).toEqual(['Name: tools.database.sortAZ', 'tools.database.filterRuleCount(count=2)']);
    expect(chips[0].getAttribute('data-direction')).toBe('asc');
  });

  // Simple filters join the rule count too (an inference: Notion's modal was read with an advanced filter only).
  it('counts the view\'s simple filters as rules', () => {
    const chips = pinnedGroupChips(view({ filters: [{ id: 'f', propertyId: 'title', operator: 'is_not_empty', value: null }] }), schema, i18n);

    expect(texts(chips)).toEqual(['tools.database.filterRuleCount(count=2)']);
  });

  // Round 26 §1 (r26-pm-key-*.raw): Tab reaches the chips; inside the read-only modal they edit nothing.
  it('draws read-only chips that Tab still reaches', () => {
    const chips = pinnedGroupChips(view({}), schema, i18n);

    expect(chips.every((chip) => chip.tagName === 'BUTTON' && chip.getAttribute('aria-disabled') === 'true' && !chip.hasAttribute('disabled'))).toBe(true);
  });
});
