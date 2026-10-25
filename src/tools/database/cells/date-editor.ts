import { IconCheck, IconChevronLeft, IconChevronRight } from '../../../components/icons';
import { getElementDirection, logicalArrow } from '../../../components/utils/direction';
import { promoteToTopLayer, removeFromTopLayer } from '../../../components/utils/top-layer';
import { helpLink } from '../database-help-link';
import { reminderFits, reminderLabel, remindersFor } from '../reminders';
import type { DateDisplay, DateReminderOffset, PropertyDefinition, PropertyValue } from '../types';
import { CellPopover } from './cell-popover';
import {
  DATE_FORMATS,
  HOUR_CYCLES,
  TIME_FORMATS,
  applyDateDisplayChange,
  formatDatePart,
  formatDayField,
  parseDayField,
  resolveHourCycle,
  resolveLocale,
  resolveWeekStart,
  timeZones,
  toIsoDay,
  toIsoTime,
  toLocalDate,
  zoneCity,
  zoneOffsetText,
} from './date-format';
import type { DateDisplayChange } from './date-format';
import { formatDateValue, parseDateValue } from './date-value';
import type { CellEditorContext, CellEditorHandle } from './types';

/** Time a date on another day than today takes when "Include time" turns on (research/27 §4b). */
const DEFAULT_TIME = '09:00';

/**
 * The next whole hour, for today or an empty cell (research/27 §4b). On the hour and past 23:00 are
 * unmeasured: it still moves one hour, and past 23:00 wraps to 00:00 and leaves the day alone.
 */
const nextWholeHour = (): string => `${String((new Date().getHours() + 1) % 24).padStart(2, '0')}:00`;

const DAYS_SHOWN = 42;

