import type { I18n } from '../../../types';
import type { DatabaseViewRenderer } from './database-view-renderer';
import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition } from './types';
import { renderCellValue } from './cells';
import { resolveLocale, toLocalDate } from './cells/date-format';
import {
  addDays,
  calendarWeeks,
  daysBetween,
  eventSpan,
  isWeekend,
  layoutWeek,
  moveDateValue,
  resizeDateValue,
  shiftAnchor,
  visibleDays,
} from './calendar-dates';
import type { PlacedEvent } from './calendar-dates';
import { resolveCalendarRange, resolveShowWeekends, resolveViewProperties } from './view-settings';
import { getElementDirection } from '../../components/utils/direction';
import { IconChevronLeft, IconChevronRight, IconPlus } from '../../components/icons';

export interface CalendarHandlers {
  openRow: (rowId: string) => void;
  /** Adds a row dated `day` (`YYYY-MM-DD`). */
  addRow: (day: string) => void;
  /** The row's new date value, as a stored string. */
  setDate: (rowId: string, value: string) => void;
  /** Show the range around `anchor`, then focus `focusDay` when given. */
  navigate: (anchor: string, focusDay?: string) => void;
}

export interface DatabaseCalendarViewOptions {
  readOnly: boolean;
  i18n: Pick<I18n, 't'>;
  view: DatabaseViewConfig;
  /** Localized schema. */
  schema: PropertyDefinition[];
  /** Rows after the view's filters and sorts. */
  rows: DatabaseRow[];
  titlePropertyId: string;
  /** The date property that places rows, or undefined when the database has none. */
  datePropertyId: string | undefined;
  /** Any day inside the range to show. */
  anchor: string;
  today: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekStart: number;
  handlers?: CalendarHandlers;
  locale?: string;
  /** A day to focus once drawn: keyboard navigation that crossed into a new range. */
  focusDay?: string;
}

const DRAG_THRESHOLD = 4;

type DragMode = 'move' | 'start' | 'end';

interface DragState {
  rowId: string;
  mode: DragMode;
  /** The day under the pointer at press, so a moved range keeps it under the pointer. */
  grabDay: string;
  startX: number;
  startY: number;
  active: boolean;
  overDay: string | null;
}

/**
 * Notion's calendar layout (research/03 §6): a month or a week of days, each
 * row's date placing an event card, multi-day events drawn as bars across a
 * week row.
 */
export class DatabaseCalendarView implements DatabaseViewRenderer {
  private readonly options: DatabaseCalendarViewOptions;
  private root: HTMLElement | null = null;
  private drag: DragState | null = null;
  private suppressClick = false;
  /** Days in grid order, for arrow keys. */
  private shownDays: string[] = [];
  private columns = 7;

  constructor(options: DatabaseCalendarViewOptions) {
    this.options = options;
  }

  get interacting(): boolean {
    return this.drag?.active === true;
  }

  private t(key: string, vars?: Record<string, string>): string {
    return this.options.i18n.t(key, vars);
  }

  private get range(): 'month' | 'week' {
    return resolveCalendarRange(this.options.view);
  }

  private get canEdit(): boolean {
    return !this.options.readOnly && this.options.handlers !== undefined;
  }

  createView(): HTMLDivElement {
    const root = document.createElement('div');

    root.setAttribute('data-blok-database-calendar', '');
    root.setAttribute('data-range', this.range);
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', this.t('tools.database.calendarLabel'));
    this.root = root;

    root.appendChild(this.createToolbar());

    if (this.options.datePropertyId === undefined) {
      const empty = document.createElement('div');

      empty.setAttribute('data-blok-database-calendar-empty', '');
      empty.textContent = this.t('tools.database.calendarNoDateProperty');
      root.appendChild(empty);

      return root;
    }

    root.appendChild(this.createGrid());
    root.addEventListener('click', this.onClick);
    root.addEventListener('keydown', this.onKeyDown);
    root.addEventListener('pointerdown', this.onPointerDown);

    if (this.options.focusDay !== undefined) {
      const focusDay = this.options.focusDay;

      // The tool attaches the view after createView returns.
      queueMicrotask(() => this.dayCell(focusDay)?.focus());
    }

    return root;
  }

