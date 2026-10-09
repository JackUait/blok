import type { I18n } from '../../../types';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { IconCheck, IconHash, IconPreview, IconSliders, IconTrash } from '../../components/icons';
import { OPTION_COLORS, optionColorLabelKey, type OptionColor } from './cells/option-colors';

export interface GroupMenuParams {
  i18n: I18n;
  /** The no-value group has no option, so it has no color. */
  isNoValue: boolean;
  color: OptionColor | undefined;
  aggregationHidden: boolean;
  /** Every group of the view, hidden ones included, in board order. */
  groups: Array<{ id: string; label: string; hidden: boolean }>;
  onToggleGroup: (groupId: string) => void;
  onToggleAggregation: () => void;
  onHide: () => void;
  onTrash: () => void;
  onRecolor: (color: OptionColor) => void;
}

const swatch = (color: OptionColor): HTMLElement => {
  const el = document.createElement('span');

  // Painted by the select editor's swatch rule in database.css.
  el.setAttribute('data-blok-database-option-swatch', '');
  el.setAttribute('data-color', color);

  return el;
};

/**
 * The board column's "More group options" menu (research/08): Edit groups,
 * Hide aggregation, Hide group, Move to Trash, then the ten colors. The current
 * color and the shown groups carry a check mark, never a blue fill.
 */
export const groupMenuItems = (params: GroupMenuParams): PopoverItemParams[] => {
  const t = (key: string): string => params.i18n.t(key);
  const items: PopoverItemParams[] = [
    {
      name: 'edit-groups',
      title: t('tools.database.groupEditGroups'),
      icon: IconSliders,
      children: {
        items: params.groups.map((group) => ({
          name: `group-${group.id}`,
          title: group.label,
          trailingIcon: group.hidden ? undefined : IconCheck,
          closeOnActivate: true,
          onActivate: () => params.onToggleGroup(group.id),
        })),
      },
    },
    {
      name: 'toggle-aggregation',
      title: t(params.aggregationHidden ? 'tools.database.groupShowAggregation' : 'tools.database.groupHideAggregation'),
      icon: IconHash,
      closeOnActivate: true,
      onActivate: params.onToggleAggregation,
    },
    {
      name: 'hide-group',
      title: t('tools.database.groupHide'),
      icon: IconPreview,
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

  if (params.isNoValue) {
    return items;
  }

  return [
    ...items,
    { type: PopoverItemType.Separator },
    ...OPTION_COLORS.map((color): PopoverItemParams => ({
      name: `color-${color}`,
      title: t(optionColorLabelKey(color)),
      icon: swatch(color),
      trailingIcon: color === params.color ? IconCheck : undefined,
      closeOnActivate: true,
      onActivate: () => params.onRecolor(color),
    })),
  ];
};
