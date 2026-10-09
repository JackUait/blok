import { nanoid } from 'nanoid';
import type {
  DatabaseRow,
  FileValue,
  PersonValue,
  PropertyDefinition,
  PropertyType,
  PropertyValue,
  SelectOption,
  StatusGroup,
  StatusSettings,
} from './types';

/** Types whose value is computed from the row block, never stored in `properties`. */
const COMPUTED_TYPES: ReadonlySet<PropertyType> = new Set<PropertyType>(['createdTime', 'lastEditedTime', 'createdBy', 'lastEditedBy']);

/** Types a person cannot edit in a cell. */
const READ_ONLY_TYPES: ReadonlySet<PropertyType> = new Set<PropertyType>([...COMPUTED_TYPES, 'uniqueId']);

export const isComputedType = (type: PropertyType): boolean => COMPUTED_TYPES.has(type);

export const isReadOnlyType = (type: PropertyType): boolean => READ_ONLY_TYPES.has(type);

const isoOf = (ms: number | undefined): string | null =>
  typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null;

const personOf = (id: string | undefined): PersonValue[] =>
  typeof id === 'string' && id !== '' ? [{ id }] : [];

/**
 * The value a property shows for a row. The four computed types read the row
 * block's metadata: a time as an ISO instant, a person as a person value.
 */
export const readPropertyValue = (row: DatabaseRow, property: PropertyDefinition): PropertyValue | undefined => {
  const meta = row.meta;

  if (property.type === 'createdTime') return isoOf(meta?.createdAt);
  if (property.type === 'lastEditedTime') return isoOf(meta?.lastEditedAt);
  if (property.type === 'createdBy') return personOf(meta?.createdBy);
  if (property.type === 'lastEditedBy') return personOf(meta?.lastEditedBy);

  return row.properties[property.id];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Person ids of a value. Takes `{id}` objects and, for values written by hand, bare ids. */
export const personIdsOf = (value: PropertyValue | undefined): string[] => {
  if (!Array.isArray(value)) {
    return typeof value === 'string' && value !== '' ? [value] : [];
  }

  return value.flatMap((item: unknown) => {
    if (typeof item === 'string') return item === '' ? [] : [item];

    return isRecord(item) && typeof item.id === 'string' && item.id !== '' ? [item.id] : [];
  });
};

export const isFileValue = (item: unknown): item is FileValue =>
  isRecord(item) && typeof item.id === 'string' && typeof item.url === 'string' && typeof item.name === 'string';

export const filesOf = (value: PropertyValue | undefined): FileValue[] =>
  Array.isArray(value) ? (value as unknown[]).filter(isFileValue) : [];

// ─── Status ───

export const STATUS_GROUP_KINDS = ['todo', 'inProgress', 'complete'] as const;

/** The three Notion groups. Ids equal the kind, so two peers that add a status agree on them. */
export const createDefaultStatusSettings = (names: Partial<Record<StatusGroup['kind'], string>> = {}): StatusSettings => ({
  groups: [
    { id: 'todo', kind: 'todo', name: names.todo ?? 'To-do', color: 'gray', position: 'a0' },
    { id: 'inProgress', kind: 'inProgress', name: names.inProgress ?? 'In progress', color: 'blue', position: 'a1' },
    { id: 'complete', kind: 'complete', name: names.complete ?? 'Complete', color: 'green', position: 'a2' },
  ],
});

export const createDefaultStatusOptions = (labels: { notStarted: string; inProgress: string; done: string }): SelectOption[] => [
  { id: nanoid(), label: labels.notStarted, color: 'gray', position: 'a0', groupId: 'todo' },
  { id: nanoid(), label: labels.inProgress, color: 'blue', position: 'a0', groupId: 'inProgress' },
  { id: nanoid(), label: labels.done, color: 'green', position: 'a0', groupId: 'complete' },
];

const byPosition = <T extends { position: string }>(a: T, b: T): number => {
  if (a.position === b.position) return 0;

  return a.position < b.position ? -1 : 1;
};

export const statusGroupsOf = (property: PropertyDefinition): StatusGroup[] =>
  [...(property.status?.groups ?? createDefaultStatusSettings().groups)].sort(byPosition);

/** The group an option sits in. An option with no known group sits in the first one, as Notion puts new options in To-do. */
export const statusGroupOf = (property: PropertyDefinition, optionId: string): StatusGroup | undefined => {
  const groups = statusGroupsOf(property);
  const option = property.config?.options.find((o) => o.id === optionId);

  if (option === undefined) return undefined;

  return groups.find((g) => g.id === option.groupId) ?? groups[0];
};

/** Options of a status property in display order: by group, then by position inside the group. */
export const orderedStatusOptions = (property: PropertyDefinition): SelectOption[] => {
  const groups = statusGroupsOf(property);
  const rank = (option: SelectOption): number => {
    const index = groups.findIndex((g) => g.id === statusGroupOf(property, option.id)?.id);

    return index === -1 ? groups.length : index;
  };

  return [...(property.config?.options ?? [])].sort((a, b) => rank(a) - rank(b) || byPosition(a, b));
};