  private createToolbar(): HTMLElement {
    const bar = document.createElement('div');

    bar.setAttribute('data-blok-database-calendar-toolbar', '');

    const title = document.createElement('div');

    title.setAttribute('data-blok-database-calendar-title', '');
    title.setAttribute('aria-live', 'polite');
    title.textContent = new Intl.DateTimeFormat(resolveLocale(this.options.locale), { month: 'long', year: 'numeric' })
      .format(toLocalDate(this.firstDayOfRange()));

    const nav = document.createElement('div');

    nav.setAttribute('data-blok-database-calendar-nav', '');
    const week = this.range === 'week';
    const button = (attr: string, label: string, icon?: string): HTMLButtonElement => {
      const el = document.createElement('button');

      el.type = 'button';
      el.setAttribute(attr, '');
      if (icon === undefined) {
        el.textContent = label;
      } else {
        el.setAttribute('aria-label', label);
        el.innerHTML = icon;
      }
      nav.appendChild(el);

      return el;
    };

    button(
      'data-blok-database-calendar-prev',
      this.t(week ? 'tools.database.calendarPreviousWeek' : 'tools.database.calendarPreviousMonth'),
      IconChevronLeft
    );
    button('data-blok-database-calendar-today', this.t('tools.database.calendarToday'));
    button(
      'data-blok-database-calendar-next',
      this.t(week ? 'tools.database.calendarNextWeek' : 'tools.database.calendarNextMonth'),
      IconChevronRight
    );
    bar.append(title, nav);

    return bar;
  }

  /** In week range the title names the week's month by its first shown day. */
  private firstDayOfRange(): string {
    return this.range === 'week'
      ? calendarWeeks({ anchor: this.options.anchor, range: 'week', weekStart: this.options.weekStart })[0][0]
      : this.options.anchor;
  }

  private createGrid(): HTMLElement {
    const showWeekends = resolveShowWeekends(this.options.view);
    const weeks = calendarWeeks({ anchor: this.options.anchor, range: this.range, weekStart: this.options.weekStart })
      .map((week) => visibleDays(week, showWeekends));
    const month = this.options.anchor.slice(0, 7);
    const grid = document.createElement('div');

    this.columns = weeks[0]?.length ?? 7;
    this.shownDays = weeks.flat();
    grid.setAttribute('data-blok-database-calendar-grid', '');
    grid.setAttribute('role', 'grid');
    grid.setAttribute('data-blok-keyboard-owner', '');
    grid.setAttribute('aria-label', this.t('tools.database.calendarLabel'));
    if (this.options.readOnly) {
      grid.setAttribute('aria-readonly', 'true');
    }
    grid.style.setProperty('--blok-database-calendar-columns', String(this.columns));

    const header = document.createElement('div');
    const weekday = new Intl.DateTimeFormat(resolveLocale(this.options.locale), { weekday: 'short' });

    header.setAttribute('data-blok-database-calendar-weekdays', '');
    header.setAttribute('role', 'row');
    for (const dayIso of weeks[0] ?? []) {
      const cell = document.createElement('div');

      cell.setAttribute('role', 'columnheader');
      cell.textContent = weekday.format(toLocalDate(dayIso));
      header.appendChild(cell);
    }
    grid.appendChild(header);

    const tabbable = this.shownDays.includes(this.options.today)
      ? this.options.today
      : this.shownDays.find((d) => d.startsWith(month)) ?? this.shownDays[0];

    for (const week of weeks) {
      grid.appendChild(this.createWeek(week, month, tabbable));
    }

    return grid;
  }

