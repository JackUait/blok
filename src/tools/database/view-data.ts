import { nanoid } from 'nanoid';
import { matchCondition } from './database-query';
import type {
  DatabaseRow,
  DatabaseViewConfig,
  GroupRef,
  PropertyDefinition,
  PropertyType,
  SortConfig,
  ViewType,
} from './types';

/** Notion's list minus the types Blok lacks (research/05 §6.2, research/08). */
export const COLOR_RULE_TYPES: readonly PropertyType[] = ['title', 'text', 'number', 'select', 'multiSelect', 'date', 'checkbox'];

/** Layouts Notion colors (research/05 §6.2) that Blok renders. */
export const COLOR_RULE_LAYOUTS: readonly ViewType[] = ['table', 'list', 'board'];

export interface RowColor {
  row?: string;
  /** Property id → color. Table only. */
  cells: Record<string, string>;
}

/**
 * Colors per row id. The first rule that matches a row paints it; a rule
 * the engine cannot read paints nothing. Only a table colors one cell.
 */
export const resolveRowColors = (
  rows: DatabaseRow[],
  view: DatabaseViewConfig,
  schema: PropertyDefinition[],
  now: Date = new Date()
): Map<string, RowColor> => {
  const rules = (view.colorRules ?? []).filter((rule) =>
    schema.some((p) => p.id === rule.propertyId && COLOR_RULE_TYPES.includes(p.type)));
  const colors = new Map<string, RowColor>();

  if (rules.length === 0 || !COLOR_RULE_LAYOUTS.includes(view.type)) return colors;

  const paint = (row: DatabaseRow): RowColor => {
    const color: RowColor = { cells: {} };
    const matching = rules.filter((rule) => matchCondition(row, rule, schema, now) === true);

    for (const rule of matching) {
      const isCell = rule.applyTo === 'property' && view.type === 'table';

      if (isCell) {
        color.cells[rule.propertyId] ??= rule.color;
      } else {
        color.row ??= rule.color;
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

/**
 * The `hiddenGroups` / `collapsedGroups` lists after showing, hiding,
 * folding or opening some groups. A key is in a list or not; entries are id
 * objects, so two peers' adds merge. A sub-group's key starts with `sub:`.
 */
export const withGroupFlags = (
  view: DatabaseViewConfig,
  keys: readonly string[],
  patch: { hidden?: boolean; collapsed?: boolean }
): Partial<Pick<DatabaseViewConfig, 'hiddenGroups' | 'collapsedGroups'>> => {
  const apply = (list: GroupRef[] | undefined, on: boolean): GroupRef[] => {
    const current = (list ?? []).map((group) => ({ ...group }));

    return on
      ? [...current, ...keys.filter((key) => !hasRef(current, key)).map((id) => ({ id }))]
      : current.filter((group) => !keys.includes(group.id));
  };

  return {
    ...(patch.hidden !== undefined ? { hiddenGroups: apply(view.hiddenGroups, patch.hidden) } : {}),
    ...(patch.collapsed !== undefined ? { collapsedGroups: apply(view.collapsedGroups, patch.collapsed) } : {}),
  };
};

/** A sort chosen from a column header replaces every other sort (research/08). */
export const sortFromHeader = (propertyId: string, direction: SortConfig['direction']): SortConfig[] =>
  [{ id: nanoid(), propertyId, direction }];
