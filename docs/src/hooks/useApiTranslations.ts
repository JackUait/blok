import { useMemo } from 'react';
import { useI18n } from '../contexts/I18nContext';
import type { ApiSection } from '../components/api/api-data';
import { API_SECTIONS as BASE_API_SECTIONS } from '../components/api/api-data';
import type { SidebarSection } from '../components/common/Sidebar';
import { SIDEBAR_GROUPS } from '../components/api/api-nav';
import { SECTION_ICONS } from '../components/api/section-icons';
import { TOOL_SECTIONS } from '../components/tools/tools-data';

/**
 * Mapping of section IDs to translation keys
 */
const SECTION_TRANSLATION_KEYS: Record<string, string> = {
  'quick-start': 'api.quickStart',
  'tutorial': 'api.tutorial',
  'concepts': 'api.concepts',
  'custom-block-tool': 'api.howToCustomTool',
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
  'blok-editor': 'api.blokEditor',
  'use-blocks': 'api.useBlocks',
  'view-api': 'api.viewApi',
};

const SIDEBAR_LINK_KEYS: Record<string, string> = {
  'quick-start': 'api.links.quickStart',
  'tutorial': 'api.links.tutorial',
  'concepts': 'api.links.everythingIsABlock',
  'custom-block-tool': 'api.links.customBlockTool',
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
  'blok-editor': 'api.links.blokEditor',
  'use-blocks': 'api.links.useBlocks',
  'view-api': 'api.links.viewApi',
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
    const apiGroups: SidebarSection[] = SIDEBAR_GROUPS.map((group) => ({
      title: t(`api.sections.${group.key}`),
      icon: SECTION_ICONS[group.key],
      iconAnimation: group.key,
      links: group.moduleIds.map((id) => ({ id, label: t(SIDEBAR_LINK_KEYS[id]) })),
    }));

    // Built-in tools now live in the general docs nav. Split by tool type and
    // dedupe by id (tools-data has a stray duplicate) so each routes to a page.
    const seen = new Set<string>();
    const blockLinks: { id: string; label: string }[] = [];
    const inlineLinks: { id: string; label: string }[] = [];
    for (const tool of TOOL_SECTIONS) {
      if (seen.has(tool.id)) continue;
      seen.add(tool.id);
      const link = { id: tool.id, label: safeTranslate(t, `tools.links.${tool.id}`) ?? tool.title };
      (tool.type === 'block' ? blockLinks : inlineLinks).push(link);
    }

    return [
      ...apiGroups,
      {
        title: t('tools.sections.blockTools'),
        icon: SECTION_ICONS.blockTools,
        iconAnimation: 'blockTools',
        links: blockLinks,
      },
      {
        title: t('tools.sections.inlineTools'),
        icon: SECTION_ICONS.inlineTools,
        iconAnimation: 'inlineTools',
        links: inlineLinks,
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