  private createWeek(week: string[], month: string, tabbable: string | undefined): HTMLElement {
    const rowEl = document.createElement('div');
    const placed = layoutWeek(week, this.events());
    const lanes = placed.reduce((max, p) => Math.max(max, p.lane + 1), 0);
    const dayNumber = new Intl.DateTimeFormat(resolveLocale(this.options.locale), { day: 'numeric' });
    const firstOfMonth = new Intl.DateTimeFormat(resolveLocale(this.options.locale), { month: 'short', day: 'numeric' });

    rowEl.setAttribute('data-blok-database-calendar-week', '');
    rowEl.setAttribute('role', 'row');
    rowEl.style.setProperty('--blok-database-calendar-lanes', String(lanes));

    week.forEach((dayIso, col) => {
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-database-calendar-day', '');
      cell.setAttribute('data-day', dayIso);
      cell.setAttribute('role', 'gridcell');
      cell.tabIndex = dayIso === tabbable ? 0 : -1;
      if (dayIso === this.options.today) {
        cell.setAttribute('data-today', '');
        cell.setAttribute('aria-current', 'date');
      }
      if (this.range === 'month' && !dayIso.startsWith(month)) {
        cell.setAttribute('data-outside', '');
      }
      if (isWeekend(dayIso)) {
        cell.setAttribute('data-weekend', '');
      }

      const number = document.createElement('div');

      number.setAttribute('data-blok-database-calendar-day-number', '');
      number.textContent = (dayIso.endsWith('-01') ? firstOfMonth : dayNumber).format(toLocalDate(dayIso));
      cell.appendChild(number);

      if (this.canEdit) {
        const add = document.createElement('button');

        add.type = 'button';
        add.tabIndex = -1;
        add.setAttribute('data-blok-database-calendar-add', '');
        add.setAttribute('aria-label', this.t('tools.database.calendarNewOnDay'));
        add.innerHTML = IconPlus;
        cell.appendChild(add);
      }

      for (const event of placed.filter((p) => p.startCol === col)) {
        cell.appendChild(this.createEvent(event));
      }
      rowEl.appendChild(cell);
    });

    return rowEl;
  }

  private events(): Array<{ id: string; start: string; end: string }> {
    const dateId = this.options.datePropertyId;

    if (dateId === undefined) {
      return [];
    }

    return this.options.rows.flatMap((row) => {
      const span = eventSpan(row.properties[dateId]);

      return span === null ? [] : [{ id: row.id, ...span }];
    });
  }

  private createEvent(placed: PlacedEvent): HTMLElement {
    const row = this.options.rows.find((r) => r.id === placed.id);
    const el = document.createElement('div');
    const title = row?.properties[this.options.titlePropertyId];

    el.setAttribute('data-blok-database-calendar-event', '');
    el.setAttribute('data-row-id', placed.id);
    el.setAttribute('role', 'button');
    el.tabIndex = -1;
    el.style.setProperty('--blok-database-calendar-span', String(placed.endCol - placed.startCol + 1));
    el.style.setProperty('--blok-database-calendar-lane', String(placed.lane));
    if (placed.continuesBefore) {
      el.setAttribute('data-continues-before', '');
    }
    if (placed.continuesAfter) {
      el.setAttribute('data-continues-after', '');
    }

    if (this.canEdit && !placed.continuesBefore) {
      el.appendChild(this.createHandle('start'));
    }

    const titleEl = document.createElement('span');

    titleEl.setAttribute('data-blok-database-calendar-event-title', '');
    titleEl.textContent = typeof title === 'string' ? title : '';
    if (titleEl.textContent === '') {
      titleEl.setAttribute('data-placeholder', this.t('tools.database.cardTitlePlaceholder'));
    }
    el.appendChild(titleEl);

    for (const property of this.visibleProperties()) {
      const cell = renderCellValue(property, row?.properties[property.id], {
        i18n: this.options.i18n,
        readOnly: true,
        locale: this.options.locale,
      });

      if (!cell.hasAttribute('data-empty')) {
        const item = document.createElement('span');

        item.setAttribute('data-blok-database-calendar-event-property', '');
        item.setAttribute('data-property-id', property.id);
        item.appendChild(cell);
        el.appendChild(item);
      }
    }

    if (this.canEdit && !placed.continuesAfter) {
      el.appendChild(this.createHandle('end'));
    }

    return el;
  }

  private visibleProperties(): PropertyDefinition[] {
    return resolveViewProperties(this.options.view, this.options.schema)
      .filter((p) => p.visible && p.id !== this.options.titlePropertyId)
      .flatMap((p) => this.options.schema.filter((property) => property.id === p.id));
  }

  private createHandle(edge: 'start' | 'end'): HTMLElement {
    const handle = document.createElement('span');

    handle.setAttribute('data-blok-database-calendar-resize', edge);
    handle.setAttribute('aria-hidden', 'true');

    return handle;
  }

