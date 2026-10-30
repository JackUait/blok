import type { I18n } from '../../../types';
import { databaseEnglish } from './database-english';
import type { DatabaseViewConfig, PropertyDefinition, SelectOption, StatusGroup } from './types';
import { DATABASE_DEFAULT_TEXT } from '../../shared/database/default-text';
import { numbered } from '../../shared/database/seed-layouts';

const DEFAULT_KEYS = {
  titleProperty: 'tools.database.defaultTitleProperty',
  sourceTitleProperty: 'tools.database.defaultSourceTitleProperty',
  statusProperty: 'tools.database.defaultStatusProperty',
  statusNotStarted: 'tools.database.defaultStatusNotStarted',
  statusInProgress: 'tools.database.defaultStatusInProgress',
  statusDone: 'tools.database.defaultStatusDone',
  statusGroupTodo: 'tools.database.statusGroupTodo',
  statusGroupInProgress: 'tools.database.statusGroupInProgress',
  statusGroupComplete: 'tools.database.statusGroupComplete',
  viewBoard: 'tools.database.defaultViewBoard',
  viewTypeBoard: 'tools.database.viewTypeBoard',
  viewTypeList: 'tools.database.viewTypeList',
  viewTypeTable: 'tools.database.viewTypeTable',
  viewTypeGallery: 'tools.database.viewTypeGallery',
  viewTypeCalendar: 'tools.database.viewTypeCalendar',
  viewTypeTimeline: 'tools.database.viewTypeTimeline',
  viewTypeChart: 'tools.database.viewTypeChart',
  viewTypeFeed: 'tools.database.viewTypeFeed',
  viewTypeForm: 'tools.database.viewTypeForm',
  viewTypeMap: 'tools.database.viewTypeMap',
  viewMapSeed: 'toolNames.mapView',
  placeProperty: 'tools.database.propertyTypePlace',
  viewBoardSeed: 'toolNames.board',
  viewGallerySeed: 'toolNames.galleryView',
  viewListSeed: 'toolNames.listView',
  viewFeedSeed: 'toolNames.feedView',
  viewCalendarSeed: 'toolNames.calendarView',
  viewTimelineSeed: 'toolNames.timelineView',
  viewFormBuilder: 'tools.database.seedFormBuilder',
  viewResponses: 'tools.database.seedResponses',
  assignProperty: 'tools.database.seedAssign',
  createdProperty: 'tools.database.seedCreated',
  tagsProperty: 'tools.database.starterTags',
  dateProperty: 'tools.database.propertyTypeDate',
  questionProperty: 'tools.database.seedQuestion',
  respondentProperty: 'tools.database.seedRespondent',
  submissionTimeProperty: 'tools.database.seedSubmissionTime',
  optionLabel: 'tools.database.seedOption',
} as const;

type DefaultKey = typeof DEFAULT_KEYS[keyof typeof DEFAULT_KEYS];

const englishDefault = (key: DefaultKey): string =>
  databaseEnglish[key] ?? key;

export { DATABASE_DEFAULT_TEXT };

const localizeCanonicalValue = (
  value: string,
  canonicalValue: string,
  key: DefaultKey,
  i18n: I18n
): string => value === canonicalValue ? i18n.t(key) : value;

/** The "/" Database entries' seeded names (research/28 §3), by type: a same name on another type stays. */
const SEEDED_PROPERTY_NAMES: ReadonlyArray<[PropertyDefinition['type'], string, DefaultKey]> = [
  ['person', DATABASE_DEFAULT_TEXT.assignProperty, DEFAULT_KEYS.assignProperty],
  ['createdTime', DATABASE_DEFAULT_TEXT.createdProperty, DEFAULT_KEYS.createdProperty],
  ['multiSelect', DATABASE_DEFAULT_TEXT.tagsProperty, DEFAULT_KEYS.tagsProperty],
  ['date', DATABASE_DEFAULT_TEXT.dateProperty, DEFAULT_KEYS.dateProperty],
  ['createdBy', DATABASE_DEFAULT_TEXT.respondentProperty, DEFAULT_KEYS.respondentProperty],
  ['createdTime', DATABASE_DEFAULT_TEXT.submissionTimeProperty, DEFAULT_KEYS.submissionTimeProperty],
  ['status', DATABASE_DEFAULT_TEXT.statusProperty, DEFAULT_KEYS.statusProperty],
];

