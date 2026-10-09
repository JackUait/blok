import { nanoid } from 'nanoid';
import { matchCondition } from './database-query';
import type {
  DatabaseRow,
  DatabaseViewConfig,
  GroupState,
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

const stateOf = (view: DatabaseViewConfig, key: string): GroupState | undefined =>
  [...(view.groupStates ?? [])].reverse().find((state) => state.id === key);

export const isGroupHidden = (view: DatabaseViewConfig, key: string): boolean => stateOf(view, key)?.hidden === true;

export const isGroupCollapsed = (view: DatabaseViewConfig, key: string): boolean => stateOf(view, key)?.collapsed === true;

/** The `groupStates` list after patching many groups. Entries stay where they are, so peers' edits pair by id. */
export const withGroupStates = (
  view: DatabaseViewConfig,
  keys: readonly string[],
  patch: Partial<Omit<GroupState, 'id'>>
): GroupState[] => {
  const states = (view.groupStates ?? []).map((state) => ({ ...state }));

  for (const key of keys) {
    const index = states.findIndex((state) => state.id === key);

    if (index === -1) {
      states.push({ id: key, ...patch });
    } else {
      states[index] = { ...states[index], ...patch };
    }
  }

  return states;
};

export const withGroupState = (view: DatabaseViewConfig, key: string, patch: Partial<Omit<GroupState, 'id'>>): GroupState[] =>
  withGroupStates(view, [key], patch);

/** A sort chosen from a column header replaces every other sort (research/08). */
export const sortFromHeader = (propertyId: string, direction: SortConfig['direction']): SortConfig[] =>
  [{ id: nanoid(), propertyId, direction }];