  private dayCell(dayIso: string): HTMLElement | null {
    return [...(this.root?.querySelectorAll<HTMLElement>('[data-blok-database-calendar-day]') ?? [])]
      .find((cell) => cell.getAttribute('data-day') === dayIso) ?? null;
  }

  /** The row ids covering a day, in lane order. */
  private rowsOn(dayIso: string): string[] {
    return layoutWeek([dayIso], this.events()).map((placed) => placed.id);
  }

  private readonly onClick = (event: MouseEvent): void => {
    if (this.suppressClick) {
      this.suppressClick = false;

      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    const handlers = this.options.handlers;

    if (target === null || handlers === undefined) {
      return;
    }

    const step = target.closest('[data-blok-database-calendar-prev]') !== null ? -1 : 1;

    if (target.closest('[data-blok-database-calendar-prev], [data-blok-database-calendar-next]') !== null) {
      handlers.navigate(shiftAnchor(this.options.anchor, this.range, step));

      return;
    }

    if (target.closest('[data-blok-database-calendar-today]') !== null) {
      handlers.navigate(this.options.today);

      return;
    }

    const add = target.closest('[data-blok-database-calendar-add]');
    const addDay = add?.closest('[data-blok-database-calendar-day]')?.getAttribute('data-day');

    if (addDay !== null && addDay !== undefined && this.canEdit) {
      handlers.addRow(addDay);

      return;
    }

    const rowId = target.closest('[data-blok-database-calendar-event]')?.getAttribute('data-row-id');

    if (rowId !== null && rowId !== undefined) {
      handlers.openRow(rowId);
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target instanceof HTMLElement ? event.target : null;

    if (target?.hasAttribute('data-blok-database-calendar-event') === true && event.key === 'Enter') {
      event.preventDefault();
      target.click();

      return;
    }

    const dayIso = target?.hasAttribute('data-blok-database-calendar-day') === true ? target.getAttribute('data-day') : null;

    if (dayIso === null || dayIso === undefined) {
      return;
    }

    if (event.key === 'Enter') {
      const first = this.rowsOn(dayIso)[0];

      event.preventDefault();
      if (first !== undefined) {
        this.options.handlers?.openRow(first);
      }

      return;
    }

    const next = this.arrowTarget(dayIso, event.key);

    if (next === null) {
      return;
    }
    event.preventDefault();

    const cell = this.dayCell(next);

    if (cell === null) {
      this.options.handlers?.navigate(next, next);

      return;
    }

    this.root?.querySelectorAll<HTMLElement>('[data-blok-database-calendar-day]').forEach((el) => {
      el.setAttribute('tabindex', el === cell ? '0' : '-1');
    });
    cell.focus();
  };

  /** The day an arrow key goes to. Off the grid, the same step in calendar days. */
  private arrowTarget(dayIso: string, key: string): string | null {
    const rtl = getElementDirection(this.root) === 'rtl';
    const index = this.shownDays.indexOf(dayIso);
    const offsets: Record<string, number> = {
      ArrowLeft: rtl ? 1 : -1,
      ArrowRight: rtl ? -1 : 1,
      ArrowUp: -this.columns,
      ArrowDown: this.columns,
    };
    const offset = offsets[key];

    if (offset === undefined) {
      return null;
    }

    const shown = this.shownDays[index + offset];

    if (shown !== undefined) {
      return shown;
    }

    const step = Math.abs(offset) === this.columns ? 7 : 1;
    const candidate = addDays(dayIso, Math.sign(offset) * step);

    return resolveShowWeekends(this.options.view) || !isWeekend(candidate)
      ? candidate
      : addDays(candidate, Math.sign(offset) * (weekendSkip(candidate, Math.sign(offset))));
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !this.canEdit || !(event.target instanceof Element)) {
      return;
    }

    const eventEl = event.target.closest('[data-blok-database-calendar-event]');
    const rowId = eventEl?.getAttribute('data-row-id');
    const edge = event.target.closest('[data-blok-database-calendar-resize]')?.getAttribute('data-blok-database-calendar-resize');
    const grabDay = this.dayAt(event.clientX, event.clientY);

    if (rowId === null || rowId === undefined || grabDay === null) {
      return;
    }

    this.drag = {
      rowId,
      mode: edge === 'start' || edge === 'end' ? edge : 'move',
      grabDay,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      overDay: grabDay,
    };
    document.addEventListener('pointermove', this.onPointerMove);
    document.addEventListener('pointerup', this.onPointerUp);
    document.addEventListener('pointercancel', this.cancelDrag);
    document.addEventListener('keydown', this.onDragKeyDown);
  };

  private dayAt(x: number, y: number): string | null {
    for (const cell of this.root?.querySelectorAll<HTMLElement>('[data-blok-database-calendar-day]') ?? []) {
      const box = cell.getBoundingClientRect();

      if (x >= box.left && x < box.right && y >= box.top && y < box.bottom) {
        return cell.getAttribute('data-day');
      }
    }

    return null;
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    const drag = this.drag;

    if (drag === null) {
      return;
    }

    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD) {
        return;
      }
      drag.active = true;
      this.root?.setAttribute('data-dragging', drag.mode);
      this.eventParts(drag.rowId).forEach((el) => el.setAttribute('data-dragging', ''));
    }

