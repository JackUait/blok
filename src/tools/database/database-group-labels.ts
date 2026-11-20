import type { I18n } from '../../../types';
import { editorLocale } from './cells/date-format';
import { NO_VALUE_GROUP_KEY, OUT_OF_RANGE_KEY, rangeOf } from './group-keys';
import type { GroupSettings, PropertyDefinition } from './types';

const RELATIVE_KEYS: Record<string, string> = {
  'rel:today': 'tools.database.groupToday',
  'rel:last_7_days': 'tools.database.groupLast7Days',
  'rel:last_30_days': 'tools.database.groupLast30Days',
  'rel:next_7_days': 'tools.database.groupNext7Days',
  'rel:next_30_days': 'tools.database.groupNext30Days',
};

const dateOf = (day: string): Date => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10) || '1'));

const format = (day: string, options: Intl.DateTimeFormatOptions, locale: string): string =>
  new Intl.DateTimeFormat(locale, options).format(dateOf(day));

/** A group key as people read it. Option groups take the option label elsewhere. */
export const groupLabel = (
  property: PropertyDefinition,
  key: string,
  i18n: Pick<I18n, 't'> & Partial<Pick<I18n, 'getLocale'>>,
  settings: GroupSettings = {}
): string => {
  if (key === NO_VALUE_GROUP_KEY) return i18n.t('tools.database.noValueGroup', { property: property.name });
  if (property.type === 'checkbox') return i18n.t(key === 'true' ? 'tools.database.filterChecked' : 'tools.database.filterUnchecked');

  const at = key.indexOf(':');
  const kind = at === -1 ? '' : key.slice(0, at);
  const rest = key.slice(at + 1);
  const locale = editorLocale(i18n);

  switch (kind) {
    case 'rel': return RELATIVE_KEYS[key] === undefined ? rest : i18n.t(RELATIVE_KEYS[key]);
    case 'day': return format(rest, { dateStyle: 'medium' }, locale);
    case 'week': return i18n.t('tools.database.groupWeekOf', { date: format(rest, { dateStyle: 'medium' }, locale) });
    // Round 84b §3: Notion reads "Oct 2026".
    case 'month': return format(rest, { month: 'short', year: 'numeric' }, locale);
    case 'year': return rest;
    case 'alpha': return rest;
    case 'range': {
      if (key === OUT_OF_RANGE_KEY) return i18n.t('tools.database.groupOutOfRange');
      // rangeOf, as the group keys use, so an invalid saved value names the groups they really are.
      const { size } = rangeOf(settings);

      return i18n.t('tools.database.groupRangeBucket', { start: rest, end: String(Number(rest) + size) });
    }
    default: return key;
  }
};
