import { DATABASE_DEFAULT_TEXT } from './default-text';
import { createDefaultStatusOptions, createDefaultStatusSettings, newView } from './schema-ops';

import type { DatabaseViewConfig, PropertyDefinition, PropertyType, ViewPropertySetting, ViewType } from './types';

/**
 * What a "/" Database entry creates (research/28 §3), by its first layout.
 * Every id comes from `mintId` and every name is English: each client that
 * renders the seed saves it, and those saves must agree. The view localizes
 * the names (database-localization).
 */
export interface SeedDefinition {
  schema: PropertyDefinition[];
  views: DatabaseViewConfig[];
  activeViewId: string;
}

const T = DATABASE_DEFAULT_TEXT;

/** "Question {number}" and the like, as the seed saves them. */
export const numbered = (template: string, n: number): string => template.replace('{number}', String(n));

/** The view name a layout's entry gives its first view. Table keeps Blok's "Table" (Notion's empty name is UNMEASURED). */
const SEED_VIEW_NAMES: Partial<Record<ViewType, string>> = {
  table: T.viewTypeTable,
  board: T.viewBoardSeed,
  gallery: T.viewGallerySeed,
  list: T.viewListSeed,
  feed: T.viewFeedSeed,
  calendar: T.viewCalendarSeed,
  timeline: T.viewTimelineSeed,
  map: T.viewMapSeed,
};

/** The properties after the title, per layout, in the measured order. */
const SEED_PROPERTIES: Partial<Record<ViewType, ReadonlyArray<'assign' | 'status' | 'created' | 'tags' | 'date' | 'place'>>> = {
  board: ['assign', 'status'],
  gallery: ['created', 'tags'],
  list: ['tags', 'created'],
  calendar: ['date', 'tags'],
  timeline: ['assign', 'date', 'status'],
  map: ['place'],
};

const position = (index: number): string => `a${index}`;

const STATUS_OPTION_KEYS = ['not-started', 'in-progress', 'done'];

export const createSeedDefinition = (layout: ViewType, mintId: (name: string) => string): SeedDefinition => {
  const schema: PropertyDefinition[] = [];
  const add = (key: string, name: string, type: PropertyType, extra: Partial<PropertyDefinition> = {}): PropertyDefinition => {
    const property: PropertyDefinition = { id: mintId(key), name, type, position: position(schema.length), ...extra };

    schema.push(property);

    return property;
  };
  const options = (key: string, labels: string[]): Pick<PropertyDefinition, 'config'> => ({
    config: { options: labels.map((label, index) => ({ id: mintId(`${key}-${index + 1}`), label, color: 'default', position: position(index) })) },
  });

  if (layout === 'form') {
    const first = add('title', numbered(T.questionProperty, 1), 'title');

    add('respondent', T.respondentProperty, 'createdBy');
    const second = add('question-2', numbered(T.questionProperty, 2), 'multiSelect',
      options('option', [1, 2, 3].map((n) => numbered(T.optionLabel, n))));

    add('submitted', T.submissionTimeProperty, 'createdTime');
    // The builder asks the two questions; the read-only properties stay off it.
    const questions: ViewPropertySetting[] = schema.map((p) => ({
      id: p.id,
      visible: p.id === first.id || p.id === second.id,
      ...(p.id === second.id ? { maxSelections: 1 } : {}),
    }));
    const builder = newView({ id: mintId('view'), name: T.viewFormBuilder, type: 'form', position: 'a0', properties: questions }, schema);
    const responses = newView({ id: mintId('responses'), name: T.viewResponses, type: 'table', position: 'a1' }, schema);

    return { schema, views: [builder, responses], activeViewId: builder.id };
  }

  add('title', T.sourceTitleProperty, 'title');
  for (const kind of SEED_PROPERTIES[layout] ?? []) {
    if (kind === 'assign') add('assign', T.assignProperty, 'person');
    if (kind === 'created') add('created', T.createdProperty, 'createdTime');
    if (kind === 'tags') add('tags', T.tagsProperty, 'multiSelect', { config: { options: [] } });
    if (kind === 'date') add('date', T.dateProperty, 'date');
    if (kind === 'place') add('place', T.placeProperty, 'place');
    if (kind === 'status') {
      const labels = { notStarted: T.statusNotStarted, inProgress: T.statusInProgress, done: T.statusDone };

      add('status', T.statusProperty, 'status', {
        config: { options: createDefaultStatusOptions(labels, () => '').map((option, index) => ({ ...option, id: mintId(STATUS_OPTION_KEYS[index]) })) },
        status: createDefaultStatusSettings(),
      });
    }
  }
  const groupBy = schema.find((p) => p.type === 'status')?.id;
  const view = newView({
    id: mintId('view'),
    name: SEED_VIEW_NAMES[layout] ?? T.viewBoard,
    type: layout,
    position: 'a0',
    ...(layout === 'board' ? { groupBy } : {}),
  }, schema);

  return { schema, views: [view], activeViewId: view.id };
};
