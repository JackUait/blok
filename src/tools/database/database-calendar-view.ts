import type { I18n } from '../../../types';
import type { DatabaseViewRenderer } from './database-view-renderer';
import { fileChipIcon, pageIconElement, showsPageIcon } from './page-icon';
import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition } from './types';
import { renderCellValue } from './cells';
import { rowCellContext } from './reminders';
import type { CellContext } from './cells';
import { readPropertyValue } from './property-values';
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
import { isHistoryKey } from './database-keyboard';
import { syncCommentBadge } from './database-comment-badge';
import type { CommentBadges } from './database-comment-badge';
import { getElementDirection } from '../../components/utils/direction';
import { IconCalendar, IconChevronLeft, IconChevronRight, IconPlus } from '../../components/icons';
import { PopoverRegistry } from '../../components/utils/popover/popover-registry';
import { openNoDatePanel } from './database-no-date';
import type { NoDateControl } from './database-no-date';
import type { DatabasePanel } from './database-panel';

export interface CalendarHandlers {
  openRow: (rowId: string) => void;
  /** Adds a row dated `day` (`YYYY-MM-DD`), and opens it when `open` is set. */
  addRow: (day: string, open?: boolean) => void;
  /** The row's new date value, as a stored string. */
  setDate: (rowId: string, value: string) => void;
  /** Show the range around `anchor`, then focus `focusDay` when given. */
  navigate: (anchor: string, focusDay?: string) => void;
  /** Shift-click: select the event without opening it. Absent when read-only. */
  pickRow?: (rowId: string) => void;
  /** A margin lasso across the grid: these events become the selection. Absent when read-only. */
  lassoRows?: (rowIds: string[]) => void;
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
  /** What cells need from the host: relation titles, computed result types. */
  cellContext?: Partial<CellContext>;
  /** A day to focus once drawn: keyboard navigation that crossed into a new range. */
  focusDay?: string;
  commentBadges?: CommentBadges;
  /** The host's "Manage in Calendar" (`config.calendar`), a toolbar button. Read-only keeps it. */
  manageInCalendar?: { label: string; onClick: () => void };
}

const DRAG_THRESHOLD = 4;

/** `place`: a row dragged out of the "No date" list. */
type DragMode = 'move' | 'start' | 'end' | 'place';

interface DragState {
  rowId: string;
  mode: DragMode;
  /** The day under the pointer at press, so a moved range keeps it under the pointer. */
  grabDay: string;
  startX: number;
  startY: number;
  active: boolean;
  overDay: string | null;
  /** The press point inside the event, so the ghost keeps it under the pointer. */
  grabOffset: { x: number; y: number };
  ghost: HTMLElement | null;
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
  /** A resize in progress: the row's would-be date, drawn live. */
  private preview: { rowId: string; value: string } | null = null;
  private noDatePanel: DatabasePanel | null = null;
  /** A drag box started on empty grid space (research/23 §2c). */
  private box: { startX: number; startY: number; el: HTMLElement | null; picked: string | null } | null = null;
  private suppressClick = false;
  /** The press found a menu open: its click only closes the menu. */
  private pressClosedMenu = false;
  private gestureClosedMenu = false;
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
    root.style.setProperty('--blok-database-calendar-event-lines', String(this.visibleProperties().length));
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
    root.addEventListener('dblclick', this.onDoubleClick);
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

    const calendar = this.options.manageInCalendar;

    if (calendar !== undefined) {
      const manage = document.createElement('button');

      manage.type = 'button';
      manage.setAttribute('data-blok-database-calendar-manage-calendar', '');
      manage.innerHTML = IconCalendar;
      manage.append(calendar.label);
      // Its own listener: the root's click handling needs handlers, and read-only has none.
      manage.addEventListener('click', () => calendar.onClick());
      nav.appendChild(manage);
    }
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

  /** Rows the date property leaves off the grid (research/08: Notion's "No date (N)"). */
  private undatedRows(): DatabaseRow[] {
    const dateId = this.options.datePropertyId;

    return dateId === undefined ? [] : this.options.rows.filter((row) => eventSpan(row.properties[dateId]) === null);
  }

