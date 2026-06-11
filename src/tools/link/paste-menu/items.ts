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
import { matchEmbedService, type EmbedServiceType } from '../registry';

import type { PasteMenuActionType, PasteMenuOption } from './options';

import type { PopoverItemParams } from '@/types/utils/popover/popover-item';

/**
 * Minimal i18n contract the paste menu needs to translate item labels.
 */
export interface PasteMenuI18n {
  t(key: string): string;
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
 * Icon for each link-type category a registry service can declare, shown on the
 * embed item so the menu reads as "what kind of content this link is".
 */
const EMBED_TYPE_ICONS: Record<EmbedServiceType, string> = {
  video: IconVideo,
  audio: IconMusic,
  image: IconImage,
  social: IconMessage,
  document: IconFile,
  table: IconTable,
  form: IconListChecklist,
  code: IconCode,
  design: IconPencil,
  chart: IconChart,
  map: IconMap,
  calendar: IconCalendar,
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
 * When `url` matches a registered embed provider, the embed item names the
 * provider (e.g. "YouTube") with its link-type icon, and the generic "Embed"
 * label moves to the secondary label.
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

    return {
      name: `paste-menu-${type}`,
      title: embedMatch ? embedMatch.title : i18n.t(labelKey),
      icon: embedMatch ? EMBED_TYPE_ICONS[embedMatch.type] : icon,
      ...(embedMatch ? { secondaryLabel: i18n.t(labelKey) } : {}),
      closeOnActivate: true,
      onActivate: (): void => {
        onSelect(type);
      },
    };
  });
}
