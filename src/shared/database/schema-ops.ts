import { DATABASE_DEFAULT_TEXT } from './default-text';
import { resolveViewProperties, visibleRowPropertyIds } from './view-properties';

import type { DatabaseViewConfig, DatabaseViewSettingKey, PropertyDefinition, PropertyType, SelectOption, StatusGroup, StatusSettings, ViewType } from './types';

/*
 * Pure pieces of DatabaseModel that the headless database actions need too. DatabaseModel
 * itself stays in src/tools: it uses structuredClone, which the Jint realm lacks.
 */

export type ViewCreateConfig = Partial<Pick<DatabaseViewConfig, 'groupBy' | 'sorts' | 'filters' | 'visibleProperties' | DatabaseViewSettingKey>>;

/**
 * The name a new property gets: `wanted`, or "<wanted> N" with the lowest free N
 * from 1 when that exact string is taken (research/14 §1, §2a, §4). Case-sensitive,
 * untrimmed, and the suffix stacks: "Notes 1" taken gives "Notes 1 1".
 */
export const freePropertyName = (names: readonly string[], wanted: string): string => {
  const taken = new Set(names);

  if (!taken.has(wanted)) return wanted;
  // Names can fill at most names.length suffixes, so one of 1..length+1 is free.
  const free = Array.from({ length: names.length + 1 }, (_, i) => `${wanted} ${i + 1}`).find((name) => !taken.has(name));

  return free ?? wanted;
};

export const createDefaultSchema = (mintId: (name: string) => string): PropertyDefinition[] => [
  {
    id: mintId('title'),
    name: DATABASE_DEFAULT_TEXT.titleProperty,
    type: 'title',
    position: 'a0',
  },
  {
    id: mintId('status'),
    name: DATABASE_DEFAULT_TEXT.statusProperty,
    type: 'select',
    position: 'a1',
    config: {
      options: [
        { id: mintId('not-started'), label: DATABASE_DEFAULT_TEXT.statusNotStarted, color: 'gray', position: 'a0' },
        { id: mintId('in-progress'), label: DATABASE_DEFAULT_TEXT.statusInProgress, color: 'blue', position: 'a1' },
        { id: mintId('done'), label: DATABASE_DEFAULT_TEXT.statusDone, color: 'green', position: 'a2' },
      ],
    },
  },
];

/**
 * A view as it is first written. `properties`, `calculations`, `filterTree`,
 * `colorRules`, the group lists and both group settings maps exist from birth so two peers' first edits
 * merge: a key both peers create at once is last-writer-wins. `properties`
 * is never empty (there is always a title), so the CRDT keys its entries by
 * id; the empty lists rely on the eager array rule in yjs/serializer.ts.
 * The tree id derives from the view id, so seeded clients write the same one.
 */
export const newView = (
  seed: Pick<DatabaseViewConfig, 'id' | 'name' | 'type' | 'position'> & ViewCreateConfig,
  schema: PropertyDefinition[]
): DatabaseViewConfig => {
  const base: DatabaseViewConfig = {
    ...seed,
    groupBy: seed.groupBy,
    sorts: seed.sorts ?? [],
    filters: seed.filters ?? [],
    visibleProperties: seed.visibleProperties ?? [],
    calculations: seed.calculations ?? [],
    hiddenGroups: seed.hiddenGroups ?? [],
    collapsedGroups: seed.collapsedGroups ?? [],
    filterTree: seed.filterTree ?? { id: `${seed.id}-filters`, conjunction: 'and', filterRules: [] },
    colorRules: seed.colorRules ?? [],
    groupSettings: seed.groupSettings ?? {},
    subGroupSettings: seed.subGroupSettings ?? {},
    ...(seed.type === 'timeline' ? { tableProperties: seed.tableProperties ?? [] } : {}),
  };
  // A new List view also shows Status (notion-spec-2 §21.8). Read-time defaults stay title-only, so saved lists keep their look.
  const showsStatus = seed.type === 'list' && base.visibleProperties?.length === 0;
  const resolved = resolveViewProperties(base, schema).map(({ id, visible }) => ({
    id,
    visible: visible || (showsStatus && schema.find((p) => p.id === id)?.type === 'status'),
  }));
  // Shown first: Notion's list keeps Status ahead of the hidden rest (notion-spec-2 §21.8).
  const properties = seed.properties ?? [...resolved.filter((p) => p.visible), ...resolved.filter((p) => !p.visible)];

  return { ...base, properties, visibleProperties: visibleRowPropertyIds({ ...base, properties }, schema) };
};

export const createDefaultView = (type: ViewType, schema: PropertyDefinition[], mintId: (name: string) => string): DatabaseViewConfig =>
  newView({
    id: mintId('view'),
    name: type === 'table' ? DATABASE_DEFAULT_TEXT.viewTypeTable : DATABASE_DEFAULT_TEXT.viewBoard,
    type,
    position: 'a0',
    ...(type === 'board' ? { groupBy: schema.find((p) => p.type === 'select')?.id } : {}),
  }, schema);

/**
 * Types whose value is a list of `{ id }` objects. The tool writes `[]` for
 * them when it creates a row or the property, so ONE peer creates the list
 * and two peers' first adds then merge by id. Two peers each creating the key
 * is last-writer-wins: see LIST_SLOT_MAP_KEY in the yjs serializer.
 */
const LIST_VALUE_TYPES: ReadonlySet<PropertyType> = new Set<PropertyType>(['person', 'files', 'relation']);

export const isListValueType = (type: PropertyType): boolean => LIST_VALUE_TYPES.has(type);

/** The three Notion groups. Ids equal the kind, so two peers that add a status agree on them. */
export const createDefaultStatusSettings = (names: Partial<Record<StatusGroup['kind'], string>> = {}): StatusSettings => ({
  groups: [
    { id: 'todo', kind: 'todo', name: names.todo ?? 'To-do', color: 'gray', position: 'a0' },
    { id: 'inProgress', kind: 'inProgress', name: names.inProgress ?? 'In progress', color: 'blue', position: 'a1' },
    { id: 'complete', kind: 'complete', name: names.complete ?? 'Complete', color: 'green', position: 'a2' },
  ],
});

export const createDefaultStatusOptions = (
  labels: { notStarted: string; inProgress: string; done: string },
  mintId: () => string
): SelectOption[] => [
  { id: mintId(), label: labels.notStarted, position: 'a0', groupId: 'todo' },
  { id: mintId(), label: labels.inProgress, color: 'blue', position: 'a0', groupId: 'inProgress' },
  { id: mintId(), label: labels.done, color: 'green', position: 'a0', groupId: 'complete' },
];
