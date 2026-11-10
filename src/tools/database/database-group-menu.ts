import type { I18n } from '../../../types';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { IconCheck, IconEyeSlash, IconPreview, IconSliders, IconTrash } from '../../components/icons';
import { OPTION_COLORS, optionColorLabelKey, optionSwatch, type OptionColor } from './cells/option-colors';

/**
 * PopoverDesktop `class` for the database's menus. database.css keys their
 * 200ms open and close motion off it; cell editors leave it off, as Notion's do.
 */
export const DATABASE_MENU_CLASS = 'blok-database-menu';

/** The board column's group menu: the header menu's 28px rows plus its own icon and text offsets (database.css). */
export const DATABASE_GROUP_MENU_CLASS = `${DATABASE_MENU_CLASS} blok-database-header-menu blok-database-group-menu`;

export interface GroupMenuParams {
  i18n: I18n;
  /** The no-value group has no option, so it has no color. */
  isNoValue: boolean;
  color: OptionColor | undefined;
  aggregationHidden: boolean;
  /** False where the group header shows no count (the table), so the toggle would do nothing. */
  hasAggregation?: boolean;
  /** A status option's group: Notion lists no colours for it (findings-board B13). */
  isStatus: boolean;
  /** Opens the view settings Group page (findings-board B14). */
  onEditGroups: () => void;
  onToggleAggregation: () => void;
  onHide: () => void;
  onTrash: () => void;
  onRecolor: (color: OptionColor) => void;
}

/**
 * The board column and table group "More group options" menu (research/08): Edit groups,
 * Hide aggregation, Hide group, Move to Trash, then "Colors" and the ten colors. The current
 * color carries a check mark, never a blue fill.
 */
export const groupMenuItems = (params: GroupMenuParams): PopoverItemParams[] => {
  const t = (key: string): string => params.i18n.t(key);
  const items: PopoverItemParams[] = [
    {
      name: 'edit-groups',
      title: t('tools.database.groupEditGroups'),
      icon: IconSliders,
      closeOnActivate: true,
      onActivate: params.onEditGroups,
    },
    ...(params.hasAggregation === false ? [] : [{
      name: 'toggle-aggregation',
      title: t(params.aggregationHidden ? 'tools.database.groupShowAggregation' : 'tools.database.groupHideAggregation'),
      icon: params.aggregationHidden ? IconPreview : IconEyeSlash,
      closeOnActivate: true,
      onActivate: params.onToggleAggregation,
    }]),
    {
      name: 'hide-group',
      title: t('tools.database.groupHide'),
      icon: IconEyeSlash,
      closeOnActivate: true,
      onActivate: params.onHide,
    },
    {
      name: 'move-to-trash',
      title: t('tools.database.groupMoveToTrash'),
      icon: IconTrash,
      isDestructive: true,
      closeOnActivate: true,
      onActivate: params.onTrash,
    },
  ];

  if (params.isNoValue || params.isStatus) {
    return items;
  }

  const heading = document.createElement('div');

  heading.setAttribute('data-blok-database-group-menu-heading', '');
  heading.textContent = t('tools.database.optionColors');

  return [
    ...items,
    { type: PopoverItemType.Separator },
    { type: PopoverItemType.Html, element: heading, name: 'colors-heading' },
    ...OPTION_COLORS.map((color): PopoverItemParams => ({
      name: `color-${color}`,
      title: t(optionColorLabelKey(color)),
      icon: optionSwatch(color),
      trailingIcon: color === params.color ? IconCheck : undefined,
      closeOnActivate: true,
      onActivate: () => params.onRecolor(color),
    })),
  ];
};
