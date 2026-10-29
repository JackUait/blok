import { IconCheck, IconChevronDown } from '../../components/icons';
import { PopoverDesktop } from '../../components/utils/popover';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import type { PopoverItemParams } from '../../../types/utils/popover/popover-item';
import { PopoverEvent } from '../../../types/utils/popover/popover-event';
import type { I18n } from '../../../types';
import { propertyTypeMeta } from './database-property-types';
import { DATABASE_HEADER_MENU_CLASS } from './database-table-menus';
import { ROLLUP_FUNCTIONS, rollupFunctionPatch, rollupFunctionsFor, rollupSettingsOf, rollupTargetPatch } from './rollup';
import type { PropertyDefinition, PropertySettingsV2, RollupFunction } from './types';

/** What the rollup setup menu reads and writes. */
export interface RollupSetupHost {
  i18n: Pick<I18n, 't'>;
  /** This database's properties: the relations to pick from. */
  schema: () => PropertyDefinition[];
  /** The related database's properties. */
  targetSchema: (databaseId: string) => PropertyDefinition[];
  /** A formula target as its result type, so Calculate offers what fits it. */
  targetValueProperty?: (databaseId: string, property: PropertyDefinition) => PropertyDefinition;
  update: (patch: Partial<PropertySettingsV2>) => void;
}

/** Same lists as Edit property's Relation, Property and Calculate rows (notion-spec-2 §17.2, §17.8). */
const PANEL_LIST_CLASS = 'blok-database-panel-list';
const TARGET_LIST = { clickOnly: true, placement: 'under', width: '280px', class: PANEL_LIST_CLASS } as const;

/** The Calculate list's groups (notion-spec-2 §14.4, §15.2), as in Edit property. */
const CALCULATE_GROUPS: ReadonlyArray<readonly [string, readonly RollupFunction[]]> = [
  ['tools.database.calcCount', ['count', 'count_values', 'unique', 'empty', 'not_empty', 'checked', 'unchecked', 'count_per_group']],
  ['tools.database.calcPercent', ['percent_empty', 'percent_not_empty', 'percent_checked', 'percent_unchecked', 'percent_per_group']],
  ['tools.database.calcMoreOptions', ['sum', 'average', 'median', 'min', 'max', 'range']],
  ['tools.database.calcDate', ['earliest_date', 'latest_date', 'date_range']],
];

/** A section label: 12/14.4, weight 500, secondary ink (notion-spec-2 §18.3), drawn by database.css. */
const label = (text: string): PopoverItemParams => {
  const element = document.createElement('div');

  // Presentation: the menu's list may only own items.
  element.setAttribute('role', 'presentation');
  element.setAttribute('data-blok-database-rollup-setup-label', '');
  element.textContent = text;

  return { type: PopoverItemType.Html, element };
};

/** A dropdown row: its value, then a down chevron (rollup-editor.png). */
const DROPDOWN = { trailingIcon: IconChevronDown } as const;

/**
 * The menu a configured rollup's Configure button opens (notion-spec-2 §20.11):
 * Relation, Property and Calculate, each a dropdown under its label. The writes
 * are Edit property's.
 */
