/** A date mention stores a calendar day; its visible label is derived locally. */
export const DATE_MENTION_ATTR = 'data-blok-date-mention';

export const readDateMention = (value: string | null): Date | null => {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);

  if (year < 1000) return null;
  const date = new Date(year, month - 1, day);

  return date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day ? date : null;
};

export const localDateIso = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const dateMentionLabel = (iso: string, now: Date, locale?: string): string | null => {
  const date = readDateMention(iso);

  if (date === null) return null;
  const day = (value: Date): number => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  const difference = Math.round((day(date) - day(now)) / 86_400_000);

  if (Math.abs(difference) <= 7) {
    const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(difference, 'day');

    return relative.charAt(0).toLocaleUpperCase(locale) + relative.slice(1);
  }
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
};
