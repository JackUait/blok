import { useMemo } from 'react';
import { useI18n } from '../contexts/I18nContext';
import type { ApiSection, SidebarSection } from '../components/api/api-data';
import { API_SECTIONS as BASE_API_SECTIONS } from '../components/api/api-data';

/**
 * Mapping of section IDs to translation keys
 */
const SECTION_TRANSLATION_KEYS: Record<string, string> = {
  'quick-start': 'api.quickStart',
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
    return [
      {
        title: t('api.sections.guide'),
        links: [{ id: 'quick-start', label: t(SIDEBAR_LINK_KEYS['quick-start']) }],
      },
      {
        title: t('api.sections.core'),
        links: [
          { id: 'core', label: t(SIDEBAR_LINK_KEYS['core']) },
          { id: 'config', label: t(SIDEBAR_LINK_KEYS['config']) },
        ],
      },
      {
        title: t('api.sections.apiModules'),
        links: [
          { id: 'blocks-api', label: t(SIDEBAR_LINK_KEYS['blocks-api']) },
          { id: 'block-api', label: t(SIDEBAR_LINK_KEYS['block-api']) },
          { id: 'caret-api', label: t(SIDEBAR_LINK_KEYS['caret-api']) },
          { id: 'events-api', label: t(SIDEBAR_LINK_KEYS['events-api']) },
          { id: 'history-api', label: t(SIDEBAR_LINK_KEYS['history-api']) },
          { id: 'saver-api', label: t(SIDEBAR_LINK_KEYS['saver-api']) },
          { id: 'selection-api', label: t(SIDEBAR_LINK_KEYS['selection-api']) },
          { id: 'styles-api', label: t(SIDEBAR_LINK_KEYS['styles-api']) },
          { id: 'toolbar-api', label: t(SIDEBAR_LINK_KEYS['toolbar-api']) },
          { id: 'inline-toolbar-api', label: t(SIDEBAR_LINK_KEYS['inline-toolbar-api']) },
          { id: 'notifier-api', label: t(SIDEBAR_LINK_KEYS['notifier-api']) },
          { id: 'sanitizer-api', label: t(SIDEBAR_LINK_KEYS['sanitizer-api']) },
          { id: 'tooltip-api', label: t(SIDEBAR_LINK_KEYS['tooltip-api']) },
          { id: 'readonly-api', label: t(SIDEBAR_LINK_KEYS['readonly-api']) },
          { id: 'i18n-api', label: t(SIDEBAR_LINK_KEYS['i18n-api']) },
          { id: 'ui-api', label: t(SIDEBAR_LINK_KEYS['ui-api']) },
          { id: 'listeners-api', label: t(SIDEBAR_LINK_KEYS['listeners-api']) },
          { id: 'tools-api', label: t(SIDEBAR_LINK_KEYS['tools-api']) },
        ],
      },
      {
        title: t('api.sections.data'),
        links: [
          { id: 'output-data', label: t(SIDEBAR_LINK_KEYS['output-data']) },
          { id: 'block-data', label: t(SIDEBAR_LINK_KEYS['block-data']) },
        ],
      },
    ];
  }, [t, locale]);

  const filterLabel = useMemo(() => t('api.filterLabel'), [t, locale]);

  return {
    apiSections: translatedSections,
    sidebarSections: translatedSidebarSections,
    filterLabel,
  };
}