  /** The database toolbar's "No date (N)" (findings C04). Undefined when nothing lacks a date, or read-only. */
  noDateControl(): NoDateControl | undefined {
    const rows = this.undatedRows();
    const handlers = this.options.handlers;

    if (rows.length === 0 || !this.canEdit || handlers === undefined) {
      return undefined;
    }

    return {
      count: rows.length,
      label: this.t('tools.database.calendarNoDate', { count: String(rows.length) }),
      open: (anchor) => {
        this.noDatePanel = openNoDatePanel({
          anchor,
          i18n: this.options.i18n,
          rows,
          titlePropertyId: this.options.titlePropertyId,
          hint: this.t('tools.database.calendarNoDateHint'),
          // Unmeasured in Notion: a click dates the page today.
          pick: (rowId) => handlers.setDate(rowId, this.options.today),
          open: (rowId) => handlers.openRow(rowId),
          press: (rowId, event) => {
            this.drag = { rowId, mode: 'place', grabDay: '', startX: event.clientX, startY: event.clientY, active: false, overDay: null, grabOffset: { x: 0, y: 0 }, ghost: null };
            this.listenForDrag();
          },
        });
      },
    };
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
    // Core leaves Shift-click inside to pickRow and hands a margin lasso to onLasso.
    grid.setAttribute('data-blok-selection-owner', '');
    grid.addEventListener('blok-lasso', this.onLasso);
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
      const span = eventSpan(this.preview?.rowId === row.id ? this.preview.value : row.properties[dateId]);

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
    const icon = row !== undefined && showsPageIcon(this.options.view) ? pageIconElement(row) : null;

    if (icon !== null) {
      el.appendChild(icon);
    }
    el.appendChild(titleEl);
    // Day cells are gridcells: refreshCommentBadges gives them tabIndex -1 too.
    if (this.options.commentBadges !== undefined) {
      syncCommentBadge(titleEl, placed.id, this.options.commentBadges, this.options.i18n, { tabIndex: -1 });
    }

    for (const property of this.visibleProperties()) {
      const cell = renderCellValue(property, row === undefined ? undefined : readPropertyValue(row, property), {
        ...this.options.cellContext,
        i18n: this.options.i18n,
        readOnly: true,
        locale: this.options.locale,
        shortUrls: true,
        ...rowCellContext(row, property.id),
      });

      cell.querySelectorAll('[data-blok-database-file-chip]').forEach((chip) => chip.prepend(fileChipIcon()));
      // notion-spec-2 §21.9: a card's checkbox has the property name beside it, as on the board.
      if (property.type === 'checkbox' && !cell.hasAttribute('data-empty')) {
        const name = document.createElement('span');

        name.setAttribute('data-blok-database-checkbox-name', '');
        name.setAttribute('aria-hidden', 'true');
        name.textContent = property.name;
        cell.appendChild(name);
      }
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
    // A double-click whose first press closed a menu adds nothing either.
    this.gestureClosedMenu = (event.detail > 1 && this.gestureClosedMenu) || this.pressClosedMenu;
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
      handlers.addRow(addDay, true);

      return;
    }

    const rowId = target.closest('[data-blok-database-calendar-event]')?.getAttribute('data-row-id');

    if (rowId === null || rowId === undefined) {
      this.clearOnPlainClick(target, event);

      return;
    }
    // research/22 §1: Shift selects without opening; Cmd/Ctrl-click does nothing.
    if (event.shiftKey) {
      handlers.pickRow?.(rowId);

      return;
    }
    if (event.metaKey || event.ctrlKey) {
      return;
    }
    handlers.openRow(rowId);
  };

  /** The day an editable click on a day's empty space lands on. Shift and Alt count only where `shiftAlt` allows them. */
  private emptyDayAt(target: Element, event: MouseEvent, shiftAlt = false): string | null {
    const dayIso = target.closest('[data-blok-database-calendar-day]')?.getAttribute('data-day');

    if (dayIso === null || dayIso === undefined || !this.canEdit || this.gestureClosedMenu || event.metaKey || event.ctrlKey
      || (!shiftAlt && (event.shiftKey || event.altKey))
      || target.closest('[data-blok-database-calendar-event], button, a, input, [role="button"]') !== null) {
      return null;
    }

    return dayIso;
  }

  /** research/31 §6: a single click on a day's empty space only clears the selection. */
  private clearOnPlainClick(target: Element, event: MouseEvent): void {
    if (this.emptyDayAt(target, event) !== null) {
      this.options.handlers?.lassoRows?.([]);
    }
  }

  /** research/31 §6: only a double-click on a day (its number too) adds a page on that day and opens it; research/35 §6: Shift or Alt too. */
  private readonly onDoubleClick = (event: MouseEvent): void => {
    const dayIso = event.target instanceof Element ? this.emptyDayAt(event.target, event, true) : null;

    if (dayIso !== null) {
      this.options.handlers?.addRow(dayIso, true);
    }
  };

