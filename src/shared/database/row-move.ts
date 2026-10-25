import { isReadOnlyType, personIdsOf } from './value-helpers';
import type { PropertyDefinition, PropertyType, PropertyValue } from './types';

/** Types whose value points at an option id of its own property. */
const OPTION_TYPES: ReadonlySet<PropertyType> = new Set<PropertyType>(['select', 'multiSelect', 'status']);

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** An option id of `from` as the id of the option with the same label in `to`, or null. */
const optionIn = (id: string, from: PropertyDefinition, to: PropertyDefinition): string | null => {
  const label = from.config?.options.find((option) => option.id === id)?.label;
  const match = label === undefined ? undefined : to.config?.options.find((option) => sameName(option.label, label));

  return match?.id ?? null;
};

const mapValue = (value: PropertyValue, from: PropertyDefinition, to: PropertyDefinition): PropertyValue | undefined => {
  if (OPTION_TYPES.has(from.type)) {
    if (Array.isArray(value)) {
      return personIdsOf(value).map((id) => optionIn(id, from, to)).filter((id): id is string => id !== null);
    }

    return typeof value === 'string' ? optionIn(value, from, to) ?? undefined : undefined;
  }
  // A relation keeps its links only when both point at the same database.
  if (from.type === 'relation' && from.relation?.targetDatabaseId !== to.relation?.targetDatabaseId) {
    return undefined;
  }

  // The Jint realm has no structuredClone; values are JSON.
  return JSON.parse(JSON.stringify(value)) as PropertyValue;
};

/**
 * A row's stored values for another database: title to title, then each
 * property to the target property with the same name (any case) and type;
 * options go by label. Anything else is left behind. Unverified: Notion's
 * own mapping on "Move to" was not recorded.
 */
export const mapRowValues = (
  values: Record<string, PropertyValue>,
  source: PropertyDefinition[],
  target: PropertyDefinition[]
): Record<string, PropertyValue> => {
  const mapped: Record<string, PropertyValue> = {};

  for (const from of source) {
    const value = values[from.id];
    const to = from.type === 'title'
      ? target.find((p) => p.type === 'title')
      : target.find((p) => p.type === from.type && sameName(p.name, from.name));

    if (value === undefined || to === undefined || isReadOnlyType(from.type)) {
      continue;
    }
    const next = mapValue(value, from, to);

    if (next !== undefined) {
      mapped[to.id] = next;
    }
  }

  return mapped;
};
