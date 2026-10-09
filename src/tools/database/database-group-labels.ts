import type { I18n } from '../../../types';
import { NO_VALUE_GROUP_KEY } from './group-keys';
import type { GroupSettings, PropertyDefinition } from './types';

const RELATIVE_KEYS: Record<string, string> = {
  'rel:today': 'tools.database.groupToday',
  'rel:last_7_days': 'tools.database.groupLast7Days',
  'rel:last_30_days': 'tools.database.groupLast30Days',
  'rel:next_7_days': 'tools.database.groupNext7Days',
  'rel:next_30_days': 'tools.database.groupNext30Days',
};

const dateOf = (day: string): Date => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10) || '1'));

const format = (day: string, options: Intl.DateTimeFormatOptions): string =>
  new Intl.DateTimeFormat(undefined, options).format(dateOf(day));

/** A group key as people read it. Option groups take the option label elsewhere. */
export const groupLabel = (
  property: PropertyDefinition,
  key: string,
  i18n: Pick<I18n, 't'>,
  settings: GroupSettings = {}
): string => {
  if (key === NO_VALUE_GROUP_KEY) return i18n.t('tools.database.noValueGroup', { property: property.name });
  if (property.type === 'checkbox') return i18n.t(key === 'true' ? 'tools.database.filterChecked' : 'tools.database.filterUnchecked');

  const at = key.indexOf(':');
  const kind = at === -1 ? '' : key.slice(0, at);
  const rest = key.slice(at + 1);

  switch (kind) {
    case 'rel': return RELATIVE_KEYS[key] === undefined ? rest : i18n.t(RELATIVE_KEYS[key]);
    case 'day': return format(rest, { dateStyle: 'medium' });
    case 'week': return i18n.t('tools.database.groupWeekOf', { date: format(rest, { dateStyle: 'medium' }) });
    case 'month': return format(rest, { month: 'long', year: 'numeric' });
    case 'year': return rest;
    case 'alpha': return rest;
    case 'range': {
      const size = settings.rangeSize ?? 100;

      if (rest === 'below') return `< ${settings.rangeStart ?? 0}`;
      if (rest === 'above') return `≥ ${settings.rangeEnd ?? 1000}`;

      return `${rest} – ${Number(rest) + size}`;
    }
    default: return key;
  }
};
