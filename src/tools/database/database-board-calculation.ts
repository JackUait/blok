import type { I18n } from '../../../types';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { CALCULATIONS_FOR_TYPE } from './database-calculations';
import { CALCULATION_LABEL_KEYS, COUNT_FNS, DATE_FNS, NUMBER_FNS, PERCENT_FNS } from './database-table-menus';
import { calculationText } from './database-table-view';
import type { CalculationFn, DatabaseRow, PropertyDefinition } from './types';
import type { ResolvedGroupCalculation } from './view-settings';

type T = Pick<I18n, 't'>;

export interface GroupCalculationMenuParams {
  i18n: T;
  /** Localized, with formulas and rollups as their result types. */
  schema: PropertyDefinition[];
  /** The grouping property: Notion leaves it out of every property list. */
  groupBy: string | undefined;
  current: ResolvedGroupCalculation;
  /** No `propertyId` means Count all. */
  onPick: (fn: CalculationFn, propertyId?: string) => void;
  onCapCounts: (cap: boolean) => void;
}

/** Count all has no property. */
const ROW_COUNT: PropertyDefinition = { id: '', name: '', type: 'title', position: '' };

const isItem = (item: PopoverItemParams | null): item is PopoverItemParams => item !== null;

/**
 * The board count's menu (research/16 §1): Count, Percent, More options and
 * Date, no None. Every function but Count all opens the properties whose type
 * offers it. A list with no property is left out, and so is a group left empty.
 */
export const groupCalculationItems = (params: GroupCalculationMenuParams): PopoverItemParams[] => {
  const t = (key: string): string => params.i18n.t(key);
  const { current } = params;
  const candidates = params.schema.filter((property) => property.id !== params.groupBy);

  const leaf = (fn: CalculationFn): PopoverItemParams | null => {
    if (fn === 'count') {
      return {
        type: PopoverItemType.Default,
        name: 'database-group-calc-count',
        title: t(CALCULATION_LABEL_KEYS.count),
        isActive: current.fn === 'count',
        closeOnActivate: true,
        onActivate: () => params.onPick('count'),
      };
    }

    const properties = candidates.filter((property) => CALCULATIONS_FOR_TYPE[property.type]?.includes(fn));

    if (properties.length === 0) return null;

    return {
      type: PopoverItemType.Default,
      name: `database-group-calc-${fn}`,
      title: t(CALCULATION_LABEL_KEYS[fn]),
      isActive: current.fn === fn,
      children: {
        items: properties.map((property): PopoverItemParams => ({
          type: PopoverItemType.Default,
          name: `database-group-calc-${fn}-${property.id}`,
          title: property.name,
          isActive: current.fn === fn && current.propertyId === property.id,
          closeOnActivate: true,
          onActivate: () => params.onPick(fn, property.id),
        })),
      },
    };
  };

  const group = (titleKey: string, fns: readonly CalculationFn[], lead: PopoverItemParams[] = []): PopoverItemParams | null => {
    const leaves = fns.map(leaf).filter(isItem);

    if (leaves.length === 0) return null;

    return {
      type: PopoverItemType.Default,
      title: t(titleKey),
      isActive: fns.includes(current.fn),
      children: { items: [...lead, ...leaves] },
    };
  };

  const capToggle: PopoverItemParams = {
    type: PopoverItemType.Default,
    name: 'database-group-calc-cap-counts',
    title: t('tools.database.calcShowLargeCounts'),
    isActive: current.capCounts,
    closeOnActivate: true,
    onActivate: () => params.onCapCounts(!current.capCounts),
  };

  return [
    group('tools.database.calcCount', COUNT_FNS, [capToggle]),
    group('tools.database.calcPercent', PERCENT_FNS),
    group('tools.database.calcMoreOptions', NUMBER_FNS),
    group('tools.database.calcDate', DATE_FNS),
  ].filter(isItem);
};

/**
 * The number beside a group's name. A number function with nothing to read
 * shows 0, as Notion's Sum does on an empty column.
 */
export const groupCalculationText = (
  current: ResolvedGroupCalculation,
  rows: DatabaseRow[],
  schema: PropertyDefinition[],
  locale: string | undefined,
  shownOf: (property: PropertyDefinition) => PropertyDefinition = (property) => property
): string => {
  const property = schema.find((p) => p.id === current.propertyId) ?? ROW_COUNT;
  const text = calculationText(current.fn, rows, property, shownOf(property), locale, current.capCounts);

  return text === '' && NUMBER_FNS.includes(current.fn) ? '0' : text;
};

/** "Count all", or "<calculation> in <property>". */
export const groupCalculationHint = (current: ResolvedGroupCalculation, schema: PropertyDefinition[], i18n: T): string => {
  const label = i18n.t(CALCULATION_LABEL_KEYS[current.fn]);
  const property = schema.find((p) => p.id === current.propertyId);

  return property === undefined ? label : i18n.t('tools.database.groupCalculationHint', { calculation: label, property: property.name });
};
