import type { I18n } from '../../../types';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import { PopoverDesktop } from '../../components/utils/popover';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import {
  IconCopy,
  IconEmojiSmile,
  IconInsertLeft,
  IconInsertRight,
  IconLink,
  IconPencil,
  IconSplitView,
  IconTrash,
} from '../../components/icons';
import type { CalculationFn, PropertyDefinition } from './types';

type T = Pick<I18n, 't'>;

/** Menu label of each calculation. The footer shows the same label in capitals. */
export const CALCULATION_LABEL_KEYS: Readonly<Record<CalculationFn, string>> = {
  count: 'tools.database.calcCountAll',
  count_values: 'tools.database.calcCountValues',
  unique: 'tools.database.calcCountUnique',
  empty: 'tools.database.calcCountEmpty',
  not_empty: 'tools.database.calcCountNotEmpty',
  percent_empty: 'tools.database.calcPercentEmpty',
  percent_not_empty: 'tools.database.calcPercentNotEmpty',
  sum: 'tools.database.calcSum',
  average: 'tools.database.calcAverage',
  median: 'tools.database.calcMedian',
  min: 'tools.database.calcMin',
  max: 'tools.database.calcMax',
  range: 'tools.database.calcRange',
  earliest_date: 'tools.database.calcEarliestDate',
  latest_date: 'tools.database.calcLatestDate',
  date_range: 'tools.database.calcDateRange',
  checked: 'tools.database.calcChecked',
  unchecked: 'tools.database.calcUnchecked',
  percent_checked: 'tools.database.calcPercentChecked',
  percent_unchecked: 'tools.database.calcPercentUnchecked',
};

const COUNT_FNS: readonly CalculationFn[] = ['count', 'count_values', 'unique', 'empty', 'not_empty'];
const PERCENT_FNS: readonly CalculationFn[] = ['percent_empty', 'percent_not_empty'];
const NUMBER_FNS: readonly CalculationFn[] = ['sum', 'average', 'median', 'min', 'max', 'range'];
const DATE_FNS: readonly CalculationFn[] = ['earliest_date', 'latest_date', 'date_range'];
const CHECKBOX_COUNT_FNS: readonly CalculationFn[] = ['count', 'checked', 'unchecked'];
const CHECKBOX_PERCENT_FNS: readonly CalculationFn[] = ['percent_checked', 'percent_unchecked'];

/**
 * The calculation menu for one column (research/08): None, Count ›,
 * Percent ›, then More options › for numbers or Date › for dates.
 */
export const calculationItems = (
  property: Pick<PropertyDefinition, 'type'>,
  current: CalculationFn | undefined,
  i18n: T,
  onPick: (fn: CalculationFn | null) => void
): PopoverItemParams[] => {
  const leaf = (fn: CalculationFn): PopoverItemParams => ({
    type: PopoverItemType.Default,
    title: i18n.t(CALCULATION_LABEL_KEYS[fn]),
    isActive: current === fn,
    onActivate: () => onPick(fn),
  });
  const group = (titleKey: string, fns: readonly CalculationFn[]): PopoverItemParams => ({
    type: PopoverItemType.Default,
    title: i18n.t(titleKey),
    isActive: current !== undefined && fns.includes(current),
    children: { items: fns.map(leaf) },
  });
  const checkbox = property.type === 'checkbox';
  const items: PopoverItemParams[] = [
    {
      type: PopoverItemType.Default,
      title: i18n.t('tools.database.calcNone'),
      isActive: current === undefined,
      onActivate: () => onPick(null),
    },
    group('tools.database.calcCount', checkbox ? CHECKBOX_COUNT_FNS : COUNT_FNS),
    group('tools.database.calcPercent', checkbox ? CHECKBOX_PERCENT_FNS : PERCENT_FNS),
  ];

  if (property.type === 'number') {
    items.push(group('tools.database.calcMoreOptions', NUMBER_FNS));
  }
  if (property.type === 'date') {
    items.push(group('tools.database.calcDate', DATE_FNS));
  }

  return items;
};

/** Opens a menu under `anchor`; `data-popover-open` marks the anchor while it is up. */
export const openMenu = (
  anchor: HTMLElement,
  items: PopoverItemParams[],
  options: { searchable?: boolean; onClose?: () => void } = {}
): PopoverDesktop => {
  const popover = new PopoverDesktop({
    trigger: anchor,
    items,
    width: 'auto',
    minWidth: '220px',
    autoFocusFirstItem: false,
    ...(options.searchable === true ? { searchable: true } : {}),
  });

  const state = { closed: false };

  anchor.setAttribute('data-popover-open', '');
  // destroy() emits Closed again; the flag stops that from looping.
  popover.on(PopoverEvent.Closed, () => {
    if (state.closed) {
      return;
    }
    state.closed = true;
    anchor.removeAttribute('data-popover-open');
    options.onClose?.();
    // Destroying inside the popover's own Closed emit would re-enter it.
    queueMicrotask(() => popover.destroy());
  });
  popover.show();

  return popover;
};

