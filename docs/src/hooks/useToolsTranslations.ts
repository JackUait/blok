// docs/src/hooks/useToolsTranslations.ts
import { useMemo } from 'react';
import { useI18n } from '../contexts/I18nContext';
import { TOOL_SECTIONS, TOOLS_SIDEBAR_SECTIONS } from '../components/tools/tools-data';
import type { ToolSection, ToolsSidebarSection } from '../components/tools/tools-data';

export const useToolsTranslations = () => {
  const { t, locale } = useI18n();

  const toolSections = useMemo((): ToolSection[] => {
    return TOOL_SECTIONS.map((section) => {
      const titleKey = `tools.links.${section.id}`;
      const titleTranslated = t(titleKey);
      return {
        ...section,
        title: titleTranslated !== titleKey ? titleTranslated : section.title,
      };
    });
  }, [t, locale]);

  const sidebarSections = useMemo((): ToolsSidebarSection[] => {
    return [
      {
        title: t('tools.sections.blockTools'),
        links: TOOLS_SIDEBAR_SECTIONS[0].links.map((link) => ({
          id: link.id,
          label: t(`tools.links.${link.id}`) || link.label,
        })),
      },
      {
        title: t('tools.sections.inlineTools'),
        links: TOOLS_SIDEBAR_SECTIONS[1].links.map((link) => ({
          id: link.id,
          label: t(`tools.links.${link.id}`) || link.label,
        })),
      },
    ];
  }, [t, locale]);

  const filterLabel = useMemo(() => t('tools.filterLabel'), [t, locale]);

  return { toolSections, sidebarSections, filterLabel };
};
