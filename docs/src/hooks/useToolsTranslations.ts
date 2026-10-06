// docs/src/hooks/useToolsTranslations.ts
import { useMemo } from 'react';
import { useI18n } from '../contexts/I18nContext';
import { TOOL_SECTIONS, TOOLS_SIDEBAR_SECTIONS } from '../components/tools/tools-data';
import type { ToolSection, ToolsSidebarSection } from '../components/tools/tools-data';

/**
 * `getTranslation` splits a key on ".", so a dotted option name ("styles.size")
 * has to be flattened before it can be a catalogue key.
 */
const optionKey = (option: string): string => option.replace(/\./g, '_');

/**
 * One tool in a locale: its catalogue strings over the authored English. The
 * page fingerprint calls this too, so a page is dated by what it renders.
 */
export const translateToolSection = (section: ToolSection, t: (key: string) => string): ToolSection => {
  // `t` returns the key itself when it cannot resolve it, so an unresolved key
  // has to be detected rather than treated as a falsy value.
  const translateOr = (key: string, fallback: string): string => {
    const translated = t(key);
    return translated !== key ? translated : fallback;
  };

  return {
    ...section,
    title: translateOr(`tools.links.${section.id}`, section.title),
    description: translateOr(`tools.docs.${section.id}.description`, section.description),
    configOptions: section.configOptions.map((option) => ({
      ...option,
      description: translateOr(
        `tools.docs.${section.id}.options.${optionKey(option.option)}.description`,
        option.description,
      ),
    })),
  };
};

export const useToolsTranslations = () => {
  const { t, locale } = useI18n();

  const translateOr = (key: string, fallback: string): string => {
    const translated = t(key);
    return translated !== key ? translated : fallback;
  };

  const toolSections = useMemo(
    (): ToolSection[] => TOOL_SECTIONS.map((section) => translateToolSection(section, t)),
    [t, locale],
  );

  const sidebarSections = useMemo((): ToolsSidebarSection[] => {
    return [
      {
        title: t('tools.sections.blockTools'),
        links: TOOLS_SIDEBAR_SECTIONS[0].links.map((link) => ({
          id: link.id,
          label: translateOr(`tools.links.${link.id}`, link.label),
        })),
      },
      {
        title: t('tools.sections.inlineTools'),
        links: TOOLS_SIDEBAR_SECTIONS[1].links.map((link) => ({
          id: link.id,
          label: translateOr(`tools.links.${link.id}`, link.label),
        })),
      },
    ];
  }, [t, locale]);

  const filterLabel = useMemo(() => t('tools.filterLabel'), [t, locale]);

  return { toolSections, sidebarSections, filterLabel };
};