  /** research/22 §1: a lasso from the page margin picks every event it touches. */
  private readonly onLasso = (event: Event): void => {
    const lassoRows = this.options.handlers?.lassoRows;

    if (!(event instanceof CustomEvent) || lassoRows === undefined) {
      return;
    }
    const detail: unknown = event.detail;
    const band = typeof detail === 'object' && detail !== null && 'rect' in detail ? detail.rect : null;

    if (isBand(band)) {
      event.preventDefault();
    }
    lassoRows(isBand(band) ? this.eventsIn(band) : []);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target instanceof HTMLElement ? event.target : null;

    if (target?.matches('[data-blok-database-calendar-event]') === true && event.key === 'Enter') {
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
    // Read before the registry's document listener closes the menu.
    this.pressClosedMenu = PopoverRegistry.instance.hasOpenPopovers();
    if (event.button !== 0 || !this.canEdit || !(event.target instanceof Element)) {
      return;
    }

    if (event.target.closest('[data-blok-database-comment-badge]') !== null) {
      return;
    }

    const eventEl = event.target.closest('[data-blok-database-calendar-event]');
    const rowId = eventEl?.getAttribute('data-row-id');

    if (eventEl === null && this.options.handlers?.lassoRows !== undefined && event.target.closest('[data-blok-database-calendar-day]') !== null && event.target.closest('button, a, input, [role="button"]') === null) {
      this.startBox(event);

      return;
    }

    const edge = event.target.closest('[data-blok-database-calendar-resize]')?.getAttribute('data-blok-database-calendar-resize');
    const grabDay = this.dayAt(event.clientX, event.clientY);

    if (rowId === null || rowId === undefined || grabDay === null || eventEl === null) {
      return;
    }
    const box = eventEl.getBoundingClientRect();

    this.drag = {
      rowId,
      mode: edge === 'start' || edge === 'end' ? edge : 'move',
      grabDay,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      overDay: grabDay,
      grabOffset: { x: event.clientX - box.left, y: event.clientY - box.top },
      ghost: null,
    };
    this.listenForDrag();
  };

  private startBox(event: PointerEvent): void {
    this.box = { startX: event.clientX, startY: event.clientY, el: null, picked: null };
    document.addEventListener('pointermove', this.onBoxMove);
    document.addEventListener('pointerup', this.endBox);
    document.addEventListener('pointercancel', this.endBox);
    // Keeps the drag from selecting the day numbers' text.
    document.addEventListener('selectstart', this.preventDefault);
  }

  private readonly preventDefault = (event: Event): void => {
    event.preventDefault();
  };

  private readonly onBoxMove = (event: PointerEvent): void => {
    const box = this.box;
    const grid = this.root?.querySelector<HTMLElement>('[data-blok-database-calendar-grid]');

    if (box === null || grid === null || grid === undefined) {
      return;
    }
    if (box.el === null) {
      if (Math.hypot(event.clientX - box.startX, event.clientY - box.startY) < DRAG_THRESHOLD) {
        return;
      }
      box.el = document.createElement('div');
      box.el.setAttribute('data-blok-database-calendar-lasso', '');
      box.el.setAttribute('aria-hidden', 'true');
      grid.appendChild(box.el);
    }

    const band = {
      left: Math.min(box.startX, event.clientX),
      top: Math.min(box.startY, event.clientY),
      right: Math.max(box.startX, event.clientX),
      bottom: Math.max(box.startY, event.clientY),
    };
    const origin = grid.getBoundingClientRect();

    Object.assign(box.el.style, {
      left: `${band.left - origin.left}px`,
      top: `${band.top - origin.top}px`,
      width: `${band.right - band.left}px`,
      height: `${band.bottom - band.top}px`,
    });

    const touched = this.eventsIn(band);
    const key = touched.join(' ');

    if (key !== box.picked) {
      box.picked = key;
      this.options.handlers?.lassoRows?.(touched);
    }
  };

  private readonly endBox = (): void => {
    const drew = this.box !== null && this.box.el !== null;

    this.box?.el?.remove();
    this.box = null;
    document.removeEventListener('pointermove', this.onBoxMove);
    document.removeEventListener('pointerup', this.endBox);
    document.removeEventListener('pointercancel', this.endBox);
    document.removeEventListener('selectstart', this.preventDefault);
    if (drew) {
      this.guardNextClick(true);
    }
  };

  /** Row ids of the events a client-coordinate band touches, in grid order. */
  private eventsIn(band: { left: number; top: number; right: number; bottom: number }): string[] {
    const touched = new Set<string>();

    this.root?.querySelectorAll<HTMLElement>('[data-blok-database-calendar-event]').forEach((el) => {
      const r = el.getBoundingClientRect();
      const rowId = el.getAttribute('data-row-id');

      if (rowId !== null && r.right > band.left && r.left < band.right && r.bottom > band.top && r.top < band.bottom) {
        touched.add(rowId);
      }
    });

    return [...touched];
  }

  private listenForDrag(): void {
    document.addEventListener('pointermove', this.onPointerMove);
    document.addEventListener('pointerup', this.onPointerUp);
    document.addEventListener('pointercancel', this.cancelDrag);
    document.addEventListener('keydown', this.onDragKeyDown);
  }

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
      this.noDatePanel?.close();
      this.noDatePanel = null;
      if (drag.mode === 'move') {
        drag.ghost = this.createGhost(drag.rowId);
      }
    }

