import { useMemo } from 'react';
import { useI18n } from '../contexts/I18nContext';
import type { SidebarSection } from '../components/common/Sidebar';
import { SIDEBAR_GROUPS, MODULE_LABELS_EN } from '../components/api/api-nav';
import { SECTION_ICONS } from '../components/api/section-icons';
import { TOOL_SECTIONS, type ToolSection } from '../components/tools/tools-data';

const SIDEBAR_LINK_KEYS: Record<string, string> = {
  'quick-start': 'api.links.quickStart',
  'tutorial': 'api.links.tutorial',
  'concepts': 'api.links.everythingIsABlock',
  'custom-block-tool': 'api.links.customBlockTool',
  'tab-sync': 'api.links.tabSync',
  'core': 'api.links.blokClass',
  'config': 'api.links.configuration',
  'blocks-api': 'api.links.blocks',
  'block-api': 'api.links.blockApi',
  'caret-api': 'api.links.caret',
  'events-api': 'api.links.events',
  'history-api': 'api.links.history',
  'saver-api': 'api.links.saver',
  'selection-api': 'api.links.selection',
  'marks-api': 'api.links.marks',
  'styles-api': 'api.links.styles',
  'toolbar-api': 'api.links.toolbar',
  'inline-toolbar-api': 'api.links.inlineToolbar',
  'notifier-api': 'api.links.notifier',
  'sanitizer-api': 'api.links.sanitizer',
  'dev-override-seam': 'api.links.devOverrideSeam',
  'tooltip-api': 'api.links.tooltip',
  'theme-api': 'api.links.theme',
  'width-api': 'api.links.width',
  'placeholder-api': 'api.links.placeholder',
  'readonly-api': 'api.links.readOnly',
  'i18n-api': 'api.links.i18n',
  'ui-api': 'api.links.ui',
  'listeners-api': 'api.links.listeners',
  'tools-api': 'api.links.tools',
  'uploader-api': 'api.links.uploader',
  'output-data': 'api.links.outputData',
  'block-data': 'api.links.blockData',
  'blok-editor': 'api.links.blokEditor',
  'use-blocks': 'api.links.useBlocks',
  'use-blok-ready': 'api.links.useBlokReady',
  'view-api': 'api.links.viewApi',
};

/**
 * Safely look up a translation key. Returns undefined if the key has no translation
 * (i.e., t() returned the key itself, meaning the key is missing).
 */
export function safeTranslate(t: (key: string) => string, key: string): string | undefined {
  const result = t(key);
  return result !== key ? result : undefined;
}

/**
 * The docs sidebar groups and their links, in a locale. The /docs hub renders
 * the same list as its cards, and the page fingerprint reads it from here.
 */
export const buildDocsSidebarSections = (
  t: (key: string) => string,
  toolSections: ToolSection[],
): SidebarSection[] => {
  const apiGroups: SidebarSection[] = SIDEBAR_GROUPS.map((group) => ({
    title: t(`api.sections.${group.key}`),
    icon: SECTION_ICONS[group.key],
    iconAnimation: group.key,
    // A module with no SIDEBAR_LINK_KEYS entry (or an untranslated one) falls
    // back to its English label — t(undefined) would throw and blank the page.
    links: group.moduleIds.map((id) => ({
      id,
      label:
        (SIDEBAR_LINK_KEYS[id] !== undefined ? safeTranslate(t, SIDEBAR_LINK_KEYS[id]) : undefined)
        ?? MODULE_LABELS_EN[id]
        ?? id,
    })),
  }));

  // Built-in tools now live in the general docs nav. Split by tool type and
  // dedupe by id (tools-data has a stray duplicate) so each routes to a page.
  const seen = new Set<string>();
  const blockLinks: { id: string; label: string }[] = [];
  const inlineLinks: { id: string; label: string }[] = [];
  for (const tool of toolSections) {
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
};

export const useDocsSidebarSections = (): SidebarSection[] => {
  const { t, locale } = useI18n();
  return useMemo(() => buildDocsSidebarSections(t, TOOL_SECTIONS), [t, locale]);
};
