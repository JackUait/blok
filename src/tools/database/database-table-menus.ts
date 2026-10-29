import type { I18n } from '../../../types';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import { DATABASE_MENU_CLASS } from './database-group-menu';
import { PopoverDesktop } from '../../components/utils/popover';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import {
  IconArrowDiagonal,
  IconCheck,
  IconCopy,
  IconExpandFullscreen,
  IconEmojiSmile,
  IconEmojiStar,
  IconEyeSlash,
  IconFilter,
  IconInsertLeft,
  IconInsertRight,
  IconLink,
  IconList,
  IconListBulleted,
  IconMessage,
  IconPageLayout,
  IconPin,
  IconPreview,
  IconReturn,
  IconSigma,
  IconSort,
  IconSplitView,
  IconTrash,
} from '../../components/icons';
import { beautifyShortcut } from '../../components/utils/string';
import { CALCULATIONS_FOR_TYPE } from './database-calculations';
import type { CalculationFn, DatabaseRow, OpenPagesIn, PropertyDefinition } from './types';
import { formatClock, formatRelativeStamp } from './cells/date-format';
import { toLocalDay } from './relative-dates';

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

export const COUNT_FNS: readonly CalculationFn[] = ['count', 'count_values', 'unique', 'empty', 'not_empty'];
export const PERCENT_FNS: readonly CalculationFn[] = ['percent_empty', 'percent_not_empty'];
export const NUMBER_FNS: readonly CalculationFn[] = ['sum', 'average', 'median', 'min', 'max', 'range'];
export const DATE_FNS: readonly CalculationFn[] = ['earliest_date', 'latest_date', 'date_range'];
const CHECKBOX_COUNT_FNS: readonly CalculationFn[] = ['count', 'checked', 'unchecked'];
const CHECKBOX_PERCENT_FNS: readonly CalculationFn[] = ['percent_checked', 'percent_unchecked'];

/** The column's "Show large counts as 99+" state and its toggle. */
export interface CountCap {
  capCounts: boolean;
  onCapCounts: (cap: boolean) => void;
}

/**
 * The calculation menu for one column (research/08): None, Count ›,
 * Percent ›, then More options › for numbers or Date › for dates and
 * created/edited time. Count opens with the 99+ toggle, except on a checkbox.
 */
export const calculationItems = (
  property: Pick<PropertyDefinition, 'type'>,
  current: CalculationFn | undefined,
  i18n: T,
  onPick: (fn: CalculationFn | null) => void,
  cap?: CountCap
): PopoverItemParams[] => {
  const leaf = (fn: CalculationFn): PopoverItemParams => ({
    type: PopoverItemType.Default,
    name: `database-calc-${fn}`,
    title: i18n.t(CALCULATION_LABEL_KEYS[fn]),
    isActive: current === fn,
    onActivate: () => onPick(fn),
  });
  const group = (titleKey: string, fns: readonly CalculationFn[], lead: PopoverItemParams[] = []): PopoverItemParams => ({
    type: PopoverItemType.Default,
    title: i18n.t(titleKey),
    isActive: current !== undefined && fns.includes(current),
    children: { items: [...lead, ...fns.map(leaf)] },
  });
  const checkbox = property.type === 'checkbox';
  const offered = CALCULATIONS_FOR_TYPE[property.type] ?? [];
  const capToggle: PopoverItemParams[] = cap === undefined || checkbox
    ? []
    : [{
      type: PopoverItemType.Default,
      name: 'database-calc-cap-counts',
      title: i18n.t('tools.database.calcShowLargeCounts'),
      isActive: cap.capCounts,
      onActivate: () => cap.onCapCounts(!cap.capCounts),
    }];
  const items: PopoverItemParams[] = [
    {
      type: PopoverItemType.Default,
      name: 'database-calc-none',
      title: i18n.t('tools.database.calcNone'),
      isActive: current === undefined,
      onActivate: () => onPick(null),
    },
    group('tools.database.calcCount', checkbox ? CHECKBOX_COUNT_FNS : COUNT_FNS, capToggle),
    group('tools.database.calcPercent', checkbox ? CHECKBOX_PERCENT_FNS : PERCENT_FNS),
  ];

  if (offered.includes('sum')) {
    items.push(group('tools.database.calcMoreOptions', NUMBER_FNS));
  }
  if (offered.includes('earliest_date')) {
    items.push(group('tools.database.calcDate', DATE_FNS));
  }

  return items;
};

