import type { I18n } from '../../../types';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import type { ViewChanges } from './database-model';
import type { CardPreview, CardSize, DatabaseViewConfig, PropertyDefinition } from './types';
import {
  resolveCalendarBy,
  resolveCalendarRange,
  resolveCardPreview,
  resolveCardSize,
  resolveFitImage,
  resolveShowWeekends,
} from './view-settings';

type T = Pick<I18n, 't'>;

/**
 * Layout rows for the gallery and calendar settings. The view settings panel
 * (Phase 3) mounts these; nothing here opens a menu.
 */

const choice = (title: string, isActive: boolean, onActivate: () => void): PopoverItemParams => ({
  type: PopoverItemType.Default,
  title,
  isActive,
  onActivate,
});

const CARD_SIZES: Array<[CardSize, string]> = [
  ['small', 'tools.database.galleryCardSizeSmall'],
  ['medium', 'tools.database.galleryCardSizeMedium'],
  ['large', 'tools.database.galleryCardSizeLarge'],
];

const PREVIEWS: Array<[CardPreview, string]> = [
  ['none', 'tools.database.galleryCardPreviewNone'],
  ['cover', 'tools.database.galleryCardPreviewCover'],
  ['content', 'tools.database.galleryCardPreviewContent'],
];

/** Card size, Card preview and Fit image (H-galleries). A url property stands in for Files & media until that type exists. */
export const galleryLayoutItems = (
  view: DatabaseViewConfig,
  schema: PropertyDefinition[],
  i18n: T,
  update: (changes: ViewChanges) => void
): PopoverItemParams[] => {
  const size = resolveCardSize(view);
  const preview = resolveCardPreview(view, schema);
  const previewKey = preview.kind === 'property' ? `property:${preview.propertyId}` : preview.kind;
  const imageProperties = schema.filter((p) => p.type === 'url');
  const fit = resolveFitImage(view);

  return [
    {
      type: PopoverItemType.Default,
      title: i18n.t('tools.database.galleryCardSize'),
      children: {
        items: CARD_SIZES.map(([value, key]) => choice(i18n.t(key), size === value, () => update({ cardSize: value }))),
      },
    },
    {
      type: PopoverItemType.Default,
      title: i18n.t('tools.database.galleryCardPreview'),
      children: {
        items: [
          ...PREVIEWS.map(([value, key]) => choice(i18n.t(key), previewKey === value, () => update({ cardPreview: value }))),
          ...imageProperties.map((p) => {
            const value: CardPreview = `property:${p.id}`;

            return choice(p.name, previewKey === value, () => update({ cardPreview: value }));
          }),
        ],
      },
    },
    choice(i18n.t('tools.database.galleryFitImage'), fit, () => update({ fitImage: !fit })),
  ];
};

/** Show calendar by, Show calendar as and Show weekends (H-calendars). */
export const calendarLayoutItems = (
  view: DatabaseViewConfig,
  schema: PropertyDefinition[],
  i18n: T,
  update: (changes: ViewChanges) => void
): PopoverItemParams[] => {
  const by = resolveCalendarBy(view, schema);
  const range = resolveCalendarRange(view);
  const weekends = resolveShowWeekends(view);
  const dates = [...schema].sort((a, b) => (a.position < b.position ? -1 : 1)).filter((p) => p.type === 'date');

  return [
    {
      type: PopoverItemType.Default,
      title: i18n.t('tools.database.calendarShowBy'),
      children: {
        items: dates.map((p) => choice(p.name, by === p.id, () => update({ calendarBy: p.id }))),
      },
    },
    {
      type: PopoverItemType.Default,
      title: i18n.t('tools.database.calendarShowAs'),
      children: {
        items: [
          choice(i18n.t('tools.database.calendarMonth'), range === 'month', () => update({ calendarRange: 'month' })),
          choice(i18n.t('tools.database.calendarWeek'), range === 'week', () => update({ calendarRange: 'week' })),
        ],
      },
    },
    choice(i18n.t('tools.database.calendarShowWeekends'), weekends, () => update({ showWeekends: !weekends })),
  ];
};
