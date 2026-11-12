import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { groupIntoMoreMenu } from '../../../../../../src/components/modules/toolbar/inline/more-menu';
import { PopoverItemType } from '../../../../../../src/components/utils/popover';

import type { PopoverItemChildren, PopoverItemDefaultParams, PopoverItemParams } from '@/types';

const OPTIONS = { title: 'More options', icon: '<svg>dots</svg>' };

const button = (name: string, extra: Partial<PopoverItemDefaultParams> = {}): PopoverItemParams => ({
  type: PopoverItemType.Default,
  name,
  icon: `<svg>${name}</svg>`,
  hint: { title: name },
  onActivate: () => undefined,
  ...extra,
});

const supSub = (onOpen = vi.fn(), onClose = vi.fn(), active = { sup: false, sub: false }): PopoverItemParams => ({
  type: PopoverItemType.Default,
  name: 'sup-sub',
  icon: '<svg>x2</svg>',
  hint: { title: 'Superscript & subscript' },
  children: {
    hideChevron: true,
    items: [
      { name: 'superscript', title: 'Superscript', icon: '<svg>sup</svg>', closeOnActivate: true, isActive: () => active.sup, onActivate: () => undefined },
      { name: 'subscript', title: 'Subscript', icon: '<svg>sub</svg>', closeOnActivate: true, isActive: () => active.sub, onActivate: () => undefined },
    ],
    onOpen,
    onClose,
  },
});

const namesOf = (items: PopoverItemParams[]): Array<string | undefined> => items.map((item) => ('name' in item ? item.name : item.type));

type MoreItem = PopoverItemDefaultParams & { children: PopoverItemChildren };

const moreOf = (items: PopoverItemParams[]): MoreItem => {
  const more = items.find((item) => 'name' in item && item.name === 'more');

  if (more === undefined || more.type === PopoverItemType.Html || more.type === PopoverItemType.Separator || !('children' in more)) {
    throw new Error('no More item');
  }

  return more;
};

const rowsOf = (items: PopoverItemParams[]): PopoverItemDefaultParams[] =>
  (moreOf(items).children.items ?? []).filter((item): item is PopoverItemDefaultParams => item.type === undefined || item.type === PopoverItemType.Default);

const resolve = (value: boolean | (() => boolean) | undefined): boolean => (typeof value === 'function' ? value() : value === true);

describe('groupIntoMoreMenu', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('moves Equation and Superscript & subscript into a ⋯ button at the end, keeping Hint and custom tools in the grid', () => {
    const items = groupIntoMoreMenu([
      button('bold'),
      button('inlineCode'),
      button('equation'),
      supSub(),
      button('annotation'),
      button('myCustomTool'),
    ], OPTIONS);

    expect(namesOf(items)).toEqual(['bold', 'inlineCode', 'annotation', 'myCustomTool', 'more']);
  });

  it('lists Equation, then Superscript and Subscript as two rows of their own', () => {
    const items = groupIntoMoreMenu([button('bold'), button('equation', { hint: { title: 'Equation', description: '⌘⇧E' } }), supSub()], OPTIONS);

    expect(rowsOf(items).map((row) => [row.name, row.title])).toEqual([
      ['equation', 'Equation'],
      ['superscript', 'Superscript'],
      ['subscript', 'Subscript'],
    ]);
    // The shortcut moves from the hover hint to the row, where a menu shows it.
    expect(rowsOf(items)[0].secondaryLabel).toBe('⌘⇧E');
    expect(rowsOf(items)[0].hint).toBeUndefined();
  });

  it('shows the ⋯ button with its own icon and hint, and no chevron', () => {
    const more = moreOf(groupIntoMoreMenu([button('equation')], OPTIONS));

    expect(more.icon).toBe(OPTIONS.icon);
    expect(more.hint?.title).toBe('More options');
    expect(more.children.hideChevron).toBe(true);
  });

  // The inline toolbar opens nested menus below by default; this one opens to its right.
  it('opens the ⋯ menu to the right of the toolbar, top edge on the ⋯ button', () => {
    const more = moreOf(groupIntoMoreMenu([button('equation')], OPTIONS));

    expect(more.children.placement).toBe('beside');
    expect(more.children.align).toBe('start');
  });

  it('marks ⋯ active while a tool inside it is on', () => {
    const active = { sup: false, sub: false };
    const more = moreOf(groupIntoMoreMenu([button('bold'), supSub(vi.fn(), vi.fn(), active)], OPTIONS));

    expect(resolve(more.isActive)).toBe(false);
    active.sub = true;
    expect(resolve(more.isActive)).toBe(true);
  });

  // Superscript and Subscript restore the selection that their menu saved on open.
  it('runs the Superscript & subscript menu open and close hooks when ⋯ opens and closes', () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const more = moreOf(groupIntoMoreMenu([supSub(onOpen, onClose)], OPTIONS));

    more.children.onOpen?.();
    expect(onOpen).toHaveBeenCalledTimes(1);
    more.children.onClose?.();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('puts ⋯ before the Ask AI row and its rule', () => {
    const askAi: PopoverItemParams = { type: PopoverItemType.Html, element: document.createElement('div'), name: 'askAi' };
    const items = groupIntoMoreMenu([button('bold'), button('equation'), { type: PopoverItemType.Separator }, askAi], OPTIONS);

    expect(namesOf(items)).toEqual(['bold', 'more', PopoverItemType.Separator, 'askAi']);
  });

  it('adds no ⋯ when none of its tools is in the toolbar', () => {
    const items = [button('bold'), button('italic')];

    expect(groupIntoMoreMenu(items, OPTIONS)).toEqual(items);
  });
});
