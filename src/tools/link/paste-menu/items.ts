import { IconGlobe, IconLink } from '../../../components/icons';

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
 * Resolves the label key and icon for a paste-menu action type.
 * Switch has no `default` branch so the compiler enforces exhaustiveness.
 */
const presentationFor = (type: PasteMenuActionType): PasteMenuItemPresentation => {
  switch (type) {
    case 'plain':
      return { labelKey: 'toolNames.link', icon: IconLink };
    case 'bookmark':
      return { labelKey: 'toolNames.bookmark', icon: IconLink };
    case 'embed':
      return { labelKey: 'toolNames.embed', icon: IconGlobe };
    case 'mention':
      return { labelKey: 'tools.linkPaste.mention', icon: IconLink };
  }
};

/**
 * Maps paste-menu options to Popover item params, preserving order.
 * Each item closes the popover on activation and reports its type to `onSelect`.
 */
export function buildPasteMenuItems(
  options: PasteMenuOption[],
  i18n: PasteMenuI18n,
  onSelect: PasteMenuSelectHandler
): PopoverItemParams[] {
  return options.map(({ type }) => {
    const { labelKey, icon } = presentationFor(type);

    return {
      name: `paste-menu-${type}`,
      title: i18n.t(labelKey),
      icon,
      closeOnActivate: true,
      onActivate: (): void => {
        onSelect(type);
      },
    };
  });
}
