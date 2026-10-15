import { IconCheck, IconChevronLeft, IconChevronRight } from '../../../components/icons';
import { getElementDirection, logicalArrow } from '../../../components/utils/direction';
import { promoteToTopLayer, removeFromTopLayer } from '../../../components/utils/top-layer';
import { reminderFits, reminderLabel, remindersFor } from '../reminders';
import type { DateReminderOffset, PropertyDefinition, PropertyValue } from '../types';
import { CellPopover } from './cell-popover';
import { formatDatePart, resolveHourCycle, resolveLocale, resolveWeekStart, toIsoDay, toIsoTime, toLocalDate } from './date-format';
import { formatDateValue, parseDateValue } from './date-value';
import type { CellEditorContext, CellEditorHandle } from './types';

/** Time a value takes when "Include time" turns on. Notion's choice here is unverified. */
const DEFAULT_TIME = '09:00';

const DAYS_SHOWN = 42;

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const addDays = (iso: string, days: number): string => {
  const date = toLocalDate(iso);

  return toIsoDay(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
};

/** A typed day: `YYYY-MM-DD`, or any text the engine's Date.parse reads ("Oct 9, 2026"). */
const parseTypedDay = (text: string): string | null => {
  const trimmed = text.trim();
  const iso = ISO_DAY.exec(trimmed);

  if (iso !== null) {
    const day = toIsoDay(new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));

    return day === trimmed ? day : null;
  }
  const ms = Date.parse(trimmed);

  return trimmed !== '' && Number.isFinite(ms) ? toIsoDay(new Date(ms)) : null;
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

/** Gap between the picker and its Remind menu. */
const MENU_GAP = 4;

/**
 * Date picker: a typed field, a month grid, End date (range), Include time,
 * Remind and Clear. Every change commits at once; Escape and an outside press
 * just close.
 */
class DateEditor {
  private start: Part | null;
  private end: Part | null;
  private rangeOn: boolean;
  private timeOn: boolean;
  private rangeTarget: 'start' | 'end' = 'start';
  private viewYear: number;
  private viewMonth: number;
  private focusedDay: string;
  private lastValue: string | null;
  /** The Remind row's choice. On an empty cell it can wait for the first date. */
  private remind: DateReminderOffset | null;
  private storedRemind: DateReminderOffset | null;
  private remindMenu: HTMLElement | null = null;
  private open = true;
  private readonly locale: string;
  private readonly weekStart: number;
  private readonly hourCycle: 'h12' | 'h23';
  private readonly root = document.createElement('div');
  private readonly popover: CellPopover;
  private readonly anchor: HTMLElement;

  constructor(property: PropertyDefinition, value: PropertyValue | undefined, anchor: HTMLElement, private readonly ctx: CellEditorContext) {
    this.anchor = anchor;
    this.locale = resolveLocale(ctx.locale);
    this.weekStart = ctx.weekStart ?? resolveWeekStart(this.locale);
    this.hourCycle = ctx.hourCycle ?? resolveHourCycle(this.locale);

    const parsed = parseDateValue(value);

    this.start = parsed === null ? null : toPart(parsed.start);
    this.end = parsed?.end === undefined ? null : toPart(parsed.end);
    this.rangeOn = this.end !== null;
    this.timeOn = parsed?.hasTime ?? false;
    this.lastValue = this.serialize();
    this.storedRemind = ctx.reminder ?? null;
    // The property default fills only an empty cell: existing dates keep their own reminder.
    this.remind = this.storedRemind ?? (parsed === null ? property.date?.defaultReminder ?? null : null);

    const shown = toLocalDate(this.start?.day ?? toIsoDay(new Date()));

    this.viewYear = shown.getFullYear();
    this.viewMonth = shown.getMonth();
    this.focusedDay = toIsoDay(shown);

    this.root.setAttribute('data-blok-database-date-editor', '');
    this.root.setAttribute('aria-label', property.name);
    this.popover = new CellPopover({
      anchor,
      content: this.root,
      minWidth: '252px',
      onEscape: () => {
        if (this.remindMenu !== null) {
          this.closeRemindMenu(true);
        } else {
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
    this.closeRemindMenu(false);
    if (closePopover) {
      this.popover.close();
    }
    this.ctx.onClose?.();
  }

  private t(key: string): string {
    return this.ctx.i18n.t(key);
  }

  private serialize(): string | null {
    if (this.start === null) {
      return null;
    }
    const text = (part: Part): string => (this.timeOn ? `${part.day}T${part.time ?? DEFAULT_TIME}` : part.day);

    return formatDateValue({
      start: text(this.start),
      ...(this.rangeOn ? { end: text(this.end ?? this.start) } : {}),
    });
  }

  private commit(): void {
    const next = this.serialize();

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
      this.ctx.onReminderChange(this.remind);
    }
  }

  private pickRemind(choice: DateReminderOffset | null): void {
    this.remind = choice;
    this.closeRemindMenu(false);
    if (this.start !== null && choice !== this.storedRemind) {
      this.storedRemind = choice;
      this.ctx.onReminderChange?.(choice);
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

  private pickDay(day: string): void {
    if (this.rangeOn && this.rangeTarget === 'end' && this.start !== null && day >= this.start.day) {
      this.end = { day, time: this.end?.time ?? null };
      this.rangeTarget = 'start';
    } else {
      this.start = { day, time: this.start?.time ?? null };
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
    input.value = part === null ? '' : formatDatePart(part.day, this.locale);
    const apply = (): void => {
      const day = parseTypedDay(input.value);

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
    input.value = formatTime(part.time ?? DEFAULT_TIME, this.hourCycle);
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
    today.textContent = this.t('tools.database.dateToday');
    today.addEventListener('click', () => this.pickDay(toIsoDay(new Date())));

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
        this.end = this.start === null ? null : { ...this.start };
        this.rangeTarget = 'end';
      } else {
        this.end = null;
        this.rangeTarget = 'start';
      }
      this.commit();
      this.render();
    }));
    options.appendChild(createSwitch('data-blok-database-date-time-toggle', this.t('tools.database.dateIncludeTime'), this.timeOn, () => {
      this.timeOn = !this.timeOn;
      if (!this.timeOn) {
        this.start = this.start === null ? null : { ...this.start, time: null };
        this.end = this.end === null ? null : { ...this.end, time: null };
      }
      this.commit();
      this.render();
    }));

    if (this.ctx.onReminderChange !== undefined) {
      options.appendChild(this.renderRemindRow());
    }

    clear.type = 'button';
    clear.setAttribute('data-blok-database-date-clear', '');
    clear.textContent = this.t('tools.database.dateClear');
    clear.addEventListener('click', () => {
      this.start = null;
      this.end = null;
      this.commit();
      this.finish(true);
    });
    options.appendChild(clear);

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
    row.addEventListener('click', () => {
      if (this.remindMenu === null) {
        this.openRemindMenu(row);
      } else {
        this.closeRemindMenu(false);
      }
    });

    return row;
  }

  /**
   * The Remind submenu, beside the picker as in Notion. It lives inside the
   * editor so a press in it is not an outside press, and goes to the top layer
   * so the popover's clipping cannot cut it.
   */
  private openRemindMenu(row: HTMLElement): void {
    const menu = document.createElement('div');
    const choices: Array<DateReminderOffset | null> = [null, ...remindersFor(this.timeOn)];

    menu.setAttribute('role', 'menu');
    menu.setAttribute('data-blok-database-date-remind-menu', '');
    menu.setAttribute('aria-label', this.t('tools.database.dateRemind'));
    choices.forEach((choice) => {
      const item = document.createElement('button');
      const text = document.createElement('span');
      const checked = choice === this.remind;

      item.type = 'button';
      item.tabIndex = -1;
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(checked));
      item.setAttribute('data-blok-database-date-remind-option', choice ?? 'none');
      text.textContent = this.remindLabel(choice, true);
      item.appendChild(text);
      if (checked) {
        const check = document.createElement('span');

        check.setAttribute('data-blok-database-date-remind-check', '');
        check.innerHTML = IconCheck;
        item.appendChild(check);
      }
      item.addEventListener('click', () => this.pickRemind(choice));
      menu.appendChild(item);
    });
    menu.addEventListener('keydown', this.handleMenuKey);
    this.root.appendChild(menu);
    this.remindMenu = menu;
    row.setAttribute('aria-expanded', 'true');
    promoteToTopLayer(menu);
    this.placeRemindMenu(row, menu);
    const current = menu.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu.querySelector<HTMLElement>('[role="menuitemradio"]');

    current?.setAttribute('tabindex', '0');
    current?.focus();
  }

  private placeRemindMenu(row: HTMLElement, menu: HTMLElement): void {
    const box = this.root.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const rtl = getElementDirection(this.anchor) === 'rtl';
    const after = rtl ? box.left - MENU_GAP - width : box.right + MENU_GAP;
    const before = rtl ? box.right + MENU_GAP : box.left - MENU_GAP - width;
    const fits = rtl ? after >= 0 : after + width <= window.innerWidth;
    const left = fits ? after : before;
    const top = Math.max(0, Math.min(rowBox.top, window.innerHeight - height - MENU_GAP));

    Object.assign(menu.style, { position: 'fixed', left: `${Math.max(0, left)}px`, top: `${top}px` });
  }

  private closeRemindMenu(focusRow: boolean): void {
    const menu = this.remindMenu;

    if (menu === null) {
      return;
    }
    this.remindMenu = null;
    removeFromTopLayer(menu);
    menu.remove();
    const row = this.root.querySelector<HTMLElement>('[data-blok-database-date-remind]');

    row?.setAttribute('aria-expanded', 'false');
    if (focusRow) {
      row?.focus();
    }
  }

  private readonly handleMenuKey = (event: KeyboardEvent): void => {
    const items = [...(this.remindMenu?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
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