/** The form seed's "Question 1" (title) and "Question 2" (multi-select). */
const SEEDED_QUESTIONS: ReadonlyArray<[PropertyDefinition['type'], number]> = [['title', 1], ['multiSelect', 2]];

/** "Option 1" to "Option 3" of the form seed's second question. */
const SEEDED_OPTION_COUNT = 3;

const localizeNumbered = (value: string, template: string, key: DefaultKey, numbers: number[], i18n: I18n): string | undefined => {
  const n = numbers.find((candidate) => value === numbered(template, candidate));

  return n === undefined ? undefined : i18n.t(key, { number: n });
};

const localizePropertyName = (property: PropertyDefinition, i18n: I18n): string => {
  const question = SEEDED_QUESTIONS.find(([type]) => type === property.type);
  const questionName = question === undefined
    ? undefined
    : localizeNumbered(property.name, DATABASE_DEFAULT_TEXT.questionProperty, DEFAULT_KEYS.questionProperty, [question[1]], i18n);

  if (questionName !== undefined) return questionName;
  const seeded = SEEDED_PROPERTY_NAMES.find(([type, name]) => type === property.type && name === property.name);

  if (seeded !== undefined) return i18n.t(seeded[2]);

  if (property.type === 'title' && property.name === DATABASE_DEFAULT_TEXT.sourceTitleProperty) {
    return i18n.t(DEFAULT_KEYS.sourceTitleProperty);
  }

  if (property.type === 'title') {
    return localizeCanonicalValue(
      property.name,
      DATABASE_DEFAULT_TEXT.titleProperty,
      DEFAULT_KEYS.titleProperty,
      i18n
    );
  }

  if (property.type === 'select') {
    return localizeCanonicalValue(
      property.name,
      DATABASE_DEFAULT_TEXT.statusProperty,
      DEFAULT_KEYS.statusProperty,
      i18n
    );
  }

  if (property.type === 'place') {
    return localizeCanonicalValue(property.name, DATABASE_DEFAULT_TEXT.placeProperty, DEFAULT_KEYS.placeProperty, i18n);
  }

  return property.name;
};

const localizeStatusLabel = (label: string, i18n: I18n): string => {
  const statusDefaults: Array<[string, DefaultKey]> = [
    [DATABASE_DEFAULT_TEXT.statusNotStarted, DEFAULT_KEYS.statusNotStarted],
    [DATABASE_DEFAULT_TEXT.statusInProgress, DEFAULT_KEYS.statusInProgress],
    [DATABASE_DEFAULT_TEXT.statusDone, DEFAULT_KEYS.statusDone],
  ];
  const defaultStatus = statusDefaults.find(([canonicalValue]) => label === canonicalValue);
  const option = localizeNumbered(label, DATABASE_DEFAULT_TEXT.optionLabel, DEFAULT_KEYS.optionLabel,
    Array.from({ length: SEEDED_OPTION_COUNT }, (_, i) => i + 1), i18n);

  return defaultStatus === undefined ? option ?? label : i18n.t(defaultStatus[1]);
};

export const localizeDatabaseSelectOptions = (
  options: SelectOption[],
  i18n: I18n
): SelectOption[] => options.map((option) => ({
  ...option,
  label: localizeStatusLabel(option.label, i18n),
}));

const GROUP_KEYS: Record<StatusGroup['kind'], DefaultKey> = {
  todo: DEFAULT_KEYS.statusGroupTodo,
  inProgress: DEFAULT_KEYS.statusGroupInProgress,
  complete: DEFAULT_KEYS.statusGroupComplete,
};

/** A group still named its English default shows in the editor language; a renamed one keeps its name. */
const localizeStatusGroups = (groups: StatusGroup[], i18n: I18n): StatusGroup[] => groups.map((group) => {
  const key = GROUP_KEYS[group.kind] as DefaultKey | undefined;

  return key === undefined ? group : { ...group, name: localizeCanonicalValue(group.name, englishDefault(key), key, i18n) };
});

export const localizeDatabaseSchema = (
  schema: PropertyDefinition[],
  i18n: I18n
): PropertyDefinition[] => schema.map((property) => ({
  ...property,
  name: localizePropertyName(property, i18n),
  ...(property.status === undefined ? {} : { status: { ...property.status, groups: localizeStatusGroups(property.status.groups, i18n) } }),
  ...(property.config === undefined
    ? {}
    : {
        config: {
          ...property.config,
          options: localizeDatabaseSelectOptions(property.config.options, i18n),
        },
      }),
}));

