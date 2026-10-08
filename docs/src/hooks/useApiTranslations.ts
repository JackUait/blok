import { useMemo } from 'react';
import { useI18n } from '../contexts/I18nContext';
import type { ApiSection } from '../components/api/api-data';
import { API_SECTIONS as BASE_API_SECTIONS } from '../components/api/api-data';
import { safeTranslate, useDocsSidebarSections } from './useDocsSidebarSections';

/**
 * Mapping of section IDs to translation keys
 */
export const SECTION_TRANSLATION_KEYS: Record<string, string> = {
  'quick-start': 'api.quickStart',
  'tutorial': 'api.tutorial',
  'concepts': 'api.concepts',
  'custom-block-tool': 'api.howToCustomTool',
  'tab-sync': 'api.tabSync',
  'core': 'api.blokClass',
  'config': 'api.configuration',
  'blocks-api': 'api.blocksApi',
  'block-api': 'api.blockApi',
  'caret-api': 'api.caretApi',
  'events-api': 'api.eventsApi',
  'history-api': 'api.historyApi',
  'saver-api': 'api.saverApi',
  'selection-api': 'api.selectionApi',
  'marks-api': 'api.marksApi',
  'styles-api': 'api.stylesApi',
  'toolbar-api': 'api.toolbarApi',
  'inline-toolbar-api': 'api.inlineToolbarApi',
  'notifier-api': 'api.notifierApi',
  'sanitizer-api': 'api.sanitizerApi',
  'dev-override-seam': 'api.devOverrideSeam',
  'tooltip-api': 'api.tooltipApi',
  'theme-api': 'api.themeApi',
  'width-api': 'api.widthApi',
  'placeholder-api': 'api.placeholderApi',
  'title-api': 'api.titleApi',
  'readonly-api': 'api.readOnlyApi',
  'i18n-api': 'api.i18nApi',
  'ui-api': 'api.uiApi',
  'listeners-api': 'api.listenersApi',
  'view-state-api': 'api.viewStateApi',
  'tools-api': 'api.toolsApi',
  'uploader-api': 'api.uploaderApi',
  'output-data': 'api.outputData',
  'block-data': 'api.blockData',
  'blok-editor': 'api.blokEditor',
  'use-blocks': 'api.useBlocks',
  'use-blok-ready': 'api.useBlokReady',
  'view-api': 'api.viewApi',
};

/**
 * Extracts the base key from a method name.
 * e.g. "save()" -> "save", "render(data)" -> "render", "focus(atEnd?)" -> "focus"
 */
export function getMethodKey(methodName: string): string {
  return methodName.replace(/\(.*\)$/, '');
}

/**
 * One API section in a locale: its catalogue strings over the authored English.
 * The page fingerprint calls this too, so a page is dated by what it renders.
 */
export const translateApiSection = (section: ApiSection, t: (key: string) => string): ApiSection => {
  const translationKey = SECTION_TRANSLATION_KEYS[section.id];
  if (!translationKey) {
    return section;
  }

  const translatedMethods = section.methods?.map((method) => {
    const methodKey = getMethodKey(method.name);
    const descKey = `${translationKey}.methods.${methodKey}.description`;
    const noteKey = `${translationKey}.methods.${methodKey}.note`;
    const translatedDesc = safeTranslate(t, descKey);
    const translatedNote = safeTranslate(t, noteKey);

    const translatedParams = method.params?.map((param) => {
      const paramDescKey = `${translationKey}.methods.${methodKey}.params.${param.name}.description`;
      const translated = safeTranslate(t, paramDescKey);
      return translated !== undefined ? { ...param, description: translated } : param;
    });

    const translatedErrors = method.errors?.map((error, index) => {
      const conditionKey = `${translationKey}.methods.${methodKey}.errors.${index}.condition`;
      const resolutionKey = `${translationKey}.methods.${methodKey}.errors.${index}.resolution`;
      const translatedCondition = safeTranslate(t, conditionKey);
      const translatedResolution = safeTranslate(t, resolutionKey);
      if (translatedCondition === undefined && translatedResolution === undefined) {
        return error;
      }
      return {
        ...error,
        ...(translatedCondition !== undefined && { condition: translatedCondition }),
        ...(translatedResolution !== undefined && { resolution: translatedResolution }),
      };
    });

    if (
      translatedDesc === undefined &&
      translatedNote === undefined &&
      translatedParams === undefined &&
      translatedErrors === undefined
    ) {
      return method;
    }
    return {
      ...method,
      ...(translatedDesc !== undefined && { description: translatedDesc }),
      ...(translatedNote !== undefined && { note: translatedNote }),
      ...(translatedParams !== undefined && { params: translatedParams }),
      ...(translatedErrors !== undefined && { errors: translatedErrors }),
    };
  });

  const translatedProperties = section.properties?.map((property) => {
    const descKey = `${translationKey}.properties.${property.name}.description`;
    const translated = safeTranslate(t, descKey);
    return translated !== undefined ? { ...property, description: translated } : property;
  });

  const translatedTable = section.table?.map((row) => {
    const descKey = `${translationKey}.table.${row.option}.description`;
    const translated = safeTranslate(t, descKey);
    return translated !== undefined ? { ...row, description: translated } : row;
  });

  // A section whose locale entry is missing keeps its authored English copy
  // instead of rendering the raw key ("api.themeApi.title") at the reader.
  return {
    ...section,
    title: safeTranslate(t, `${translationKey}.title`) ?? section.title,
    badge: section.badge
      ? safeTranslate(t, `${translationKey}.badge`) ?? section.badge
      : undefined,
    description: section.description
      ? safeTranslate(t, `${translationKey}.description`) ?? section.description
      : undefined,
    ...(translatedMethods !== undefined && { methods: translatedMethods }),
    ...(translatedProperties !== undefined && { properties: translatedProperties }),
    ...(translatedTable !== undefined && { table: translatedTable }),
  };
};

/**
 * Hook that returns translated API sections for the documentation page
 */
export const useApiTranslations = () => {
  const { t, locale } = useI18n();

  const translatedSections = useMemo((): ApiSection[] => {
    return BASE_API_SECTIONS.map((section) => translateApiSection(section, t));
  }, [t, locale]);

  const translatedSidebarSections = useDocsSidebarSections();

  const filterLabel = useMemo(() => t('api.filterLabel'), [t, locale]);

  return {
    apiSections: translatedSections,
    sidebarSections: translatedSidebarSections,
    filterLabel,
  };
}