    const over = this.dayAt(event.clientX, event.clientY);

    if (over !== drag.overDay) {
      if (drag.overDay !== null) {
        this.dayCell(drag.overDay)?.removeAttribute('data-drop');
      }
      drag.overDay = over;
    }
    if (over !== null) {
      this.dayCell(over)?.setAttribute('data-drop', '');
    }
  };

  private eventParts(rowId: string): HTMLElement[] {
    return [...(this.root?.querySelectorAll<HTMLElement>('[data-blok-database-calendar-event]') ?? [])]
      .filter((el) => el.getAttribute('data-row-id') === rowId);
  }

  private readonly onPointerUp = (): void => {
    const drag = this.drag;

    this.endDrag();

    if (drag === null || !drag.active) {
      return;
    }

    this.suppressClick = true;

    const dateId = this.options.datePropertyId;
    const value = dateId === undefined ? undefined : this.options.rows.find((r) => r.id === drag.rowId)?.properties[dateId];
    const span = eventSpan(value);

    if (drag.overDay === null || span === null || dateId === undefined) {
      return;
    }

    const next = drag.mode === 'move'
      ? moveDateValue(value, addDays(span.start, daysBetween(drag.grabDay, drag.overDay)))
      : resizeDateValue(value, drag.mode, drag.overDay);

    if (next !== null && next !== value) {
      this.options.handlers?.setDate(drag.rowId, next);
    }
  };

  private readonly onDragKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      this.cancelDrag();
    }
  };

  private readonly cancelDrag = (): void => {
    const wasActive = this.drag?.active === true;

    this.endDrag();
    this.suppressClick = wasActive;
  };

  private endDrag(): void {
    const drag = this.drag;

    if (drag !== null) {
      if (drag.overDay !== null) {
        this.dayCell(drag.overDay)?.removeAttribute('data-drop');
      }
      this.eventParts(drag.rowId).forEach((el) => el.removeAttribute('data-dragging'));
    }
    this.root?.removeAttribute('data-dragging');
    this.drag = null;
    document.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('pointerup', this.onPointerUp);
    document.removeEventListener('pointercancel', this.cancelDrag);
    document.removeEventListener('keydown', this.onDragKeyDown);
  }

  destroy(): void {
    this.endDrag();
  }

  appendRow(): void {
    // The tool redraws the calendar after a row is added.
  }

  removeRow(wrapper: HTMLElement, rowId: string): void {
    [...wrapper.querySelectorAll('[data-blok-database-calendar-event]')]
      .filter((el) => el.getAttribute('data-row-id') === rowId)
      .forEach((el) => el.remove());
  }

  updateRowTitle(wrapper: HTMLElement, rowId: string, title: string): void {
    [...wrapper.querySelectorAll('[data-blok-database-calendar-event]')]
      .filter((el) => el.getAttribute('data-row-id') === rowId)
      .forEach((el) => {
        const titleEl = el.querySelector('[data-blok-database-calendar-event-title]');

        if (titleEl !== null) {
          titleEl.textContent = title;
        }
      });
  }
}

/** Days to add past `day` (a weekend day) to reach a weekday going in `direction`. */
const weekendSkip = (day: string, direction: number): number => {
  const ahead = Array.from({ length: 2 }, (_, i) => addDays(day, direction * (i + 1)));

  return ahead.findIndex((d) => !isWeekend(d)) + 1;
};
