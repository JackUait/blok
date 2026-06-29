import { useMemo } from 'react';
import { useI18n } from '../contexts/I18nContext';
import type { ApiSection, SidebarSection } from '../components/api/api-data';
import { API_SECTIONS as BASE_API_SECTIONS } from '../components/api/api-data';
import { SIDEBAR_GROUPS } from '../components/api/api-nav';

/**
 * Mapping of section IDs to translation keys
 */
const SECTION_TRANSLATION_KEYS: Record<string, string> = {
  'quick-start': 'api.quickStart',
  'concepts': 'api.concepts',
  'core': 'api.blokClass',
  'config': 'api.configuration',
  'blocks-api': 'api.blocksApi',
  'block-api': 'api.blockApi',
  'caret-api': 'api.caretApi',
  'events-api': 'api.eventsApi',
  'history-api': 'api.historyApi',
  'saver-api': 'api.saverApi',
  'selection-api': 'api.selectionApi',
  'styles-api': 'api.stylesApi',
  'toolbar-api': 'api.toolbarApi',
  'inline-toolbar-api': 'api.inlineToolbarApi',
  'notifier-api': 'api.notifierApi',
  'sanitizer-api': 'api.sanitizerApi',
  'tooltip-api': 'api.tooltipApi',
  'readonly-api': 'api.readOnlyApi',
  'i18n-api': 'api.i18nApi',
  'ui-api': 'api.uiApi',
  'listeners-api': 'api.listenersApi',
  'tools-api': 'api.toolsApi',
  'output-data': 'api.outputData',
  'block-data': 'api.blockData',
};

const SIDEBAR_LINK_KEYS: Record<string, string> = {
  'quick-start': 'api.links.quickStart',
  'concepts': 'api.links.everythingIsABlock',
  'core': 'api.links.blokClass',
  'config': 'api.links.configuration',
  'blocks-api': 'api.links.blocks',
  'block-api': 'api.links.blockApi',
  'caret-api': 'api.links.caret',
  'events-api': 'api.links.events',
  'history-api': 'api.links.history',
  'saver-api': 'api.links.saver',
  'selection-api': 'api.links.selection',
  'styles-api': 'api.links.styles',
  'toolbar-api': 'api.links.toolbar',
  'inline-toolbar-api': 'api.links.inlineToolbar',
  'notifier-api': 'api.links.notifier',
  'sanitizer-api': 'api.links.sanitizer',
  'tooltip-api': 'api.links.tooltip',
  'readonly-api': 'api.links.readOnly',
  'i18n-api': 'api.links.i18n',
  'ui-api': 'api.links.ui',
  'listeners-api': 'api.links.listeners',
  'tools-api': 'api.links.tools',
  'output-data': 'api.links.outputData',
  'block-data': 'api.links.blockData',
};

/**
 * Extracts the base key from a method name.
 * e.g. "save()" -> "save", "render(data)" -> "render", "focus(atEnd?)" -> "focus"
 */
function getMethodKey(methodName: string): string {
  return methodName.replace(/\(.*\)$/, '');
}

/**
 * Safely look up a translation key. Returns undefined if the key has no translation
 * (i.e., t() returned the key itself, meaning the key is missing).
 */
function safeTranslate(t: (key: string) => string, key: string): string | undefined {
  const result = t(key);
  return result !== key ? result : undefined;
}

/**
 * Hook that returns translated API sections for the documentation page
 */
export const useApiTranslations = () => {
  const { t, locale } = useI18n();

  const translatedSections = useMemo((): ApiSection[] => {
    return BASE_API_SECTIONS.map((section) => {
      const translationKey = SECTION_TRANSLATION_KEYS[section.id];
      if (!translationKey) {
        return section;
      }

      const translatedMethods = section.methods?.map((method) => {
        const methodKey = getMethodKey(method.name);
        const descKey = `${translationKey}.methods.${methodKey}.description`;
        const translated = safeTranslate(t, descKey);
        return translated !== undefined ? { ...method, description: translated } : method;
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

      return {
        ...section,
        title: t(`${translationKey}.title`),
        badge: section.badge ? t(`${translationKey}.badge`) : undefined,
        description: section.description ? t(`${translationKey}.description`) : undefined,
        ...(translatedMethods !== undefined && { methods: translatedMethods }),
        ...(translatedProperties !== undefined && { properties: translatedProperties }),
        ...(translatedTable !== undefined && { table: translatedTable }),
      };
    });
  }, [t, locale]);

  const translatedSidebarSections = useMemo((): SidebarSection[] => {
    return SIDEBAR_GROUPS.map((group) => ({
      title: t(`api.sections.${group.key}`),
      links: group.moduleIds.map((id) => ({ id, label: t(SIDEBAR_LINK_KEYS[id]) })),
    }));
  }, [t, locale]);

  const filterLabel = useMemo(() => t('api.filterLabel'), [t, locale]);

  return {
    apiSections: translatedSections,
    sidebarSections: translatedSidebarSections,
    filterLabel,
  };
}
