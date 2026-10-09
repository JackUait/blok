import type { I18n } from '../../../types';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import type { ViewChanges } from './database-model';
import type { CardPreview, CardSize, DatabaseViewConfig, PropertyDefinition } from './types';
import {
  resolveBoardCardPreview,
  resolveShowTimelineTable,
  resolveTimelineBy,
  resolveTimelineEndBy,
  resolveTimelineTableProperties,
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

const choice = (name: string, title: string, isActive: boolean, onActivate: () => void): PopoverItemParams => ({
  type: PopoverItemType.Default,
  name,
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

const cardLayoutItems = (
  view: DatabaseViewConfig,
  schema: PropertyDefinition[],
  i18n: T,
  update: (changes: ViewChanges) => void,
  preview: ReturnType<typeof resolveCardPreview>
): PopoverItemParams[] => {
  const size = resolveCardSize(view);
  const previewKey = preview.kind === 'property' ? `property:${preview.propertyId}` : preview.kind;
  const imageProperties = schema.filter((p) => p.type === 'url' || p.type === 'files');
  const fit = resolveFitImage(view);

  return [
    {
      type: PopoverItemType.Default,
      name: 'gallery-card-size',
      title: i18n.t('tools.database.galleryCardSize'),
      children: {
        items: CARD_SIZES.map(([value, key]) => choice(`gallery-card-size-${value}`, i18n.t(key), size === value, () => update({ cardSize: value }))),
      },
    },
    {
      type: PopoverItemType.Default,
      name: 'gallery-card-preview',
      title: i18n.t('tools.database.galleryCardPreview'),
      children: {
        items: [
          ...PREVIEWS.map(([value, key]) => choice(`gallery-card-preview-${value}`, i18n.t(key), previewKey === value, () => update({ cardPreview: value }))),
          ...imageProperties.map((p) => {
            const value: CardPreview = `property:${p.id}`;

            return choice(`gallery-card-preview-${p.id}`, p.name, previewKey === value, () => update({ cardPreview: value }));
          }),
        ],
      },
    },
    choice('gallery-fit-image', i18n.t('tools.database.galleryFitImage'), fit, () => update({ fitImage: !fit })),
  ];
};

/** Card size, Card preview and Fit image (H-galleries). Files & media properties, and url properties holding an image link, can be the preview. */
export const galleryLayoutItems = (
  view: DatabaseViewConfig,
  schema: PropertyDefinition[],
  i18n: T,
  update: (changes: ViewChanges) => void
): PopoverItemParams[] => cardLayoutItems(view, schema, i18n, update, resolveCardPreview(view, schema));

/** The same card rows on a board (H-boards); a board shows no preview until one is picked. */
export const boardLayoutItems = (
  view: DatabaseViewConfig,
  schema: PropertyDefinition[],
  i18n: T,
  update: (changes: ViewChanges) => void
): PopoverItemParams[] => cardLayoutItems(view, schema, i18n, update, resolveBoardCardPreview(view, schema));

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
      name: 'calendar-show-by',
      title: i18n.t('tools.database.calendarShowBy'),
      children: {
        items: dates.map((p) => choice(`calendar-show-by-${p.id}`, p.name, by === p.id, () => update({ calendarBy: p.id }))),
      },
    },
    {
      type: PopoverItemType.Default,
      name: 'calendar-show-as',
      title: i18n.t('tools.database.calendarShowAs'),
      children: {
        items: [
          choice('calendar-range-month', i18n.t('tools.database.calendarMonth'), range === 'month', () => update({ calendarRange: 'month' })),
          choice('calendar-range-week', i18n.t('tools.database.calendarWeek'), range === 'week', () => update({ calendarRange: 'week' })),
        ],
      },
    },
    choice('calendar-show-weekends', i18n.t('tools.database.calendarShowWeekends'), weekends, () => update({ showWeekends: !weekends })),
  ];
};

/** Show timeline by, a separate end date, Show table and the table's own columns (H-timelines). */
export const timelineLayoutItems = (
  view: DatabaseViewConfig,
  schema: PropertyDefinition[],
  i18n: T,
  update: (changes: ViewChanges) => void
): PopoverItemParams[] => {
  const ordered = [...schema].sort((a, b) => (a.position < b.position ? -1 : 1));
  const dates = ordered.filter((p) => p.type === 'date');
  const by = resolveTimelineBy(view, schema);
  const endBy = resolveTimelineEndBy(view, schema);
  const tableShown = resolveShowTimelineTable(view);
  const columns = resolveTimelineTableProperties(view, schema);
  const stored = Array.isArray(view.tableProperties) ? view.tableProperties : [];
  const toggleColumn = (id: string, visible: boolean): void => {
    const exists = stored.some((entry) => entry.id === id);

    update({
      tableProperties: exists
        ? stored.map((entry) => (entry.id === id ? { ...entry, visible } : { ...entry }))
        : [...stored.map((entry) => ({ ...entry })), { id, visible }],
    });
  };

  return [
    {
      type: PopoverItemType.Default,
      name: 'timeline-show-by',
      title: i18n.t('tools.database.timelineShowBy'),
      children: { items: dates.map((p) => choice(`timeline-show-by-${p.id}`, p.name, by === p.id, () => update({ timelineBy: p.id }))) },
    },
    {
      type: PopoverItemType.Default,
      name: 'timeline-end-by',
      title: i18n.t('tools.database.timelineEndBy'),
      children: {
        items: [
          choice('timeline-end-by-none', i18n.t('tools.database.timelineEndNone'), endBy === undefined, () => update({ timelineEndBy: '' })),
          ...dates.filter((p) => p.id !== by).map((p) => choice(`timeline-end-by-${p.id}`, p.name, endBy === p.id, () => update({ timelineEndBy: p.id }))),
        ],
      },
    },
    choice('timeline-show-table', i18n.t('tools.database.timelineShowTable'), tableShown, () => update({ showTimelineTable: !tableShown })),
    {
      type: PopoverItemType.Default,
      name: 'timeline-table-properties',
      title: i18n.t('tools.database.timelineTableProperties'),
      children: {
        items: ordered
          .filter((p) => p.type !== 'title')
          .map((p) => {
            const visible = columns.find((c) => c.id === p.id)?.visible === true;

            return choice(`timeline-table-property-${p.id}`, p.name, visible, () => toggleColumn(p.id, !visible));
          }),
      },
    },
  ];
};