    const over = this.dayAt(event.clientX, event.clientY);

    if (drag.mode === 'start' || drag.mode === 'end') {
      if (over !== null && over !== drag.overDay) {
        drag.overDay = over;
        this.previewResize(drag);
      }

      return;
    }
    this.placeGhost(drag, event.clientX, event.clientY);
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

  /** A faded copy of the event that follows the pointer unsnapped (Notion's move). */
  private createGhost(rowId: string): HTMLElement | null {
    const source = this.eventParts(rowId)[0];
    const grid = this.root?.querySelector('[data-blok-database-calendar-grid]');

    if (source === undefined || grid === null || grid === undefined) {
      return null;
    }
    const box = source.getBoundingClientRect();
    const ghost = document.createElement('div');

    ghost.setAttribute('data-blok-database-calendar-ghost', '');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.width = `${box.width}px`;
    ghost.style.height = `${box.height}px`;
    ghost.append(...[...source.childNodes].map((node) => node.cloneNode(true)));
    ghost.querySelectorAll('[data-blok-database-calendar-resize], [data-blok-database-comment-badge]').forEach((el) => el.remove());
    grid.appendChild(ghost);

    return ghost;
  }

  private placeGhost(drag: DragState, x: number, y: number): void {
    const ghost = drag.ghost;
    const origin = ghost?.parentElement?.getBoundingClientRect();

    if (ghost === null || origin === undefined) {
      return;
    }
    Object.assign(ghost.style, {
      left: `${x - drag.grabOffset.x - origin.left}px`,
      top: `${y - drag.grabOffset.y - origin.top}px`,
    });
  }

  /** Redraws the events with the dragged edge on `overDay`. */
  private previewResize(drag: DragState): void {
    const dateId = this.options.datePropertyId;
    const value = dateId === undefined ? undefined : this.options.rows.find((r) => r.id === drag.rowId)?.properties[dateId];
    const next = drag.overDay === null || drag.mode === 'move' || drag.mode === 'place' ? null : resizeDateValue(value, drag.mode, drag.overDay);

    this.preview = next === null ? null : { rowId: drag.rowId, value: next };
    this.redrawEvents();
    this.eventParts(drag.rowId).forEach((el) => el.setAttribute('data-dragging', ''));
  }

  /** Lays the events out again in the drawn day cells, so the cells keep their focus and layout. */
  private redrawEvents(): void {
    this.root?.querySelectorAll<HTMLElement>('[data-blok-database-calendar-week]').forEach((weekEl) => {
      const cells = [...weekEl.querySelectorAll<HTMLElement>(':scope > [data-blok-database-calendar-day]')];
      const week = cells.map((cell) => cell.getAttribute('data-day') ?? '');
      const placed = layoutWeek(week, this.events());

      weekEl.style.setProperty('--blok-database-calendar-lanes', String(placed.reduce((max, p) => Math.max(max, p.lane + 1), 0)));
      cells.forEach((cell, col) => {
        cell.querySelectorAll(':scope > [data-blok-database-calendar-event]').forEach((el) => el.remove());
        placed.filter((p) => p.startCol === col).forEach((p) => cell.appendChild(this.createEvent(p)));
      });
    });
  }

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

    this.guardNextClick(true);

    if (drag.mode === 'place') {
      if (drag.overDay !== null) {
        this.options.handlers?.setDate(drag.rowId, drag.overDay);
      }

      return;
    }

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
    // The editor's undo would rewrite rows under the drag.
    if (isHistoryKey(event)) {
      event.preventDefault();
    }
    if (event.key === 'Escape') {
      this.cancelDrag();
    }
  };

  private readonly cancelDrag = (): void => {
    const wasActive = this.drag?.active === true;

    this.endDrag();
    this.guardNextClick(wasActive);
  };

  private endDrag(): void {
    const drag = this.drag;

    if (drag !== null) {
      if (drag.overDay !== null) {
        this.dayCell(drag.overDay)?.removeAttribute('data-drop');
      }
      drag.ghost?.remove();
      if (this.preview !== null) {
        this.preview = null;
        this.redrawEvents();
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

  /**
   * Eats the click the browser fires right after a drag's pointerup. Cleared
   * on the next task: a drag released outside the view sends that click
   * elsewhere, and the guard must not eat the person's next real click.
   */
  private guardNextClick(on: boolean): void {
    this.suppressClick = on;
    if (on) {
      setTimeout(() => {
        this.suppressClick = false;
      }, 0);
    }
  }

  destroy(): void {
    this.endDrag();
    this.endBox();
    this.noDatePanel?.close();
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

const isBand = (value: unknown): value is { left: number; top: number; right: number; bottom: number } =>
  typeof value === 'object' && value !== null && 'left' in value && 'top' in value && 'right' in value && 'bottom' in value;