export interface HeaderMenuContext {
  i18n: T;
  property: PropertyDefinition;
  /** True when this column ends the frozen block. */
  frozenHere: boolean;
  wrapped: boolean;
  calculation: CalculationFn | undefined;
  onFilter: () => void;
  onSort: () => void;
  onGroup: () => void;
  onCalculate: (fn: CalculationFn | null) => void;
  onFreeze: () => void;
  onUnfreeze: () => void;
  onHide: () => void;
  onWrap: (wrap: boolean) => void;
  onInsert: (side: 'left' | 'right') => void;
}

/**
 * The VIEW-level rows of a column header menu, in Notion's order (research/08).
 * Property-level rows (rename, type, duplicate, delete) belong to the
 * property menu, which puts these after its own.
 */
export const headerViewItems = (ctx: HeaderMenuContext): PopoverItemParams[] => {
  const { i18n, property } = ctx;
  const item = (titleKey: string, onActivate: () => void, icon?: string): PopoverItemParams => ({
    type: PopoverItemType.Default,
    title: i18n.t(titleKey),
    ...(icon !== undefined ? { icon } : {}),
    onActivate,
  });
  const isTitle = property.type === 'title';
  const items: PopoverItemParams[] = [
    item('tools.database.tableFilter', ctx.onFilter),
    item('tools.database.tableSort', ctx.onSort),
    item('tools.database.tableGroup', ctx.onGroup),
    {
      type: PopoverItemType.Default,
      title: i18n.t('tools.database.tableCalculate'),
      children: { items: calculationItems(property, ctx.calculation, i18n, ctx.onCalculate) },
    },
    ctx.frozenHere
      ? item('tools.database.tableUnfreeze', ctx.onUnfreeze)
      : item('tools.database.tableFreeze', ctx.onFreeze),
  ];

  if (!isTitle) {
    items.push(item('tools.database.tableHide', ctx.onHide));
  }
  // Notion offers no wrap toggle on a checkbox column.
  if (property.type !== 'checkbox') {
    items.push(ctx.wrapped
      ? item('tools.database.tableUnwrap', () => ctx.onWrap(false))
      : item('tools.database.tableWrap', () => ctx.onWrap(true)));
  }
  items.push(
    item('tools.database.tableInsertLeft', () => ctx.onInsert('left'), IconInsertLeft),
    item('tools.database.tableInsertRight', () => ctx.onInsert('right'), IconInsertRight)
  );

  return items;
};

export interface RowMenuContext {
  i18n: T;
  /** Columns the row can edit from "Edit property ›". */
  properties: PropertyDefinition[];
  onEditIcon: () => void;
  onEditProperty: (propertyId: string) => void;
  onOpenSidePeek: () => void;
  onCopyLink: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

/** The row ⋮⋮ menu (research/08), without Add to Favorites, Comment and Move to. */
export const rowMenuItems = (ctx: RowMenuContext): PopoverItemParams[] => {
  const { i18n } = ctx;

  return [
    { type: PopoverItemType.Default, title: i18n.t('tools.database.tableEditIcon'), icon: IconEmojiSmile, onActivate: ctx.onEditIcon },
    {
      type: PopoverItemType.Default,
      title: i18n.t('tools.database.tableEditProperty'),
      icon: IconPencil,
      children: {
        items: ctx.properties.map((property) => ({
          type: PopoverItemType.Default,
          title: property.name,
          onActivate: () => ctx.onEditProperty(property.id),
        })),
      },
    },
    {
      type: PopoverItemType.Default,
      title: i18n.t('tools.database.tableOpenIn'),
      icon: IconSplitView,
      children: {
        items: [{ type: PopoverItemType.Default, title: i18n.t('tools.database.tableSidePeek'), icon: IconSplitView, onActivate: ctx.onOpenSidePeek }],
      },
    },
    { type: PopoverItemType.Separator },
    { type: PopoverItemType.Default, title: i18n.t('tools.database.tableCopyLink'), icon: IconLink, onActivate: ctx.onCopyLink },
    { type: PopoverItemType.Default, title: i18n.t('tools.database.tableDuplicate'), icon: IconCopy, secondaryLabel: '⌘D', onActivate: ctx.onDuplicate },
    { type: PopoverItemType.Default, title: i18n.t('tools.database.tableMoveToTrash'), icon: IconTrash, secondaryLabel: 'Del', onActivate: ctx.onDelete },
  ];
};
