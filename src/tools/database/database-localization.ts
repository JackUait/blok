import type { I18n } from '../../../types';
import { englishDictionary } from '../../components/i18n/lightweight-i18n';
import type { DatabaseViewConfig, PropertyDefinition, SelectOption, StatusGroup } from './types';

const DEFAULT_KEYS = {
  titleProperty: 'tools.database.defaultTitleProperty',
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
} as const;

type DefaultKey = typeof DEFAULT_KEYS[keyof typeof DEFAULT_KEYS];

const englishDefault = (key: DefaultKey): string =>
  (englishDictionary as Record<string, string>)[key] ?? key;

export const DATABASE_DEFAULT_TEXT = {
  titleProperty: englishDefault(DEFAULT_KEYS.titleProperty),
  statusProperty: englishDefault(DEFAULT_KEYS.statusProperty),
  statusNotStarted: englishDefault(DEFAULT_KEYS.statusNotStarted),
  statusInProgress: englishDefault(DEFAULT_KEYS.statusInProgress),
  statusDone: englishDefault(DEFAULT_KEYS.statusDone),
  statusGroupTodo: englishDefault(DEFAULT_KEYS.statusGroupTodo),
  statusGroupInProgress: englishDefault(DEFAULT_KEYS.statusGroupInProgress),
  statusGroupComplete: englishDefault(DEFAULT_KEYS.statusGroupComplete),
  viewBoard: englishDefault(DEFAULT_KEYS.viewBoard),
  viewTypeBoard: englishDefault(DEFAULT_KEYS.viewTypeBoard),
  viewTypeList: englishDefault(DEFAULT_KEYS.viewTypeList),
  viewTypeTable: englishDefault(DEFAULT_KEYS.viewTypeTable),
  viewTypeGallery: englishDefault(DEFAULT_KEYS.viewTypeGallery),
  viewTypeCalendar: englishDefault(DEFAULT_KEYS.viewTypeCalendar),
  viewTypeTimeline: englishDefault(DEFAULT_KEYS.viewTypeTimeline),
  viewTypeChart: englishDefault(DEFAULT_KEYS.viewTypeChart),
  viewTypeFeed: englishDefault(DEFAULT_KEYS.viewTypeFeed),
} as const;

const localizeCanonicalValue = (
  value: string,
  canonicalValue: string,
  key: DefaultKey,
  i18n: I18n
): string => value === canonicalValue ? i18n.t(key) : value;

const localizePropertyName = (property: PropertyDefinition, i18n: I18n): string => {
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

  return property.name;
};

const localizeStatusLabel = (label: string, i18n: I18n): string => {
  const statusDefaults: Array<[string, DefaultKey]> = [
    [DATABASE_DEFAULT_TEXT.statusNotStarted, DEFAULT_KEYS.statusNotStarted],
    [DATABASE_DEFAULT_TEXT.statusInProgress, DEFAULT_KEYS.statusInProgress],
    [DATABASE_DEFAULT_TEXT.statusDone, DEFAULT_KEYS.statusDone],
  ];
  const defaultStatus = statusDefaults.find(([canonicalValue]) => label === canonicalValue);

  return defaultStatus === undefined ? label : i18n.t(defaultStatus[1]);
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

const localizeViewName = (view: DatabaseViewConfig, i18n: I18n): string => {
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

  return view.name;
};

export const localizeDatabaseViews = (
  views: DatabaseViewConfig[],
  i18n: I18n
): DatabaseViewConfig[] => views.map((view) => ({
  ...view,
  name: localizeViewName(view, i18n),
}));
