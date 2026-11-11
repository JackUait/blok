/** The public part of Blok's database date editor used by the desktop title. */
export interface DateDisplay {
  dateFormat?: 'full' | 'short' | 'month_day_year' | 'day_month_year' | 'year_month_day' | 'relative';
  timeFormat?: '12_hour' | '24_hour' | 'hidden';
  timeZone?: string;
}

export type DateDisplayChange =
  | { dateFormat: NonNullable<DateDisplay['dateFormat']> }
  | { timeFormat: NonNullable<DateDisplay['timeFormat']> }
  | { timeZone: string | null };

export interface DateEditorHandle {
  readonly isOpen: boolean;
  close(): void;
  cancel(): void;
}

export function openDateEditor(
  property: { id: string; name: string; type: 'date'; position: string; date: DateDisplay },
  value: string | null | undefined,
  anchor: HTMLElement,
  context: {
    i18n: { t(key: string): string };
    locale: string;
    readOnly: false;
    onCommit(value: unknown): void;
    onDateDisplayChange(change: DateDisplayChange): void;
    onClose(): void;
  },
): DateEditorHandle;
