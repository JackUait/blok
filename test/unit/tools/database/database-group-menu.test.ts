import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { I18n } from '../../../../types';
import type { PopoverItemParams } from '../../../../types/utils/popover/popover-item';
import { groupMenuItems, type GroupMenuParams } from '../../../../src/tools/database/database-group-menu';
import { OPTION_COLORS } from '../../../../src/tools/database/cells/option-colors';
import { IconCheck } from '../../../../src/components/icons';

const i18n = { t: (key: string) => key, has: () => true } as unknown as I18n;

const params = (overrides: Partial<GroupMenuParams> = {}): GroupMenuParams => ({
  i18n,
  isNoValue: false,
  color: 'yellow',
  aggregationHidden: false,
  groups: [
    { id: 'opt-a', label: 'Idea', hidden: false },
    { id: 'opt-b', label: 'Build', hidden: true },
  ],
  onToggleGroup: vi.fn(),
  onToggleAggregation: vi.fn(),
  onHide: vi.fn(),
  onTrash: vi.fn(),
  onRecolor: vi.fn(),
  ...overrides,
});

type Item = PopoverItemParams & { name?: string; title?: string; trailingIcon?: string; isDestructive?: boolean;
  onActivate?: () => void; children?: { items?: PopoverItemParams[] }; icon?: string | HTMLElement };

const named = (items: PopoverItemParams[], name: string): Item => {
  const found = (items as Item[]).find((item) => item.name === name);

  if (found === undefined) throw new Error(`no item named ${name}`);

  return found;
};

describe('groupMenuItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists Edit groups, Hide aggregation, Hide group and Move to Trash, then the ten colors', () => {
    const items = groupMenuItems(params()) as Item[];
    const names = items.map((item) => item.name ?? item.type);

    expect(names.slice(0, 4)).toEqual(['edit-groups', 'toggle-aggregation', 'hide-group', 'move-to-trash']);
    expect(names.slice(5)).toEqual(OPTION_COLORS.map((color) => `color-${color}`));
    expect(named(items, 'move-to-trash').isDestructive).toBe(true);
  });

  it('marks the current color with a check mark, and no other', () => {
    const items = groupMenuItems(params({ color: 'yellow' }));

    expect(named(items, 'color-yellow').trailingIcon).toBe(IconCheck);
    expect(OPTION_COLORS.filter((color) => named(items, `color-${color}`).trailingIcon !== undefined)).toEqual(['yellow']);
  });

  it('recolors the group with the picked color', () => {
    const p = params();

    named(groupMenuItems(p), 'color-pink').onActivate?.();

    expect(p.onRecolor).toHaveBeenCalledWith('pink');
  });

  it('gives the no-value group no colors', () => {
    const names = (groupMenuItems(params({ isNoValue: true, color: undefined })) as Item[]).map((item) => item.name);

    expect(names.some((name) => name?.startsWith('color-'))).toBe(false);
  });

  it('lists every group under Edit groups, with a check mark on the shown ones, and toggles one on pick', () => {
    const p = params();
    const children = named(groupMenuItems(p), 'edit-groups').children?.items as Item[];

    expect(children.map((item) => item.title)).toEqual(['Idea', 'Build']);
    expect(children.map((item) => item.trailingIcon)).toEqual([IconCheck, undefined]);

    children[1].onActivate?.();

    expect(p.onToggleGroup).toHaveBeenCalledWith('opt-b');
  });

  it('offers to show the counts again once they are hidden', () => {
    expect(named(groupMenuItems(params()), 'toggle-aggregation').title).toBe('tools.database.groupHideAggregation');
    expect(named(groupMenuItems(params({ aggregationHidden: true })), 'toggle-aggregation').title).toBe('tools.database.groupShowAggregation');
  });

  it('routes Hide group, Move to Trash and the count toggle to their handlers', () => {
    const p = params();
    const items = groupMenuItems(p);

    named(items, 'hide-group').onActivate?.();
    named(items, 'move-to-trash').onActivate?.();
    named(items, 'toggle-aggregation').onActivate?.();

    expect(p.onHide).toHaveBeenCalledTimes(1);
    expect(p.onTrash).toHaveBeenCalledTimes(1);
    expect(p.onToggleAggregation).toHaveBeenCalledTimes(1);
  });
});
