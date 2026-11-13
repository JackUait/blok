import { nanoid } from 'nanoid';
import { matchCondition } from './database-query';
import { optionColorOf } from './cells/option-colors';
import type {
  ColorRule,
  DatabaseRow,
  DatabaseViewConfig,
  GroupRef,
  PropertyDefinition,
  PropertyType,
  SortConfig,
  ViewType,
} from './types';

/**
 * Notion's list (research/05 §6.2); formulas, relations and rollups since 2025-11-17; Created by/time and
 * Last edited by/time in notion-motion.md Round 20 §4. URL, Phone, Email, Files and ID stay out.
 */
export const COLOR_RULE_TYPES: readonly PropertyType[] = [
  'title', 'text', 'number', 'select', 'multiSelect', 'status', 'date', 'person', 'checkbox', 'formula', 'relation', 'rollup',
  'createdBy', 'createdTime', 'lastEditedBy', 'lastEditedTime',
];

/** Layouts Notion colors (research/05 §6.2; map measured in research/20 §1f). */
export const COLOR_RULE_LAYOUTS: readonly ViewType[] = ['table', 'list', 'board', 'calendar', 'timeline', 'feed', 'map'];

/**
 * A rule's colour that follows the row's option: Notion's "Match option" on Select and Status,
 * "Match first option" on Multi-select (notion-motion.md Round 20 §4, Round 21 §1).
 * Saved in `color` so older clients keep it as is.
 */
export const MATCH_OPTION_COLOR = 'match';

/** Types whose rules may follow the row's option colour. */
export const MATCH_OPTION_TYPES: readonly PropertyType[] = ['select', 'status', 'multiSelect'];

/**
 * A rule's colour on one row. A "Match option" rule with no option paints nothing (unmeasured).
 * Multi-select takes the first option in the cell's order, the one the cell shows first (an assumption:
 * Round 21 does not say which order).
 */
const ruleColor = (rule: ColorRule, row: DatabaseRow, schema: PropertyDefinition[]): string | undefined => {
  if (rule.color !== MATCH_OPTION_COLOR) return rule.color;
  const property = schema.find((p) => p.id === rule.propertyId);
  const value = row.properties[rule.propertyId];
  const ids: unknown[] = Array.isArray(value) ? value : [value];
  const options = property !== undefined && MATCH_OPTION_TYPES.includes(property.type) ? property.config?.options ?? [] : [];
  const option = ids.map((id) => options.find((o) => o.id === id)).find((o) => o !== undefined);

  return option === undefined ? undefined : optionColorOf(option);
};

export interface RowColor {
  row?: string;
  /** Property id → color. Table only. */
  cells: Record<string, string>;
}

/**
 * Colors per row id. The first matching rule in the list paints each cell,
 * row rules included: a cell rule below a matching row rule paints nothing
 * (notion-motion.md Round 20 §4). A rule the engine cannot read paints
 * nothing. Only a table colors one cell.
 */
export const resolveRowColors = (
  rows: DatabaseRow[],
  view: DatabaseViewConfig,
  schema: PropertyDefinition[],
  now: Date = new Date(),
  me: string | null = null
): Map<string, RowColor> => {
  const rules = (view.colorRules ?? []).filter((rule) =>
    schema.some((p) => p.id === rule.propertyId && COLOR_RULE_TYPES.includes(p.type)));
  const colors = new Map<string, RowColor>();

  if (rules.length === 0 || !COLOR_RULE_LAYOUTS.includes(view.type)) return colors;

  const paint = (row: DatabaseRow): RowColor => {
    const color: RowColor = { cells: {} };
    const matching = rules.filter((rule) => matchCondition(row, rule, schema, now, me) === true);

    for (const rule of matching) {
      const isCell = rule.applyTo === 'property' && view.type === 'table';
      const fill = ruleColor(rule, row, schema);

      if (fill === undefined) continue;
      if (!isCell) {
        color.row ??= fill;
      } else if (color.row === undefined) {
        color.cells[rule.propertyId] ??= fill;
      }
    }

    return color;
  };

  for (const row of rows) {
    const color = paint(row);

    if (color.row !== undefined || Object.keys(color.cells).length > 0) {
      colors.set(row.id, color);
    }
  }

  return colors;
};

const hasRef = (list: GroupRef[] | undefined, key: string): boolean => (list ?? []).some((group) => group.id === key);

export const isGroupHidden = (view: DatabaseViewConfig, key: string): boolean => hasRef(view.hiddenGroups, key);

export const isGroupCollapsed = (view: DatabaseViewConfig, key: string): boolean => hasRef(view.collapsedGroups, key);

export const isGroupPinned = (view: DatabaseViewConfig, key: string): boolean => hasRef(view.pinnedGroups, key);

/**
 * The `hiddenGroups` / `collapsedGroups` / `pinnedGroups` lists after showing,
 * hiding, folding, opening, pinning or unpinning some groups. A key is in a list or not; entries are id
 * objects, so two peers' adds merge. A sub-group's key starts with `sub:`.
 */
export const withGroupFlags = (
  view: DatabaseViewConfig,
  keys: readonly string[],
  patch: { hidden?: boolean; collapsed?: boolean; pinned?: boolean }
): Partial<Pick<DatabaseViewConfig, 'hiddenGroups' | 'collapsedGroups' | 'pinnedGroups'>> => {
  const apply = (list: GroupRef[] | undefined, on: boolean): GroupRef[] => {
    const current = (list ?? []).map((group) => ({ ...group }));

    return on
      ? [...current, ...keys.filter((key) => !hasRef(current, key)).map((id) => ({ id }))]
      : current.filter((group) => !keys.includes(group.id));
  };

  return {
    ...(patch.hidden !== undefined ? { hiddenGroups: apply(view.hiddenGroups, patch.hidden) } : {}),
    ...(patch.collapsed !== undefined ? { collapsedGroups: apply(view.collapsedGroups, patch.collapsed) } : {}),
    ...(patch.pinned !== undefined ? { pinnedGroups: apply(view.pinnedGroups, patch.pinned) } : {}),
  };
};

/** A sort chosen from a column header replaces every other sort (research/08). */
export const sortFromHeader = (propertyId: string, direction: SortConfig['direction']): SortConfig[] =>
  [{ id: nanoid(), propertyId, direction }];