/** The first views the "/" Database entries name (research/28 §3). */
const SEEDED_VIEW_NAMES: ReadonlyArray<[DatabaseViewConfig['type'], string, DefaultKey]> = [
  ['board', DATABASE_DEFAULT_TEXT.viewBoardSeed, DEFAULT_KEYS.viewBoardSeed],
  ['gallery', DATABASE_DEFAULT_TEXT.viewGallerySeed, DEFAULT_KEYS.viewGallerySeed],
  ['list', DATABASE_DEFAULT_TEXT.viewListSeed, DEFAULT_KEYS.viewListSeed],
  ['feed', DATABASE_DEFAULT_TEXT.viewFeedSeed, DEFAULT_KEYS.viewFeedSeed],
  ['calendar', DATABASE_DEFAULT_TEXT.viewCalendarSeed, DEFAULT_KEYS.viewCalendarSeed],
  ['timeline', DATABASE_DEFAULT_TEXT.viewTimelineSeed, DEFAULT_KEYS.viewTimelineSeed],
  ['form', DATABASE_DEFAULT_TEXT.viewFormBuilder, DEFAULT_KEYS.viewFormBuilder],
  ['table', DATABASE_DEFAULT_TEXT.viewResponses, DEFAULT_KEYS.viewResponses],
];

const localizeViewName = (view: DatabaseViewConfig, i18n: I18n): string => {
  const seeded = SEEDED_VIEW_NAMES.find(([type, name]) => type === view.type && name === view.name);

  if (seeded !== undefined) return i18n.t(seeded[2]);

  if (view.type === 'board') {
    return localizeCanonicalValue(
      view.name,
      DATABASE_DEFAULT_TEXT.viewBoard,
      DEFAULT_KEYS.viewBoard,
      i18n
    );
  }

  if (view.type === 'list') {
    return localizeCanonicalValue(
      view.name,
      DATABASE_DEFAULT_TEXT.viewTypeList,
      DEFAULT_KEYS.viewTypeList,
      i18n
    );
  }

  if (view.type === 'table') {
    return localizeCanonicalValue(
      view.name,
      DATABASE_DEFAULT_TEXT.viewTypeTable,
      DEFAULT_KEYS.viewTypeTable,
      i18n
    );
  }

  if (view.type === 'gallery') {
    return localizeCanonicalValue(view.name, DATABASE_DEFAULT_TEXT.viewTypeGallery, DEFAULT_KEYS.viewTypeGallery, i18n);
  }

  if (view.type === 'calendar') {
    return localizeCanonicalValue(view.name, DATABASE_DEFAULT_TEXT.viewTypeCalendar, DEFAULT_KEYS.viewTypeCalendar, i18n);
  }

  if (view.type === 'timeline') {
    return localizeCanonicalValue(view.name, DATABASE_DEFAULT_TEXT.viewTypeTimeline, DEFAULT_KEYS.viewTypeTimeline, i18n);
  }

  if (view.type === 'chart') {
    return localizeCanonicalValue(view.name, DATABASE_DEFAULT_TEXT.viewTypeChart, DEFAULT_KEYS.viewTypeChart, i18n);
  }

  if (view.type === 'feed') {
    return localizeCanonicalValue(view.name, DATABASE_DEFAULT_TEXT.viewTypeFeed, DEFAULT_KEYS.viewTypeFeed, i18n);
  }

  if (view.type === 'form') {
    return localizeCanonicalValue(view.name, DATABASE_DEFAULT_TEXT.viewTypeForm, DEFAULT_KEYS.viewTypeForm, i18n);
  }

  if (view.type === 'map' && view.name === DATABASE_DEFAULT_TEXT.viewMapSeed) {
    return i18n.t(DEFAULT_KEYS.viewMapSeed);
  }

  if (view.type === 'map') {
    return localizeCanonicalValue(view.name, DATABASE_DEFAULT_TEXT.viewTypeMap, DEFAULT_KEYS.viewTypeMap, i18n);
  }

  return view.name;
};

export const localizeDatabaseViews = (
  views: DatabaseViewConfig[],
  i18n: I18n
): DatabaseViewConfig[] => views.map((view) => ({
  ...view,
  name: localizeViewName(view, i18n),
}));