/** A column header menu: 28px rows and no 400px cap (database.css). */
export const DATABASE_HEADER_MENU_CLASS = `${DATABASE_MENU_CLASS} blok-database-header-menu`;
/** The table row menu: 29px rows (database.css). */
const DATABASE_ROW_MENU_CLASS = `${DATABASE_MENU_CLASS} blok-database-row-menu`;
/** The same row menu from a card's "•••" or a right-click: 265 wide and no 400px cap (database.css, feel findings B15). */
const DATABASE_CARD_MENU_CLASS = `${DATABASE_ROW_MENU_CLASS} blok-database-card-menu`;

export interface OpenMenuOptions {
  searchable?: boolean;
  searchPlaceholder?: string;
  onClose?: () => void;
  /**
   * Which database menu this is: its row size comes from the class. A row menu opens left of its ⋮⋮;
   * a card menu is the same row menu, opened over its "•••".
   */
  kind?: 'header' | 'row' | 'card';
}

const MENU_CLASS = { header: DATABASE_HEADER_MENU_CLASS, row: DATABASE_ROW_MENU_CLASS, card: DATABASE_CARD_MENU_CLASS } as const;

/** Opens a menu under `anchor`; `data-popover-open` marks the anchor while it is up. */
export const openMenu = (
  anchor: HTMLElement,
  items: PopoverItemParams[],
  options: OpenMenuOptions = {}
): PopoverDesktop => {
  const menuClass = options.kind === undefined ? DATABASE_MENU_CLASS : MENU_CLASS[options.kind];
  const popover = new PopoverDesktop({
    class: menuClass,
    ...(options.kind === 'row' ? { placeLeftOfAnchor: true, viewportMargin: 8 } : {}),
    animateClose: true,
    trigger: anchor,
    items,
    width: 'auto',
    minWidth: options.kind === 'card' ? '265px' : '220px',
    // A card's menu opens over its "•••", shifted to stay in the window (feel findings B15, 09-notion-card-menu.png).
    ...(options.kind === 'card' ? { cover: true } : {}),
    autoFocusFirstItem: false,
    ...(options.searchable === true ? { searchable: true } : {}),
    ...(options.searchPlaceholder !== undefined ? { messages: { search: options.searchPlaceholder } } : {}),
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
  showPageIcon: boolean;
  calculation: CalculationFn | undefined;
  countCap?: CountCap;
  onFilter: () => void;
  onSort: () => void;
  onGroup: () => void;
  onCalculate: (fn: CalculationFn | null) => void;
  onFreeze: () => void;
  onUnfreeze: () => void;
  onHide: () => void;
  onWrap: (wrap: boolean) => void;
  onShowPageIcon: (show: boolean) => void;
  onInsert: (side: 'left' | 'right') => void;
}

/** The property menu puts AI Autofill right after this row (research/08). */
export const SHOW_PAGE_ICON_ITEM = 'database-show-page-icon';

/**
 * The VIEW-level rows of a column header menu, in Notion's order (research/08).
 * Property-level rows (rename, type, duplicate, delete) belong to the
 * property menu, which puts these after its own.
 */
export const headerViewItems = (ctx: HeaderMenuContext): PopoverItemParams[] => {
  const { i18n, property } = ctx;
  // Personal edits can clone the view backing this menu.
  const state = { showPageIcon: ctx.showPageIcon };
  // `name` is a variable on purpose: the agent-coverage ledger covers these rows by file.
  const item = (name: string, titleKey: string, onActivate: () => void, icon: string): PopoverItemParams => ({
    type: PopoverItemType.Default,
    name,
    title: i18n.t(titleKey),
    icon,
    onActivate,
  });
  const isTitle = property.type === 'title';
  // A button holds no value: nothing to filter, sort, group or calculate.
  const queryable = property.type !== 'button';
  const calculate: PopoverItemParams = {
    type: PopoverItemType.Default,
    title: i18n.t('tools.database.tableCalculate'),
    icon: IconSigma,
    children: { items: calculationItems(property, ctx.calculation, i18n, ctx.onCalculate, ctx.countCap) },
  };
  // research/08: Files and ID offer no Group; research/20 §1d: nor does Place. None can group a view.
  const groupable = property.type !== 'files' && property.type !== 'uniqueId' && property.type !== 'place';
  const queries: PopoverItemParams[] = queryable
    ? [
      item('database-header-filter', 'tools.database.tableFilter', ctx.onFilter, IconFilter),
      // notion-live-7/80-menu-text.png: Sort shows a "›"; it opens the two sort choices.
      { ...item('database-header-sort', 'tools.database.tableSort', ctx.onSort, IconSort), chevron: true },
      ...(groupable ? [item('database-header-group', 'tools.database.tableGroup', ctx.onGroup, IconList)] : []),
      calculate,
    ]
    : [];
  // research/08: Title starts with Show page icon, before Filter.
  const lead: PopoverItemParams[] = isTitle
    ? [{
      type: PopoverItemType.Default,
      name: SHOW_PAGE_ICON_ITEM,
      title: i18n.t('tools.database.settingsShowPageIcon'),
      icon: IconEmojiSmile,
      trailingIcon: IconCheck,
      isActive: () => state.showPageIcon,
      closeOnActivate: false,
      onActivate: () => {
        const next = !state.showPageIcon;

        ctx.onShowPageIcon(next);
        state.showPageIcon = next;
      },
    }]
    : [];
  const items: PopoverItemParams[] = [
    ...lead,
    ...queries,
    ctx.frozenHere
      ? item('database-header-unfreeze', 'tools.database.tableUnfreeze', ctx.onUnfreeze, IconPin)
      : item('database-header-freeze', 'tools.database.tableFreeze', ctx.onFreeze, IconPin),
  ];

  if (!isTitle) {
    items.push(item('database-header-hide', 'tools.database.tableHide', ctx.onHide, IconEyeSlash));
  }
  // Notion offers no wrap toggle on a checkbox or a button column.
  if (property.type !== 'checkbox' && property.type !== 'button') {
    items.push(ctx.wrapped
      ? item('database-header-unwrap', 'tools.database.tableUnwrap', () => ctx.onWrap(false), IconReturn)
      : item('database-header-wrap', 'tools.database.tableWrap', () => ctx.onWrap(true), IconReturn));
  }
  items.push(
    item('database-header-insert-left', 'tools.database.tableInsertLeft', () => ctx.onInsert('left'), IconInsertLeft),
    item('database-header-insert-right', 'tools.database.tableInsertRight', () => ctx.onInsert('right'), IconInsertRight)
  );

  return items;
};

/** The row's place in the host's favorites (`config.favorites`). */
export interface RowFavorite {
  on: boolean;
  onToggle: () => void;
}

export interface RowMenuContext {
  i18n: T;
  /** The host's favorites lever. Without it there is no Add to Favorites row. */
  favorite?: RowFavorite;
  /** Columns the row can edit from "Edit property ›". */
  properties: PropertyDefinition[];
  /** Without it there is no Edit icon row. */
  onEditIcon?: () => void;
  /** Without it there is no Edit property row. */
  onEditProperty?: (propertyId: string) => void;
  /** Board and gallery only (research/12 §3). Without it there is no Layout row. */
  onLayout?: () => void;
  /** Board and gallery only (research/12 §3). Without it there is no Property visibility row. */
  onPropertyVisibility?: () => void;
  onOpenIn: (mode: OpenPagesIn) => void;
  onCopyLink: () => void;
  /** Without it there is no Duplicate row. */
  onDuplicate?: () => void;
  /** Without it there is no Move to Trash row. */
  onDelete?: () => void;
  /** The host's comments lever. Without it there is no Comment row. */
  onComment?: () => void;
  /** Other databases of this document. Without any there is no Move to row. */
  moveTargets?: Array<{ id: string; title: string }>;
  onMoveTo?: (databaseId: string) => void;
  /** Who edited the row last, and when, already formatted. */
  lastEdited?: { name?: string; time: string };
  /** Words and characters of the row. Without it or lastEdited there is no footer. */
  counts?: { words: number; characters: number };
}

export interface RowMenuFooterSource {
  row: Pick<DatabaseRow, 'properties' | 'meta'> | undefined;
  titlePropertyId: string;
  locale: string;
  people?: ReadonlyArray<{ id: string; name: string }>;
  now?: Date;
  hourCycle?: 'h12' | 'h23';
  /** research/35 §19: an edit from today reads "Today at 4:54 AM". Without it, "Today 4:54 AM". */
  i18n?: Pick<I18n, 't'>;
}

/**
 * The row menu footer's facts: who edited the row last and when, and the
 * title's words and characters. research/08 does not say what Notion counts;
 * this counts the title only.
 */
export const rowMenuFooter = (source: RowMenuFooterSource): Pick<RowMenuContext, 'lastEdited' | 'counts'> => {
  const value = source.row?.properties[source.titlePropertyId];
  const title = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const trimmed = title.trim();
  const counts = { words: trimmed === '' ? 0 : trimmed.split(/\s+/).length, characters: Array.from(title).length };
  const meta = source.row?.meta;
  const at = meta?.lastEditedAt;

  if (at === undefined) {
    return { counts };
  }
  const now = source.now ?? new Date();
  const time = source.i18n !== undefined && toLocalDay(new Date(at)) === toLocalDay(now)
    ? source.i18n.t('tools.database.rowEditedTodayAt', { time: formatClock(new Date(at), source.locale, source.hourCycle) })
    : formatRelativeStamp(at, source.locale, {}, now, source.hourCycle);
  const name = meta?.lastEditedBy === undefined ? undefined : source.people?.find((person) => person.id === meta.lastEditedBy)?.name;

  return { lastEdited: { ...(name !== undefined ? { name } : {}), time }, counts };
};

const OPEN_IN: ReadonlyArray<{ mode: OpenPagesIn; icon: string; key: string }> = [
  { mode: 'side', icon: IconSplitView, key: 'tools.database.openPagesSide' },
  { mode: 'center', icon: IconPreview, key: 'tools.database.openPagesCenter' },
  { mode: 'full', icon: IconExpandFullscreen, key: 'tools.database.openPagesFull' },
];

/** research/08's footer: "Last edited by ⟨name⟩", the time, then "1 word, 5 characters". */
export const rowFooter = (i18n: T, lastEdited: RowMenuContext['lastEdited'], counts: RowMenuContext['counts']): PopoverItemParams => {
  const footer = document.createElement('div');
  const line = (text: string): void => {
    const el = document.createElement('div');

    el.textContent = text;
    footer.append(el);
  };

  footer.setAttribute('data-blok-database-row-menu-footer', '');
  if (lastEdited !== undefined) {
    line(lastEdited.name === undefined
      ? i18n.t('tools.database.rowLastEdited')
      : i18n.t('tools.database.rowLastEditedBy', { name: lastEdited.name }));
    line(lastEdited.time);
  }
  if (counts !== undefined) {
    line(i18n.t('tools.database.rowWordCount', { words: counts.words, characters: counts.characters }));
  }

  return { type: PopoverItemType.Html, element: footer, name: 'last-edited' };
};

/**
 * "Comment ⌘⇧M", shared by the table row menu and the card menu so they cannot drift.
 * Callers add `name` and `onActivate` literally: the agent-coverage scan reads menu ids from them.
 */
export const commentMenuItem = (i18n: T): { type: PopoverItemType.Default; title: string; icon: string; secondaryLabel: string } => ({
  type: PopoverItemType.Default,
  title: i18n.t('tools.database.tableComment'),
  icon: IconMessage,
  secondaryLabel: beautifyShortcut('CMD+SHIFT+M'),
});

/** The databases "Move to" offers. Also the list ⌘⇧P opens on one selected row. */
export const moveTargetItems = (i18n: T, targets: ReadonlyArray<{ id: string; title: string }>, onMoveTo: (databaseId: string) => void): PopoverItemParams[] =>
  targets.map((target) => ({
    type: PopoverItemType.Default as const,
    name: `database-row-move-to-${target.id}`,
    title: target.title === '' ? i18n.t('tools.database.relationUntitledDatabase') : target.title,
    onActivate: () => onMoveTo(target.id),
  }));

/** What the row menu and the row page's "•••" menu can do to the row itself. */
export interface RowActionContext {
  i18n: T;
  onCopyLink: () => void;
  /** Without it there is no Duplicate row. */
  onDuplicate?: () => void;
  /** Without it there is no Move to Trash row. */
  onDelete?: () => void;
  /** Other databases of this document. Without any there is no Move to row. */
  moveTargets?: Array<{ id: string; title: string }>;
  onMoveTo?: (databaseId: string) => void;
}

/**
 * Copy link, Duplicate, Move to and Move to Trash, shared so the two menus cannot drift.
 * Notion's row page shows no shortcut on Move to Trash (research/12, 15-row-page-actions.png).
 */
export const rowActionItems = (ctx: RowActionContext, options: { trashShortcut: boolean }): PopoverItemParams[] => {
  const { i18n, onDuplicate, onDelete, onMoveTo } = ctx;
  const targets = ctx.moveTargets ?? [];

  return [
    { type: PopoverItemType.Default, name: 'database-row-copy-link', title: i18n.t('tools.database.tableCopyLink'), icon: IconLink, onActivate: ctx.onCopyLink },
    ...(onDuplicate !== undefined
      ? [{ type: PopoverItemType.Default as const, name: 'database-row-duplicate', title: i18n.t('tools.database.tableDuplicate'), icon: IconCopy, secondaryLabel: beautifyShortcut('CMD+D'), onActivate: onDuplicate }]
      : []),
    ...(onMoveTo !== undefined && targets.length > 0
      ? [{
        type: PopoverItemType.Default as const,
        title: i18n.t('tools.database.tableMoveTo'),
        icon: IconArrowDiagonal,
        secondaryLabel: beautifyShortcut('CMD+SHIFT+P'),
        children: { searchable: true, items: moveTargetItems(i18n, targets, onMoveTo) },
      }]
      : []),
    ...(onDelete !== undefined
      ? [{
        type: PopoverItemType.Default as const,
        name: 'database-row-delete',
        title: i18n.t('tools.database.tableMoveToTrash'),
        icon: IconTrash,
        ...(options.trashShortcut ? { secondaryLabel: beautifyShortcut('DELETE') } : {}),
        onActivate: onDelete,
      }]
      : []),
  ];
};

/** The "Page" label over the menu (research/08, shots-08/65-row-handle-menu.png). */
const rowMenuHeading = (i18n: T): PopoverItemParams => {
  const element = document.createElement('div');

  // Same look as the block menu's title. Presentation: the menu's list may only own items.
  element.className = 'pl-2 pr-3 pt-0.5 pb-1 text-xs font-medium text-menu-section-label cursor-default select-none';
  element.setAttribute('role', 'presentation');
  element.setAttribute('data-blok-database-row-menu-heading', '');
  element.textContent = i18n.t('tools.database.rowMenuPage');

  return { type: PopoverItemType.Html, element };
};

/**
 * The one row menu of every view: the table's ⋮⋮, the board's •••, a right-click
 * on a card or list row, and the feed's More actions (research/08, research/12 §3,
 * research/19 §2e). Measured order: "Page", then Add to Favorites, Edit icon,
 * Edit property › (Layout, Property visibility on board and gallery); Open in ›,
 * Comment; Copy link, Duplicate, Move to, Move to Trash; footer.
 * "Remove from Favorites" is measured (research/22 §14); its icon is not.
 */
export const rowMenuItems = (ctx: RowMenuContext): PopoverItemParams[] => {
  const { i18n, favorite, onEditIcon, onEditProperty, onLayout, onPropertyVisibility } = ctx;
  const page: PopoverItemParams[] = [
    ...(favorite !== undefined
      ? [{
        type: PopoverItemType.Default as const,
        name: 'database-row-favorite',
        title: i18n.t(favorite.on ? 'tools.database.rowRemoveFromFavorites' : 'tools.database.rowAddToFavorites'),
        icon: IconEmojiStar,
        onActivate: favorite.onToggle,
      }]
      : []),
    ...(onEditIcon !== undefined
      ? [{ type: PopoverItemType.Default as const, name: 'database-row-edit-icon', title: i18n.t('tools.database.tableEditIcon'), icon: IconEmojiSmile, onActivate: onEditIcon }]
      : []),
    ...(onEditProperty !== undefined
      ? [{
        type: PopoverItemType.Default as const,
        title: i18n.t('tools.database.tableEditProperty'),
        icon: IconListBulleted,
        children: {
          items: ctx.properties.map((property) => ({
            type: PopoverItemType.Default as const,
            name: `database-row-edit-property-${property.id}`,
            title: property.name,
            onActivate: () => onEditProperty(property.id),
          })),
        },
      }]
      : []),
    // feel findings B15: a line sets the view's Layout and Property visibility apart.
    ...(onEditProperty !== undefined && (onLayout !== undefined || onPropertyVisibility !== undefined) ? [{ type: PopoverItemType.Separator as const }] : []),
    ...(onLayout !== undefined
      ? [{ type: PopoverItemType.Default as const, name: 'database-row-view-layout', title: i18n.t('tools.database.settingsLayout'), icon: IconPageLayout, onActivate: onLayout }]
      : []),
    ...(onPropertyVisibility !== undefined
      ? [{ type: PopoverItemType.Default as const, name: 'database-row-view-properties', title: i18n.t('tools.database.settingsPropertyVisibility'), icon: IconPreview, onActivate: onPropertyVisibility }]
      : []),
  ];
  const open: PopoverItemParams[] = [
    {
      type: PopoverItemType.Default,
      title: i18n.t('tools.database.tableOpenIn'),
      icon: IconArrowDiagonal,
      children: {
        items: OPEN_IN.map(({ mode, icon, key }) => ({ type: PopoverItemType.Default, name: `database-row-open-in-${mode}`, title: i18n.t(key), icon, onActivate: () => ctx.onOpenIn(mode) })),
      },
    },
    ...(ctx.onComment !== undefined ? [{ ...commentMenuItem(i18n), name: 'database-row-comment', onActivate: ctx.onComment }] : []),
  ];
  const line: PopoverItemParams = { type: PopoverItemType.Separator };

  return [
    rowMenuHeading(i18n),
    ...page,
    ...(page.length > 0 ? [line] : []),
    ...open,
    line,
    ...rowActionItems(ctx, { trashShortcut: true }),
    ...(ctx.lastEdited !== undefined || ctx.counts !== undefined ? [line, rowFooter(i18n, ctx.lastEdited, ctx.counts)] : []),
  ];
};
