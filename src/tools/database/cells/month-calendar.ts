import { IconChevronLeft, IconChevronRight } from '../../../components/icons';
import { getElementDirection, logicalArrow } from '../../../components/utils/direction';
import { formatDatePart, pickerWeekdayNames, toIsoDay, toLocalDate } from './date-format';

const DAYS_SHOWN = 42;

const addDays = (iso: string, days: number): string => {
  const date = toLocalDate(iso);

  return toIsoDay(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
};

export interface MonthCalendarOptions {
  locale: string;
  weekStart: number;
  /** The arrow keys follow this element's writing direction. */
  directionOf: HTMLElement;
  t: (key: string) => string;
  isSelected: (day: string) => boolean;
  isInRange?: (day: string) => boolean;
  onPick: (day: string) => void;
  /** Draws the owner again: a month step or a key into another month needs a new grid. */
  redraw: () => void;
  /** The date cell's Today / Now button. The filter calendar has none (notion-motion.md Round 20 §3, r20-ct.raw). */
  today?: { label: () => string; onPick: () => void };
}

/**
 * A month grid with its header: the shown month, the day that holds focus and the arrow keys.
 * The owner keeps the value; `isSelected` and `isInRange` read it on every draw.
 */
export class MonthCalendar {
  private viewYear: number;
  private viewMonth: number;
  private focused: string;
  private lastGrid: HTMLElement | null = null;

  constructor(private readonly options: MonthCalendarOptions, shown: string) {
    const date = toLocalDate(shown);

    this.viewYear = date.getFullYear();
    this.viewMonth = date.getMonth();
    this.focused = shown;
  }

  get focusedDay(): string {
    return this.focused;
  }

  /** Turns to the day's month and gives it the focus stop. */
  show(day: string): void {
    const date = toLocalDate(day);

    this.viewYear = date.getFullYear();
    this.viewMonth = date.getMonth();
    this.focused = day;
  }

  focusDay(): void {
    this.dayButton(this.focused)?.focus();
  }

  header(): HTMLElement {
    const header = document.createElement('div');
    const label = document.createElement('span');

    header.setAttribute('data-blok-database-date-header', '');
    label.setAttribute('data-blok-database-date-month', '');
    label.setAttribute('aria-live', 'polite');
    label.textContent = new Intl.DateTimeFormat(this.options.locale, { month: 'short', year: 'numeric' })
      .format(new Date(this.viewYear, this.viewMonth, 1));
    header.appendChild(label);

    const today = this.options.today;

    if (today !== undefined) {
      const button = document.createElement('button');

      button.type = 'button';
      button.setAttribute('data-blok-database-date-today', '');
      button.textContent = today.label();
      button.addEventListener('click', () => today.onPick());
      header.appendChild(button);
    }

    header.append(
      this.monthStepButton('data-blok-database-date-prev', IconChevronLeft, 'tools.database.datePreviousMonth', -1),
      this.monthStepButton('data-blok-database-date-next', IconChevronRight, 'tools.database.dateNextMonth', 1)
    );

    return header;
  }

  grid(): HTMLElement {
    const grid = document.createElement('div');
    const weekdayRow = document.createElement('div');
    const weekdayNames = pickerWeekdayNames(this.options.locale);
    const { weekStart } = this.options;

    grid.setAttribute('role', 'grid');
    grid.setAttribute('data-blok-database-date-grid', '');
    weekdayRow.setAttribute('role', 'row');
    weekdayRow.append(...Array.from({ length: 7 }, (_, i) => {
      const dow = (weekStart + i) % 7;
      const cell = document.createElement('span');

      cell.setAttribute('role', 'columnheader');
      cell.setAttribute('data-blok-database-date-weekday', '');
      cell.setAttribute('data-day', String(dow));
      cell.textContent = weekdayNames[dow];

      return cell;
    }));
    grid.appendChild(weekdayRow);

    const first = new Date(this.viewYear, this.viewMonth, 1);
    const lead = (first.getDay() - weekStart + 7) % 7;
    const firstShown = addDays(toIsoDay(first), -lead);

    grid.append(...Array.from({ length: DAYS_SHOWN / 7 }, (_, week) => {
      const row = document.createElement('div');

      row.setAttribute('role', 'row');
      row.append(...Array.from({ length: 7 }, (__, d) => this.renderDay(addDays(firstShown, week * 7 + d))));

      return row;
    }));
    grid.addEventListener('keydown', this.handleGridKey);
    this.lastGrid = grid;

    return grid;
  }

  private monthStepButton(attribute: string, icon: string, labelKey: string, months: number): HTMLButtonElement {
    const button = document.createElement('button');

    button.type = 'button';
    button.setAttribute(attribute, '');
    button.setAttribute('aria-label', this.options.t(labelKey));
    button.innerHTML = icon;
    button.addEventListener('click', () => {
      const first = new Date(this.viewYear, this.viewMonth + months, 1);

      this.viewYear = first.getFullYear();
      this.viewMonth = first.getMonth();
      this.focused = toIsoDay(first);
      this.options.redraw();
    });

    return button;
  }

  private renderDay(iso: string): HTMLButtonElement {
    const date = toLocalDate(iso);
    const button = document.createElement('button');

    button.type = 'button';
    button.setAttribute('role', 'gridcell');
    button.setAttribute('data-blok-database-date-day', iso);
    button.setAttribute('aria-selected', String(this.options.isSelected(iso)));
    button.setAttribute('aria-label', formatDatePart(iso, this.options.locale));
    button.tabIndex = iso === this.focused ? 0 : -1;
    button.textContent = String(date.getDate());
    if (date.getMonth() !== this.viewMonth) {
      button.setAttribute('data-outside', '');
    }
    if (iso === toIsoDay(new Date())) {
      button.setAttribute('data-today', '');
    }
    if (this.options.isInRange?.(iso) === true) {
      button.setAttribute('data-in-range', '');
    }
    button.addEventListener('click', () => this.options.onPick(iso));

    return button;
  }

  private dayButton(day: string): HTMLButtonElement | null {
    return this.lastGrid?.querySelector<HTMLButtonElement>(`[data-blok-database-date-day="${day}"]`) ?? null;
  }

  private readonly handleGridKey = (event: KeyboardEvent): void => {
    const horizontal = logicalArrow(event.key, getElementDirection(this.options.directionOf));
    const steps: Record<string, number> = { ArrowUp: -7, ArrowDown: 7, forward: 1, backward: -1 };
    const delta = steps[horizontal ?? event.key];

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.options.onPick(this.focused);

      return;
    }
    if (delta === undefined) {
      return;
    }
    event.preventDefault();
    const day = addDays(this.focused, delta);
    const date = toLocalDate(day);

    this.focused = day;
    if (date.getMonth() !== this.viewMonth || date.getFullYear() !== this.viewYear) {
      this.viewYear = date.getFullYear();
      this.viewMonth = date.getMonth();
      this.options.redraw();
    } else {
      this.lastGrid?.querySelectorAll('[data-blok-database-date-day][tabindex="0"]').forEach((b) => b.setAttribute('tabindex', '-1'));
      this.dayButton(day)?.setAttribute('tabindex', '0');
    }
    this.dayButton(day)?.focus();
  };
}