export const rollupSetupItems = (property: PropertyDefinition, host: RollupSetupHost): PopoverItemParams[] => {
  const t = (key: string): string => host.i18n.t(key);
  const settings = rollupSettingsOf(property);
  const relations = host.schema().filter((p) => p.type === 'relation');
  const relation = relations.find((p) => p.id === settings.relationPropertyId);
  const databaseId = relation?.relation?.targetDatabaseId;
  const targets = databaseId === undefined ? [] : host.targetSchema(databaseId);
  const picked = targets.find((p) => p.id === settings.targetPropertyId);
  const target = picked?.type === 'formula' && databaseId !== undefined ? host.targetValueProperty?.(databaseId, picked) ?? picked : picked;
  const fns = target === undefined ? ROLLUP_FUNCTIONS : rollupFunctionsFor(target);
  const leaf = (fn: RollupFunction): PopoverItemParams => ({
    name: `rollupFunction-${fn}`,
    title: t(`tools.database.rollupFn.${fn}`),
    isActive: fn === settings.function,
    ...(fn === settings.function ? { trailingIcon: IconCheck } : {}),
    closeOnActivate: true,
    onActivate: () => host.update(rollupFunctionPatch(property, fn)),
  });
  const groups = CALCULATE_GROUPS
    .map(([titleKey, members]) => [titleKey, fns.filter((fn) => members.includes(fn))] as const)
    .filter(([, members]) => members.length > 0);

  return [
    label(t('tools.database.rollupRelation')),
    {
      name: 'rollupSetupRelation',
      title: relation?.name ?? t('tools.database.rollupSelect'),
      ...(relation === undefined ? {} : { icon: propertyTypeMeta(relation.type).icon }),
      ...DROPDOWN,
      children: {
        ...TARGET_LIST,
        hideChevron: true,
        items: relations.map((p) => ({
          name: `rollupRelation-${p.id}`,
          title: p.name,
          closeOnActivate: true,
          onActivate: () => host.update({ rollup: { ...settings, relationPropertyId: p.id } }),
        })),
      },
    },
    { type: PopoverItemType.Separator },
    label(t('tools.database.rollupProperty')),
    {
      name: 'rollupSetupProperty',
      title: picked?.name ?? t('tools.database.rollupSelect'),
      ...(picked === undefined ? {} : { icon: propertyTypeMeta(picked.type).icon }),
      ...DROPDOWN,
      children: {
        ...TARGET_LIST,
        hideChevron: true,
        searchable: true,
        searchPlaceholder: t('tools.database.settingsSearchProperty'),
        // H-rr: a rollup of a rollup is not offered.
        items: targets.filter((p) => p.type !== 'rollup').map((p) => ({
          name: `rollupProperty-${p.id}`,
          title: p.name,
          closeOnActivate: true,
          onActivate: () => host.update(rollupTargetPatch(property, p)),
        })),
      },
    },
    { type: PopoverItemType.Separator },
    label(t('tools.database.rollupFunction')),
    {
      name: 'rollupSetupFunction',
      title: t(`tools.database.rollupFn.${settings.function}`),
      ...DROPDOWN,
      children: {
        clickOnly: true,
        placement: 'under',
        hideChevron: true,
        class: PANEL_LIST_CLASS,
        width: '200px',
        items: [
          ...fns.filter((fn) => fn === 'show_original' || fn === 'show_unique').map(leaf),
          ...groups.map(([titleKey, members]): PopoverItemParams => ({
            name: `rollupFunctionGroup-${titleKey.slice(titleKey.lastIndexOf('.') + 1)}`,
            title: t(titleKey),
            children: { class: PANEL_LIST_CLASS, width: '250px', items: members.map(leaf) },
          })),
        ],
      },
    },
  ];
};

/** The header menu's 28px rows and 14px text, plus the setup's padding and labels (database.css). */
const SETUP_CLASS = `${DATABASE_HEADER_MENU_CLASS} blok-database-rollup-setup`;

/**
 * Opens the rollup setup menu over `cell`, 2px above the row: at the cell's
 * left once a relation is picked (notion-spec-2 §20.11), 6px in before
 * (§18.3). Its width follows its rows.
 * `host.update` should redraw the cell; the menu closes on a pick.
 */
export const openRollupSetup = (cell: HTMLElement, property: PropertyDefinition, host: RollupSetupHost): PopoverDesktop => {
  const rect = cell.getBoundingClientRect();
  const inset = rollupSettingsOf(property).relationPropertyId === '' ? 6 : 0;
  const popover = new PopoverDesktop({
    class: SETUP_CLASS,
    trigger: cell,
    items: rollupSetupItems(property, host),
    width: 'auto',
    cover: true,
    viewportMargin: 8,
    position: DOMRect.fromRect({ x: rect.left + inset, y: rect.top - 2, width: 0, height: 0 }),
    positionContext: cell,
    autoFocusFirstItem: false,
    animateClose: true,
  });
  const state = { closed: false };

  popover.on(PopoverEvent.Closed, () => {
    if (state.closed) return;
    state.closed = true;
    // Destroying inside the popover's own Closed emit would re-enter it.
    queueMicrotask(() => popover.destroy());
  });
  popover.show();

  return popover;
};