const addDays = (iso: string, days: number): string => {
  const date = toLocalDate(iso);

  return toIsoDay(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
};

/** A typed time, 24-hour ("17:45") or 12-hour ("5:45 pm"), as `HH:mm`. */
const parseTypedTime = (text: string): string | null => {
  const match = /^(\d{1,2}):(\d{2})\s*([ap])?\.?\s*m?\.?$/i.exec(text.trim());

  if (match === null) {
    return null;
  }
  const [, h, m, meridiem] = match;
  const minutes = Number(m);
  const rawHours = Number(h);

  if (minutes > 59) {
    return null;
  }
  if (meridiem === undefined) {
    return rawHours <= 23 ? `${String(rawHours).padStart(2, '0')}:${m}` : null;
  }
  if (rawHours < 1 || rawHours > 12) {
    return null;
  }
  const hours = (rawHours % 12) + (meridiem.toLowerCase() === 'p' ? 12 : 0);

  return `${String(hours).padStart(2, '0')}:${m}`;
};

/** Built by hand, not by Intl: ICU versions disagree on the space before AM/PM. */
const formatTime = (time: string, hourCycle: 'h12' | 'h23'): string => {
  if (hourCycle === 'h23') {
    return time;
  }
  const [h, m] = time.split(':').map(Number);

  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

interface Part {
  day: string;
  time: string | null;
}

const toPart = (stored: string): Part => {
  const date = toLocalDate(stored);

  return { day: toIsoDay(date), time: stored.includes('T') ? toIsoTime(date) : null };
};

const createSwitch = (attribute: string, label: string, checked: boolean, onToggle: () => void): HTMLButtonElement => {
  const button = document.createElement('button');
  const track = document.createElement('span');

  button.type = 'button';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', String(checked));
  button.setAttribute(attribute, '');
  track.setAttribute('data-blok-database-switch-track', '');
  track.appendChild(document.createElement('span'));
  button.append(label, track);
  button.addEventListener('click', onToggle);

  return button;
};

const zoneMenus = { count: 0 };

interface ZoneEntry {
  id: string;
  city: string;
  offset: string;
  /** Lower-case city, zone id and offset: what the search matches. */
  search: string;
  /** Lower-case city and zone id: a near match looks for its letters here, not in "GMT". */
  name: string;
}

/** Fewest letters that differ between `query` and a same-length run of `text`. */
const closestRun = (query: string, text: string): number => {
  const runs = Math.max(text.length - query.length + 1, 0);

  return Array.from({ length: runs }, (_, at) => [...query].filter((letter, i) => letter !== text[at + i]).length)
    .reduce((best, misses) => Math.min(best, misses), query.length);
};

/**
 * 0 exact, 1 one letter off in the city, 2 every letter somewhere, else null.
 * Fitted to one Notion sample (research/23 §1: "tok" → Vostok, Tokyo,
 * Vladivostok, Khartoum, Atikokan…; "zzqx" → nothing), not a known rule.
 */
const zoneRank = (query: string, entry: ZoneEntry): number | null => {
  if (entry.search.includes(query)) {
    return 0;
  }
  // Near matches on one or two letters would list almost every zone.
  if (query.length < 3 || ![...query].every((letter) => entry.name.includes(letter))) {
    return null;
  }

  return closestRun(query, entry.city.toLocaleLowerCase()) <= 1 ? 1 : 2;
};

/** The stored zone's row: its own name when listed (Asmara and Asmera are two rows), else the name the engine resolves it to. */
const listedZone = (zone: string | undefined, listed: readonly string[]): string | undefined => {
  if (zone === undefined || listed.includes(zone)) {
    return zone;
  }
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return zone;
  }
};

const zoneEntry = (id: string, zone: string, at: Date): ZoneEntry => {
  const city = zoneCity(zone);
  const offset = zoneOffsetText(zone, at);

  const name = `${city} ${zone}`.toLocaleLowerCase();

  return { id, city, offset, name, search: `${name} ${offset.toLocaleLowerCase()}` };
};

/** Gap between the picker and its submenus. */
const MENU_GAP = 4;
/**
 * research/35 §20: the time zone menu overlaps the picker's edge by 4px and
 * sits 12px above the window bottom. Where it goes for a trigger above that
 * line was not measured: it stays level with the row.
 */
const ZONE_MENU_PLACE = { gap: -4, bottom: 12 };

type MenuKind = 'remind' | 'dateFormat' | 'timeFormat' | 'timeZone';

interface MenuChoice {
  id: string;
  label: string;
  checked: boolean;
  pick: () => void;
}

/**
 * Date picker: a typed field, a month grid, End date (range), Date format,
 * Include time (then Time format and Time zone), Remind and Clear. Every change commits at once; Escape saves the typed
 * date and closes; an outside press just closes.
 */
class DateEditor {
  private start: Part | null;
  private end: Part | null;
  private rangeOn: boolean;
  private timeOn: boolean;
  // Set when Include time turns on; a part with no time of its own shows and saves it.
  private defaultTime = DEFAULT_TIME;
  private rangeTarget: 'start' | 'end' = 'start';
  private viewYear: number;
  private viewMonth: number;
  private focusedDay: string;
  /** undefined: nothing written yet in a bulk edit, so any value writes. */
  private lastValue: string | null | undefined;
  /** The Remind row's choice. On an empty cell it can wait for the first date. */
  private remind: DateReminderOffset | null;
  private storedRemind: DateReminderOffset | null;
  /** The Remind menu was used: the choice is the user's, not the default. */
  private remindPicked = false;
  private menu: { element: HTMLElement; kind: MenuKind } | null = null;
  /** Applies the date fields' typed text that no Enter or change applied yet. */
  private readonly pendingTyped: Partial<Record<'start' | 'end', () => void>> = {};
  /** The property's date settings, kept here so a pick shows at once. */
  private display: DateDisplay;
  private open = true;
  private readonly locale: string;
  private readonly weekStart: number;
  private readonly hostHourCycle: 'h12' | 'h23';
  private readonly root = document.createElement('div');
  private readonly popover: CellPopover;
  private readonly anchor: HTMLElement;

  constructor(property: PropertyDefinition, value: PropertyValue | undefined, anchor: HTMLElement, private readonly ctx: CellEditorContext) {
    this.anchor = anchor;
    this.locale = resolveLocale(ctx.locale);
    this.weekStart = ctx.weekStart ?? resolveWeekStart(this.locale);
    this.hostHourCycle = ctx.hourCycle ?? resolveHourCycle(this.locale);
    this.display = { ...property.date };

    const parsed = parseDateValue(value);

    this.start = parsed === null ? null : toPart(parsed.start);
    this.end = parsed?.end === undefined ? null : toPart(parsed.end);
    this.rangeOn = this.end !== null;
    this.timeOn = parsed?.hasTime ?? false;
    this.lastValue = ctx.bulk === true ? undefined : this.serialize();
    this.storedRemind = ctx.reminder ?? null;
    // The property default fills only an empty cell: existing dates keep their own reminder.
    // A bulk edit gives it to every row without one, dated or not.
    this.remind = this.storedRemind ?? (parsed === null || ctx.bulk === true ? property.date?.defaultReminder ?? null : null);

    const shown = toLocalDate(this.start?.day ?? toIsoDay(new Date()));

    this.viewYear = shown.getFullYear();
    this.viewMonth = shown.getMonth();
    this.focusedDay = toIsoDay(shown);

    this.root.setAttribute('data-blok-database-date-editor', '');
    this.root.setAttribute('aria-label', property.name);
    this.popover = new CellPopover({
      anchor,
      cover: this.ctx.coverCell,
      content: this.root,
      // research/22 §4: Notion's picker is 248 wide.
      minWidth: '248px',
      onEscape: () => {
        if (this.menu !== null) {
          this.closeMenu(true);
        } else {
          // research/31 §4b, research/35 §3: Escape saves the typed date.
          Object.values(this.pendingTyped).forEach((apply) => apply());
          this.finish(true);
        }
      },
      onDismiss: () => this.finish(false),
    });
    this.render();
    this.popover.show();
    this.root.querySelector<HTMLInputElement>('[data-blok-database-date-input="start"]')?.focus();
  }

  get isOpen(): boolean {
    return this.open;
  }

  finish(closePopover: boolean): void {
    if (!this.open) {
      return;
    }
    this.open = false;
    this.closeMenu(false);
    if (closePopover) {
      this.popover.close();
    }
    this.ctx.onClose?.();
  }

  private t(key: string): string {
    return this.ctx.i18n.t(key);
  }

  /** The property's time format wins over the host's clock. */
  private get hourCycle(): 'h12' | 'h23' {
    return HOUR_CYCLES[this.display.timeFormat ?? ''] ?? this.hostHourCycle;
  }

  private serialize(): string | null {
    if (this.start === null) {
      return null;
    }
    const text = (part: Part): string => (this.timeOn ? `${part.day}T${part.time ?? this.defaultTime}` : part.day);

    return formatDateValue({
      start: text(this.start),
      ...(this.rangeOn ? { end: text(this.end ?? this.start) } : {}),
    });
  }

  /** `clear`: only Clear may write an empty value before a bulk edit has written anything. */
  private commit(clear = false): void {
    const next = this.serialize();

    // A bulk picker on an empty first row would clear every selected row.
    if (next === null && this.lastValue === undefined && !clear) {
      return;
    }
    this.commitRemind(next);
    if (next !== this.lastValue) {
      this.lastValue = next;
      this.ctx.onCommit(next);
    }
  }

  /** Stores the reminder a value change brings: the default on a first date, none on Clear or a list change. */
  private commitRemind(next: string | null): void {
    if (this.ctx.onReminderChange === undefined) {
      return;
    }
    if (this.remind !== null && !reminderFits(this.remind, this.timeOn)) {
      this.remind = null;
    }
    // A cleared date's reminder is the host's to drop, in the same write as the value.
    if (next === null) {
      this.storedRemind = null;

      return;
    }
    if (this.remind !== this.storedRemind) {
      this.storedRemind = this.remind;
      this.ctx.onReminderChange(this.remind, this.remindPicked);
    }
  }

  private pickRemind(choice: DateReminderOffset | null): void {
    this.remind = choice;
    this.remindPicked = true;
    this.closeMenu(false);
    // A bulk pick waits for the first date write, as on an empty cell: rows may have no date.
    if (this.start !== null && this.lastValue !== undefined && choice !== this.storedRemind) {
      this.storedRemind = choice;
      this.ctx.onReminderChange?.(choice, true);
    }
    this.render();
    this.root.querySelector<HTMLElement>('[data-blok-database-date-remind]')?.focus();
  }

  private remindLabel(choice: DateReminderOffset | null, withTime: boolean): string {
    return reminderLabel((key, vars) => this.ctx.i18n.t(key, vars), choice, withTime, this.hourCycle);
  }

  private showDay(day: string): void {
    const date = toLocalDate(day);

    this.viewYear = date.getFullYear();
    this.viewMonth = date.getMonth();
    this.focusedDay = day;
  }

  /** `time` replaces the picked part's time ("Now"); without it the part keeps its own. */
  private pickDay(day: string, time?: string): void {
    if (this.rangeOn && this.rangeTarget === 'end' && this.start !== null && day >= this.start.day) {
      this.end = { day, time: time ?? this.end?.time ?? null };
      this.rangeTarget = 'start';
    } else {
      this.start = { day, time: time ?? this.start?.time ?? null };
      if (this.end !== null && this.end.day < day) {
        this.end = { day, time: this.end.time };
      }
      this.rangeTarget = 'end';
    }
    this.showDay(day);
    this.commit();
    this.render();
  }

  // ─── Rendering ───

  private render(): void {
    delete this.pendingTyped.start;
    delete this.pendingTyped.end;
    const focusedDay = this.root.contains(document.activeElement)
      ? document.activeElement?.getAttribute('data-blok-database-date-day')
      : null;

    this.root.replaceChildren(this.renderFields(), this.renderHeader(), this.renderGrid(), this.renderOptions());
    if (focusedDay !== null && focusedDay !== undefined) {
      this.dayButton(this.focusedDay)?.focus();
    }
  }

  private renderFields(): HTMLElement {
    const fields = document.createElement('div');

    fields.setAttribute('data-blok-database-date-fields', '');
    fields.appendChild(this.renderField('start'));
    if (this.rangeOn) {
      fields.appendChild(this.renderField('end'));
    }

    return fields;
  }

  private renderField(which: 'start' | 'end'): HTMLElement {
    const part = which === 'start' ? this.start : this.end ?? this.start;
    const row = document.createElement('div');
    const input = document.createElement('input');

    row.setAttribute('data-blok-database-date-field', which);
    input.type = 'text';
    input.setAttribute('data-blok-database-date-input', which);
    input.setAttribute('aria-label', this.t(which === 'start' ? 'tools.database.dateStart' : 'tools.database.dateEnd'));
    // research/31 §4b, research/35 §3: an empty picker shows today, as a hint only.
    const hint = part === null && which === 'start' ? formatDayField(toIsoDay(new Date()), this.locale, this.display) : '';
    const shown = part === null ? hint : formatDayField(part.day, this.locale, this.display);

    input.value = shown;
    const apply = (): void => {
      // The shown text always reads back as its own day, in any locale.
      const day = part !== null && input.value.trim() === shown
        ? part.day
        : parseDayField(input.value, this.locale, this.display, toLocalDate(part?.day ?? toIsoDay(new Date())).getFullYear());

      if (day === null) {
        input.setAttribute('aria-invalid', 'true');

        return;
      }
      if (which === 'start' || this.start === null) {
        this.start = { day, time: this.start?.time ?? null };
      } else {
        this.end = { day, time: this.end?.time ?? null };
      }
      if (this.end !== null && this.start !== null && this.end.day < this.start.day) {
        [this.start, this.end] = [this.end, this.start];
      }
      this.showDay(day);
      this.commit();
      this.render();
    };

    // research/35 §3: a day click sets the part whose field was focused last.
    input.addEventListener('focus', () => {
      this.rangeTarget = which;
    });
    input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        apply();
      }
    });
    input.addEventListener('change', () => {
      if (input.value.trim() !== '') {
        apply();
      }
    });
    this.pendingTyped[which] = () => {
      if (input.value.trim() !== '' && input.value.trim() !== shown.trim()) apply();
    };
    row.appendChild(input);

    if (this.timeOn && part !== null) {
      row.appendChild(this.renderTime(which, part));
    }

    return row;
  }

  private renderTime(which: 'start' | 'end', part: Part): HTMLInputElement {
    const input = document.createElement('input');

    input.type = 'text';
    input.inputMode = 'numeric';
    input.setAttribute('data-blok-database-date-time', which);
    input.setAttribute('aria-label', this.t('tools.database.dateTime'));
    input.value = formatTime(part.time ?? this.defaultTime, this.hourCycle);
    const apply = (): void => {
      const time = parseTypedTime(input.value);

      if (time === null) {
        input.setAttribute('aria-invalid', 'true');

        return;
      }
      if (which === 'start' && this.start !== null) {
        this.start = { ...this.start, time };
      } else if (this.start !== null) {
        this.end = { ...(this.end ?? this.start), time };
      }
      this.commit();
      this.render();
    };

    input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        apply();
      }
    });
    input.addEventListener('change', apply);

    return input;
  }

  private renderHeader(): HTMLElement {
    const header = document.createElement('div');
    const label = document.createElement('span');
    const today = document.createElement('button');

    header.setAttribute('data-blok-database-date-header', '');
    label.setAttribute('data-blok-database-date-month', '');
    label.setAttribute('aria-live', 'polite');
    label.textContent = new Intl.DateTimeFormat(this.locale, { month: 'long', year: 'numeric' })
      .format(new Date(this.viewYear, this.viewMonth, 1));

    today.type = 'button';
    today.setAttribute('data-blok-database-date-today', '');
    // research/23 §1: with a time it reads "Now" and sets the time too.
    today.textContent = this.t(this.timeOn ? 'tools.database.dateNow' : 'tools.database.dateToday');
    today.addEventListener('click', () => {
      const now = new Date();

      this.pickDay(toIsoDay(now), this.timeOn ? toIsoTime(now) : undefined);
    });

    header.append(
      label,
      today,
      this.monthStepButton('data-blok-database-date-prev', IconChevronLeft, 'tools.database.datePreviousMonth', -1),
      this.monthStepButton('data-blok-database-date-next', IconChevronRight, 'tools.database.dateNextMonth', 1)
    );

    return header;
  }

  private monthStepButton(attribute: string, icon: string, labelKey: string, months: number): HTMLButtonElement {
    const button = document.createElement('button');

    button.type = 'button';
    button.setAttribute(attribute, '');
    button.setAttribute('aria-label', this.t(labelKey));
    button.innerHTML = icon;
    button.addEventListener('click', () => {
      const first = new Date(this.viewYear, this.viewMonth + months, 1);

      this.viewYear = first.getFullYear();
      this.viewMonth = first.getMonth();
      this.focusedDay = toIsoDay(first);
      this.render();
    });

    return button;
  }

  private renderGrid(): HTMLElement {
    const grid = document.createElement('div');
    const weekdayRow = document.createElement('div');
    const weekdayName = new Intl.DateTimeFormat(this.locale, { weekday: 'short' });

    grid.setAttribute('role', 'grid');
    grid.setAttribute('data-blok-database-date-grid', '');
    weekdayRow.setAttribute('role', 'row');
    weekdayRow.append(...Array.from({ length: 7 }, (_, i) => {
      const dow = (this.weekStart + i) % 7;
      const cell = document.createElement('span');

      cell.setAttribute('role', 'columnheader');
      cell.setAttribute('data-blok-database-date-weekday', '');
      cell.setAttribute('data-day', String(dow));
      // 1 January 2023 was a Sunday.
      cell.textContent = weekdayName.format(new Date(2023, 0, 1 + dow));

      return cell;
    }));
    grid.appendChild(weekdayRow);

    const first = new Date(this.viewYear, this.viewMonth, 1);
    const lead = (first.getDay() - this.weekStart + 7) % 7;
    const firstShown = addDays(toIsoDay(first), -lead);

    grid.append(...Array.from({ length: DAYS_SHOWN / 7 }, (_, week) => {
      const row = document.createElement('div');

      row.setAttribute('role', 'row');
      row.append(...Array.from({ length: 7 }, (__, d) => this.renderDay(addDays(firstShown, week * 7 + d))));

      return row;
    }));
    grid.addEventListener('keydown', this.handleGridKey);

    return grid;
  }

  private renderDay(iso: string): HTMLButtonElement {
    const date = toLocalDate(iso);
    const button = document.createElement('button');
    const rangeEnd = this.rangeOn ? (this.end ?? this.start)?.day : undefined;
    const selected = iso === this.start?.day || (rangeEnd !== undefined && iso === rangeEnd);

    button.type = 'button';
    button.setAttribute('role', 'gridcell');
    button.setAttribute('data-blok-database-date-day', iso);
    button.setAttribute('aria-selected', String(selected));
    button.setAttribute('aria-label', formatDatePart(iso, this.locale));
    button.tabIndex = iso === this.focusedDay ? 0 : -1;
    button.textContent = String(date.getDate());
    if (date.getMonth() !== this.viewMonth) {
      button.setAttribute('data-outside', '');
    }
    if (iso === toIsoDay(new Date())) {
      button.setAttribute('data-today', '');
    }
    if (rangeEnd !== undefined && this.start !== null && iso > this.start.day && iso < rangeEnd) {
      button.setAttribute('data-in-range', '');
    }
    button.addEventListener('click', () => this.pickDay(iso));

    return button;
  }

  private renderOptions(): HTMLElement {
    const options = document.createElement('div');
    const clear = document.createElement('button');

    options.setAttribute('data-blok-database-date-options', '');
    options.appendChild(createSwitch('data-blok-database-date-end-toggle', this.t('tools.database.dateEndDate'), this.rangeOn, () => {
      this.rangeOn = !this.rangeOn;
      if (this.rangeOn) {
        // research/30 B2: an empty cell gets today → today at once. A bulk picker writes nothing: Notion's
        // replaced every row's own date (research/35 §3), which loses data.
        if (this.ctx.bulk !== true) this.start ??= { day: toIsoDay(new Date()), time: null };
        this.end = this.start === null ? null : { ...this.start };
        this.rangeTarget = 'end';
      } else {
        this.end = null;
        this.rangeTarget = 'start';
      }
      this.commit();
      this.render();
    }));
    if (this.ctx.onDateDisplayChange !== undefined) {
      options.appendChild(this.renderDateFormatRow());
    }
    options.appendChild(createSwitch('data-blok-database-date-time-toggle', this.t('tools.database.dateIncludeTime'), this.timeOn, () => {
      this.timeOn = !this.timeOn;
      if (this.timeOn) {
        const today = toIsoDay(new Date());

        this.defaultTime = (this.start?.day ?? today) === today ? nextWholeHour() : DEFAULT_TIME;
        // research/27 §4b (a): an empty cell gets today at once, in this one write.
        this.start ??= { day: today, time: null };
      } else {
        this.start = this.start === null ? null : { ...this.start, time: null };
        this.end = this.end === null ? null : { ...this.end, time: null };
      }
      this.commit();
      this.render();
    }));
    if (this.ctx.onDateDisplayChange !== undefined && this.timeOn) {
      options.append(this.renderTimeFormatRow(), this.renderTimeZoneRow());
    }

    if (this.ctx.onReminderChange !== undefined) {
      options.appendChild(this.renderRemindRow());
    }

    clear.type = 'button';
    clear.setAttribute('data-blok-database-date-clear', '');
    clear.textContent = this.t('tools.database.dateClear');
    clear.addEventListener('click', () => {
      this.start = null;
      this.end = null;
      this.commit(true);
      this.finish(true);
    });
    options.appendChild(clear);
    // research/23 §1: only a picker with reminders links to their help.
    const help = this.ctx.onReminderChange === undefined
      ? null
      : helpLink(this.ctx.helpLinks?.reminders, this.t('tools.database.dateRemindersHelp'), 'data-blok-database-date-help');

    if (help !== null) {
      const footer = document.createElement('div');

      footer.setAttribute('data-blok-database-date-help-footer', '');
      footer.appendChild(help);
      options.appendChild(footer);
    }

    return options;
  }

  private renderRemindRow(): HTMLButtonElement {
    const row = document.createElement('button');
    const label = document.createElement('span');
    const value = document.createElement('span');
    const chevron = document.createElement('span');

    row.type = 'button';
    row.setAttribute('data-blok-database-date-remind', '');
    row.setAttribute('aria-haspopup', 'menu');
    row.setAttribute('aria-expanded', 'false');
    label.textContent = this.t('tools.database.dateRemind');
    value.setAttribute('data-blok-database-date-remind-value', '');
    value.textContent = this.remindLabel(this.remind, false);
    chevron.setAttribute('data-blok-database-date-remind-chevron', '');
    chevron.innerHTML = IconChevronRight;
    row.append(label, value, chevron);
    row.addEventListener('click', () => this.toggleMenu('remind', () => this.openMenu(row, 'remind', [null, ...remindersFor(this.timeOn)].map((choice) => ({
      id: choice ?? 'none',
      label: this.remindLabel(choice, true),
      checked: choice === this.remind,
      pick: () => this.pickRemind(choice),
    })))));

    return row;
  }

  // research/23 §1: the same formats, in the same order, as the property menu.
  private renderDateFormatRow(): HTMLButtonElement {
    const current = this.display.dateFormat ?? 'full';
    const label = (format: string): string => this.t(`tools.database.dateFormat.${format}`);

    return this.renderSettingRow('dateFormat', 'tools.database.dateFormat', label(current), (row) => this.openMenu(row, 'dateFormat', DATE_FORMATS.map((format) => ({
      id: format,
      label: label(format),
      checked: format === current,
      pick: () => this.pickSetting('dateFormat', { dateFormat: format }),
    }))));
  }

  private renderTimeFormatRow(): HTMLButtonElement {
    const current = this.display.timeFormat ?? (this.hostHourCycle === 'h23' ? '24_hour' : '12_hour');
    const label = (format: string): string => this.t(`tools.database.timeFormat.${format}`);

    return this.renderSettingRow('timeFormat', 'tools.database.timeFormat', label(current), (row) => this.openMenu(row, 'timeFormat', TIME_FORMATS.map((format) => ({
      id: format,
      label: label(format),
      checked: format === current,
      pick: () => this.pickSetting('timeFormat', { timeFormat: format }),
    }))));
  }

  private renderTimeZoneRow(): HTMLButtonElement {
    const current = this.display.timeZone;
    const local = this.t('tools.database.timeZoneLocal');

    return this.renderSettingRow('timeZone', 'tools.database.timeZone', current ?? local, (row) => this.openZoneMenu(row));
  }

  /** A "Label  value ›" row that opens its submenu, like Remind. */
  private renderSettingRow(kind: MenuKind, labelKey: string, valueText: string, open: (row: HTMLElement) => void): HTMLButtonElement {
    const row = document.createElement('button');
    const label = document.createElement('span');
    const value = document.createElement('span');
    const chevron = document.createElement('span');

    row.type = 'button';
    row.setAttribute('data-blok-database-date-setting', kind);
    row.setAttribute('aria-haspopup', 'menu');
    row.setAttribute('aria-expanded', 'false');
    label.textContent = this.t(labelKey);
    value.setAttribute('data-blok-database-date-setting-value', '');
    value.textContent = valueText;
    chevron.setAttribute('data-blok-database-date-remind-chevron', '');
    chevron.innerHTML = IconChevronRight;
    row.append(label, value, chevron);
    row.addEventListener('click', () => this.toggleMenu(kind, () => open(row)));

    return row;
  }

  private pickSetting(kind: MenuKind, change: DateDisplayChange): void {
    const next = applyDateDisplayChange(this.display, change);
    const changed = JSON.stringify(next) !== JSON.stringify(this.display);

    this.closeMenu(false);
    if (changed) {
      this.display = next;
      this.ctx.onDateDisplayChange?.(change);
      this.render();
    }
    this.root.querySelector<HTMLElement>(`[data-blok-database-date-setting="${kind}"]`)?.focus();
  }

  private toggleMenu(kind: MenuKind, open: () => void): void {
    const same = this.menu?.kind === kind;

    this.closeMenu(false);
    if (!same) {
      open();
    }
  }

  /**
   * A row's submenu (Remind, Date format…), beside the picker as in Notion. It
   * lives inside the editor so a press in it is not an outside press, and goes
   * to the top layer so the popover's clipping cannot cut it.
   */
  private openMenu(row: HTMLElement, kind: MenuKind, choices: MenuChoice[]): void {
    const menu = document.createElement('div');
    const remind = kind === 'remind';

    menu.setAttribute('role', 'menu');
    if (remind) {
      menu.setAttribute('data-blok-database-date-remind-menu', '');
    } else {
      menu.setAttribute('data-blok-database-date-setting-menu', kind);
    }
    menu.setAttribute('aria-label', row.firstElementChild?.textContent ?? '');
    choices.forEach((choice) => {
      const item = document.createElement('button');
      const text = document.createElement('span');

      item.type = 'button';
      item.tabIndex = -1;
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(choice.checked));
      item.setAttribute(remind ? 'data-blok-database-date-remind-option' : 'data-blok-database-date-setting-option', choice.id);
      text.textContent = choice.label;
      item.appendChild(text);
      if (choice.checked) {
        const check = document.createElement('span');

        check.setAttribute('data-blok-database-date-remind-check', '');
        check.innerHTML = IconCheck;
        item.appendChild(check);
      }
      item.addEventListener('click', choice.pick);
      menu.appendChild(item);
    });
    menu.addEventListener('keydown', this.handleMenuKey);
    this.root.appendChild(menu);
    this.menu = { element: menu, kind };
    row.setAttribute('aria-expanded', 'true');
    promoteToTopLayer(menu);
    this.placeMenu(row, menu);
    const current = menu.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu.querySelector<HTMLElement>('[role="menuitemradio"]');

    current?.setAttribute('tabindex', '0');
    current?.focus();
  }

  /**
   * The time zone menu (research/23 §1): a focused search, the current zone
   * pinned on top, then every other zone as "city / GMT offset". Focus stays in
   * the search; arrows move the active row and Enter picks it, as in the select editor.
   */
  private openZoneMenu(row: HTMLElement): void {
    const menu = document.createElement('div');
    const search = document.createElement('input');
    const list = document.createElement('div');
    const listId = `blok-date-zones-${++zoneMenus.count}`;
    const now = new Date();
    const localZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    const listed = timeZones();
    const stored = listedZone(this.display.timeZone, listed);
    const current = stored === localZone ? undefined : stored;
    const local = zoneEntry('local', localZone, now);
    const zones = listed.filter((zone) => zone !== localZone).map((zone) => zoneEntry(zone, zone, now));
    const state = { rows: [] as HTMLElement[], active: -1 };
    const pick = (id: string): void => this.pickSetting('timeZone', { timeZone: id === 'local' ? null : id });

    const setActive = (index: number): void => {
      state.active = index;
      search.removeAttribute('aria-activedescendant');
      state.rows.forEach((option, i) => {
        if (i === index) {
          option.setAttribute('data-active', '');
          search.setAttribute('aria-activedescendant', option.id);
          option.scrollIntoView?.({ block: 'nearest' });
        } else {
          option.removeAttribute('data-active');
        }
      });
    };

    const renderRows = (): void => {
      const query = search.value.trim().toLocaleLowerCase();
      const rank = (entry: ZoneEntry): number | null => query === '' ? 0 : zoneRank(query, entry);
      const heading = (key: string): HTMLElement => {
        const el = document.createElement('div');

        el.setAttribute('data-blok-database-date-zone-heading', '');
        el.setAttribute('role', 'presentation');
        el.textContent = this.t(key);

        return el;
      };
      const option = (entry: ZoneEntry): HTMLElement => {
        const el = document.createElement('div');
        const lines = document.createElement('span');
        const city = document.createElement('span');
        const offset = document.createElement('span');
        const checked = entry.id === 'local' ? current === undefined : entry.id === current;

        el.id = `${listId}-${state.rows.length}`;
        el.setAttribute('role', 'option');
        el.setAttribute('aria-selected', String(checked));
        el.setAttribute('data-blok-database-date-setting-option', entry.id);
        lines.setAttribute('data-blok-database-date-zone-lines', '');
        city.setAttribute('data-blok-database-date-zone-city', '');
        offset.setAttribute('data-blok-database-date-zone-offset', '');
        city.textContent = entry.city;
        offset.textContent = entry.offset;
        lines.append(city, offset);
        el.appendChild(lines);
        if (checked) {
          const check = document.createElement('span');

          check.setAttribute('data-blok-database-date-remind-check', '');
          check.innerHTML = IconCheck;
          el.appendChild(check);
        }
        el.addEventListener('click', () => pick(entry.id));
        state.rows.push(el);

        return el;
      };
      // Stable sort: equal ranks keep the list's order.
      const shown = zones
        .map((entry) => ({ entry, rank: rank(entry) }))
        .filter((hit): hit is { entry: ZoneEntry; rank: number } => hit.rank !== null)
        .sort((a, b) => a.rank - b.rank)
        .map((hit) => hit.entry);

      state.rows = [];
      list.replaceChildren(
        ...(rank(local) !== null ? [heading('tools.database.timeZoneCurrent'), option(local)] : []),
        heading('tools.database.timeZoneSelect'),
        ...shown.map(option)
      );
      if (shown.length === 0) {
        const empty = document.createElement('div');

        empty.setAttribute('data-blok-database-date-zone-empty', '');
        empty.textContent = this.t('find.noResults');
        list.appendChild(empty);
      }
      setActive(query === '' ? -1 : 0);
    };

    menu.setAttribute('data-blok-database-date-setting-menu', 'timeZone');
    menu.setAttribute('data-blok-database-date-zone-menu', '');
    search.type = 'text';
    search.setAttribute('data-blok-database-date-zone-search', '');
    search.setAttribute('data-blok-field', 'text');
    search.setAttribute('role', 'combobox');
    search.setAttribute('aria-expanded', 'true');
    search.setAttribute('aria-autocomplete', 'list');
    search.setAttribute('aria-controls', listId);
    search.setAttribute('aria-label', this.t('tools.database.timeZone'));
    search.placeholder = this.t('tools.database.timeZoneSearch');
    list.id = listId;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', this.t('tools.database.timeZone'));
    list.setAttribute('data-blok-database-date-zone-list', '');
    search.addEventListener('input', renderRows);
    search.addEventListener('keydown', (event) => {
      if (event.isComposing || state.rows.length === 0) {
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const from = state.active < 0 && step < 0 ? 0 : state.active;

        setActive((from + step + state.rows.length) % state.rows.length);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const id = state.rows[Math.max(state.active, 0)]?.getAttribute('data-blok-database-date-setting-option');

        if (id !== null && id !== undefined) {
          pick(id);
        }
      }
    });
    // A press on a row keeps focus in the search, so the keys keep working.
    menu.addEventListener('mousedown', (event) => {
      if (event.target !== search) {
        event.preventDefault();
      }
    });
    menu.append(search, list);
    renderRows();
    this.root.appendChild(menu);
    this.menu = { element: menu, kind: 'timeZone' };
    row.setAttribute('aria-expanded', 'true');
    promoteToTopLayer(menu);
    this.placeMenu(row, menu, ZONE_MENU_PLACE);
    search.focus();
  }

  /** Beside the picker on its end side, else its start side, else kept inside the window; level with the row, kept `place.bottom` above the window bottom. */
  private placeMenu(row: HTMLElement, menu: HTMLElement, place: { gap: number; bottom: number } = { gap: MENU_GAP, bottom: MENU_GAP }): void {
    const box = this.root.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const rtl = getElementDirection(this.anchor) === 'rtl';
    const right = box.right + place.gap;
    const left = box.left - place.gap - width;
    const sides = rtl ? [left, right] : [right, left];
    const fits = sides.find((side) => side >= 0 && side + width <= window.innerWidth);
    const x = fits ?? Math.max(0, Math.min(sides[1], window.innerWidth - width));
    const top = Math.max(0, Math.min(rowBox.top, window.innerHeight - height - place.bottom));

    Object.assign(menu.style, { position: 'fixed', left: `${x}px`, top: `${top}px` });
  }

  private closeMenu(focusRow: boolean): void {
    const open = this.menu;

    if (open === null) {
      return;
    }
    this.menu = null;
    removeFromTopLayer(open.element);
    open.element.remove();
    const row = this.root.querySelector<HTMLElement>(open.kind === 'remind'
      ? '[data-blok-database-date-remind]'
      : `[data-blok-database-date-setting="${open.kind}"]`);

    row?.setAttribute('aria-expanded', 'false');
    if (focusRow) {
      row?.focus();
    }
  }

  private readonly handleMenuKey = (event: KeyboardEvent): void => {
    const items = [...(this.menu?.element.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const index = items.findIndex((item) => item === document.activeElement);
    const steps: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };
    const step = steps[event.key];
    const edge: Record<string, number> = { Home: 0, End: items.length - 1 };
    const target = step !== undefined ? (index + step + items.length) % items.length : edge[event.key];

    if (target === undefined) {
      return;
    }
    event.preventDefault();
    items.forEach((item, i) => item.setAttribute('tabindex', i === target ? '0' : '-1'));
    items[target]?.focus();
  };

  private dayButton(day: string): HTMLButtonElement | null {
    return this.root.querySelector<HTMLButtonElement>(`[data-blok-database-date-day="${day}"]`);
  }

  private readonly handleGridKey = (event: KeyboardEvent): void => {
    const horizontal = logicalArrow(event.key, getElementDirection(this.anchor));
    const steps: Record<string, number> = { ArrowUp: -7, ArrowDown: 7, forward: 1, backward: -1 };
    const delta = steps[horizontal ?? event.key];

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.pickDay(this.focusedDay);

      return;
    }
    if (delta === undefined) {
      return;
    }
    event.preventDefault();
    const day = addDays(this.focusedDay, delta);
    const date = toLocalDate(day);

    this.focusedDay = day;
    if (date.getMonth() !== this.viewMonth || date.getFullYear() !== this.viewYear) {
      this.viewYear = date.getFullYear();
      this.viewMonth = date.getMonth();
      this.render();
    } else {
      this.root.querySelectorAll('[data-blok-database-date-day][tabindex="0"]').forEach((b) => b.setAttribute('tabindex', '-1'));
      this.dayButton(day)?.setAttribute('tabindex', '0');
    }
    this.dayButton(day)?.focus();
  };
}

export const openDateEditor = (
  property: PropertyDefinition,
  value: PropertyValue | undefined,
  anchor: HTMLElement,
  ctx: CellEditorContext
): CellEditorHandle => {
  const editor = new DateEditor(property, value, anchor, ctx);

  return {
    get isOpen() {
      return editor.isOpen;
    },
    close: () => editor.finish(true),
    cancel: () => editor.finish(true),
  };
};
