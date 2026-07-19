import type { I18n } from '../../../types';
import { englishDictionary } from '../../components/i18n/lightweight-i18n';
import type { DatabaseViewConfig, PropertyDefinition, SelectOption } from './types';

const DEFAULT_KEYS = {
  titleProperty: 'tools.database.defaultTitleProperty',
  statusProperty: 'tools.database.defaultStatusProperty',
  statusNotStarted: 'tools.database.defaultStatusNotStarted',
  statusInProgress: 'tools.database.defaultStatusInProgress',
  statusDone: 'tools.database.defaultStatusDone',
  viewBoard: 'tools.database.defaultViewBoard',
  viewTypeBoard: 'tools.database.viewTypeBoard',
  viewTypeList: 'tools.database.viewTypeList',
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
  viewBoard: englishDefault(DEFAULT_KEYS.viewBoard),
  viewTypeBoard: englishDefault(DEFAULT_KEYS.viewTypeBoard),
  viewTypeList: englishDefault(DEFAULT_KEYS.viewTypeList),
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

export const localizeDatabaseSchema = (
  schema: PropertyDefinition[],
  i18n: I18n
): PropertyDefinition[] => schema.map((property) => ({
  ...property,
  name: localizePropertyName(property, i18n),
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

  return view.name;
};

export const localizeDatabaseViews = (
  views: DatabaseViewConfig[],
  i18n: I18n
): DatabaseViewConfig[] => views.map((view) => ({
  ...view,
  name: localizeViewName(view, i18n),
}));
