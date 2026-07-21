import {
  IconBookmark,
  IconCalendar,
  IconChart,
  IconCode,
  IconFile,
  IconGlobe,
  IconImage,
  IconLink,
  IconListChecklist,
  IconMap,
  IconMessage,
  IconMusic,
  IconPencil,
  IconTable,
  IconVideo,
} from '../../../components/icons';
import {
  EMBED_SERVICES,
  matchEmbedService,
  resolveEmbedServiceTitle,
  type EmbedServiceType,
} from '../registry';

import type { PasteMenuActionType, PasteMenuOption } from './options';

import type { SupportedLocale } from '../../../../types/configs/i18n-config';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';

/**
 * Minimal i18n contract the paste menu needs to translate item labels.
 */
export interface PasteMenuI18n {
  t(key: string): string;
  getLocale?(): SupportedLocale;
}

/**
 * Called when the user picks a paste-menu action.
 */
export type PasteMenuSelectHandler = (type: PasteMenuActionType) => void;

/**
 * Per-type presentation: the i18n label key and the icon to display.
 */
interface PasteMenuItemPresentation {
  labelKey: string;
  icon: string;
}

/**
 * Per link-type presentation of the embed item: the icon and the i18n key of an
 * action template with a `{provider}` placeholder (e.g. "Embed a video from {provider}"),
 * so the menu reads as "what this link will become".
 */
const EMBED_TYPE_PRESENTATION: Record<EmbedServiceType, { icon: string; labelKey: string }> = {
  video: { icon: IconVideo, labelKey: 'tools.linkPaste.embedVideo' },
  audio: { icon: IconMusic, labelKey: 'tools.linkPaste.embedAudio' },
  image: { icon: IconImage, labelKey: 'tools.linkPaste.embedImage' },
  social: { icon: IconMessage, labelKey: 'tools.linkPaste.embedSocial' },
  document: { icon: IconFile, labelKey: 'tools.linkPaste.embedDocument' },
  table: { icon: IconTable, labelKey: 'tools.linkPaste.embedTable' },
  form: { icon: IconListChecklist, labelKey: 'tools.linkPaste.embedForm' },
  code: { icon: IconCode, labelKey: 'tools.linkPaste.embedCode' },
  design: { icon: IconPencil, labelKey: 'tools.linkPaste.embedDesign' },
  chart: { icon: IconChart, labelKey: 'tools.linkPaste.embedChart' },
  map: { icon: IconMap, labelKey: 'tools.linkPaste.embedMap' },
  calendar: { icon: IconCalendar, labelKey: 'tools.linkPaste.embedCalendar' },
};

/**
 * Resolves the label key and icon for a paste-menu action type.
 * Switch has no `default` branch so the compiler enforces exhaustiveness.
 */
const presentationFor = (type: PasteMenuActionType): PasteMenuItemPresentation => {
  switch (type) {
    case 'plain':
      return { labelKey: 'tools.linkPaste.plain', icon: IconLink };
    case 'bookmark':
      return { labelKey: 'tools.linkPaste.bookmark', icon: IconBookmark };
    case 'embed':
      return { labelKey: 'tools.linkPaste.embed', icon: IconGlobe };
    case 'mention':
      return { labelKey: 'tools.linkPaste.mention', icon: IconLink };
  }
};

/**
 * Maps paste-menu options to Popover item params, preserving order.
 * Each item closes the popover on activation and reports its type to `onSelect`.
 *
 * When `url` matches a registered embed provider, the embed item is titled with
 * the provider's link-type action template (e.g. "Embed a video from YouTube") and
 * shows the link-type icon instead of the generic globe.
 */
export function buildPasteMenuItems(
  options: PasteMenuOption[],
  i18n: PasteMenuI18n,
  onSelect: PasteMenuSelectHandler,
  url?: string
): PopoverItemParams[] {
  return options.map(({ type }) => {
    const { labelKey, icon } = presentationFor(type);
    const embedMatch = type === 'embed' && url !== undefined ? matchEmbedService(url) : null;
    const typed = embedMatch ? EMBED_TYPE_PRESENTATION[embedMatch.type] : null;
    const providerTitle = embedMatch
      ? resolveEmbedServiceTitle(EMBED_SERVICES[embedMatch.service], i18n.getLocale?.())
      : null;

    return {
      name: `paste-menu-${type}`,
      title: typed && providerTitle
        ? i18n.t(typed.labelKey).replace('{provider}', providerTitle)
        : i18n.t(labelKey),
      icon: typed ? typed.icon : icon,
      closeOnActivate: true,
      onActivate: (): void => {
        onSelect(type);
      },
    };
  });
}
