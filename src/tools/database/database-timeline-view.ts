import type { I18n } from '../../../types';
import type { DatabaseViewRenderer } from './database-view-renderer';
import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition, SelectOption, TimelineZoom } from './types';
import type { GalleryDropResult } from './database-gallery-view';
import { createOptionPill, renderCellValue } from './cells';
import { addDays, daysBetween, isWeekend } from './calendar-dates';
import type { EventSpan } from './calendar-dates';
import {
  TIMELINE_DAY_WIDTH,
  barGeometry,
  headerUnits,
  moveBar,
  offscreenSide,
  resizeBar,
  timelineSpan,
  timelineWindow,
  visibleRange,
  zoomStep,
} from './timeline-dates';
import type { BarWrite, TimelineWindow } from './timeline-dates';
import { resolveShowTimelineTable, resolveTimelineTableProperties, resolveTimelineZoom, resolveViewProperties } from './view-settings';
import { getElementDirection } from '../../components/utils/direction';
import { IconChevronLeft, IconChevronRight, IconMenu, IconPlus } from '../../components/icons';

export interface TimelineGroup {
  /** '' when the timeline is not grouped. */
  key: string;
  label: string;
  option?: SelectOption;
  /** The rows shown, already cut to the load limit. */
  rows: DatabaseRow[];
  /** Rows in the group before the cut. */
  total: number;
}

export interface TimelineHandlers {
  openRow: (rowId: string) => void;
  /** Group key, or null when the timeline is not grouped. */
  addRow: (groupKey: string | null) => void;
  /** New stored values for the start and/or end property. */
  writeDates: (rowId: string, write: BarWrite) => void;
  moveRow: (result: GalleryDropResult) => void;
  setZoom: (zoom: TimelineZoom) => void;
  openZoomMenu: (anchor: HTMLElement) => void;
  /** Redraw centred on `day`. */
  navigate: (day: string) => void;
  toggleTable: () => void;
  loadMore: (groupKey: string) => void;
}

export interface DatabaseTimelineViewOptions {
  readOnly: boolean;
  i18n: Pick<I18n, 't'>;
  view: DatabaseViewConfig;
  /** Localized schema. */
  schema: PropertyDefinition[];
  groups: TimelineGroup[];
  grouped: boolean;
  titlePropertyId: string;
  /** The date property that places bars, or undefined when the database has none. */
  startPropertyId: string | undefined;
  /** A separate end property, or undefined when the start property holds the range. */
  endPropertyId: string | undefined;
  /** The day in the middle of the drawn window. */
  center: string;
  today: string;
  handlers?: TimelineHandlers;
  locale?: string;
}

const DRAG_THRESHOLD = 4;
const PAN_PX = 160;
/** Within this share of either canvas end, a scroll redraws around a new centre. */
const EDGE_SHARE = 0.1;
/** Zooms whose days are wide enough to shade weekends one by one. */
const DAY_LEVEL: ReadonlySet<TimelineZoom> = new Set(['hours', 'day', 'week', 'bi_week', 'month']);

const ZOOM_KEYS: Record<TimelineZoom, string> = {
  hours: 'tools.database.timelineZoomHours',
  day: 'tools.database.timelineZoomDay',
  week: 'tools.database.timelineZoomWeek',
  bi_week: 'tools.database.timelineZoomBiWeek',
  month: 'tools.database.timelineZoomMonth',
  quarter: 'tools.database.timelineZoomQuarter',
  year: 'tools.database.timelineZoomYear',
  '5_years': 'tools.database.timelineZoomFiveYears',
};

export const timelineZoomLabelKey = (zoom: TimelineZoom): string => ZOOM_KEYS[zoom];

interface BarDrag {
  kind: 'bar';
  rowId: string;
  mode: 'move' | 'start' | 'end';
  grabDay: string;
  startX: number;
  startY: number;
  active: boolean;
  overDay: string;
}

interface RowDrag {
  kind: 'row';
  rowId: string;
  fromGroupKey: string;
  startX: number;
  startY: number;
  active: boolean;
  target: { row: HTMLElement; side: 'before' | 'after' } | null;
}

/**
 * Notion's timeline layout (research/03 §7): a horizontal date axis, one row
 * per item with a bar from its start to its end, an optional table panel,
 * zoom, Today and off-screen arrows.
 */
export class DatabaseTimelineView implements DatabaseViewRenderer {
  private readonly options: DatabaseTimelineViewOptions;
  private readonly window: TimelineWindow;
  private root: HTMLElement | null = null;
  private scroller: HTMLElement | null = null;
  private drag: BarDrag | RowDrag | null = null;
  private suppressClick = false;
  private recentring = false;

  constructor(options: DatabaseTimelineViewOptions) {
    this.options = options;
    this.window = timelineWindow(options.center, this.zoom);
  }

  get interacting(): boolean {
    return this.drag?.active === true;
  }

  private t(key: string): string {
    return this.options.i18n.t(key);
  }

  private get zoom(): TimelineZoom {
    return resolveTimelineZoom(this.options.view);
  }

  private get dayWidth(): number {
    return TIMELINE_DAY_WIDTH[this.zoom];
  }

  private get canEdit(): boolean {
    return !this.options.readOnly && this.options.handlers !== undefined;
  }

  private get canReorder(): boolean {
    return this.canEdit && this.options.view.sorts.length === 0;
  }

  private get rtl(): boolean {
    return getElementDirection(this.root) === 'rtl';
  }

  createView(): HTMLDivElement {
    const root = document.createElement('div');

    root.setAttribute('data-blok-database-timeline', '');
    root.setAttribute('data-zoom', this.zoom);
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', this.t('tools.database.timelineLabel'));
    this.root = root;
    root.appendChild(this.createToolbar());

    if (this.options.startPropertyId === undefined) {
      const empty = document.createElement('div');

      empty.setAttribute('data-blok-database-timeline-empty', '');
      empty.textContent = this.t('tools.database.timelineNoDateProperty');
      root.appendChild(empty);

      return root;
    }

    const body = document.createElement('div');

    body.setAttribute('data-blok-database-timeline-body', '');
    if (resolveShowTimelineTable(this.options.view)) {
      body.appendChild(this.createTable());
    }
    body.appendChild(this.createScroller());
    root.appendChild(body);

    if (this.canEdit) {
      const add = document.createElement('button');

      add.type = 'button';
      add.setAttribute('data-blok-database-timeline-new', '');
      add.innerHTML = IconPlus;
      add.append(this.t('tools.database.timelineNew'));
      root.appendChild(add);
    }

    root.addEventListener('click', this.onClick);
    root.addEventListener('keydown', this.onKeyDown);
    root.addEventListener('pointerdown', this.onPointerDown);

    // The tool attaches the view after createView returns; only then has the scroller a width.
    queueMicrotask(() => {
      if (this.root?.isConnected === true) {
        this.scrollToDay(this.options.center, 'center');
      }
    });

    return root;
  }

  private createToolbar(): HTMLElement {
    const bar = document.createElement('div');
    const shown = resolveShowTimelineTable(this.options.view);

    bar.setAttribute('data-blok-database-timeline-toolbar', '');

    const toggle = document.createElement('button');

    toggle.type = 'button';
    toggle.setAttribute('data-blok-database-timeline-table-toggle', '');
    toggle.setAttribute('aria-pressed', String(shown));
    toggle.setAttribute('aria-label', this.t(shown ? 'tools.database.timelineHideTable' : 'tools.database.timelineShowTable'));
    toggle.innerHTML = shown ? IconChevronLeft : IconChevronRight;

    const spacer = document.createElement('div');

    spacer.setAttribute('data-blok-database-timeline-toolbar-spacer', '');

    const zoom = document.createElement('button');

    zoom.type = 'button';
    zoom.setAttribute('data-blok-database-timeline-zoom', '');
    zoom.setAttribute('aria-haspopup', 'menu');
    zoom.textContent = this.t(ZOOM_KEYS[this.zoom]);

    const today = document.createElement('button');

    today.type = 'button';
    today.setAttribute('data-blok-database-timeline-today', '');
    today.textContent = this.t('tools.database.timelineToday');
    bar.append(toggle, spacer, zoom, today);

    return bar;
  }

  /** Every group with its rows, in drawing order, so the table panel and the canvas line up. */
  private get sections(): TimelineGroup[] {
    return this.options.groups;
  }

  private createTable(): HTMLElement {
    const panel = document.createElement('div');
    const properties = resolveTimelineTableProperties(this.options.view, this.options.schema)
      .filter((p) => p.visible)
      .flatMap((p) => this.options.schema.filter((s) => s.id === p.id));

    panel.setAttribute('data-blok-database-timeline-table', '');

    const header = document.createElement('div');

    header.setAttribute('data-blok-database-timeline-table-header', '');
    for (const property of properties) {
      const cell = document.createElement('div');

      cell.setAttribute('data-property-id', property.id);
      cell.textContent = property.name;
      header.appendChild(cell);
    }
    panel.appendChild(header);

    for (const group of this.sections) {
      if (this.options.grouped) {
        panel.appendChild(this.createGroupHeader(group, 'table'));
      }
      group.rows.forEach((row) => panel.appendChild(this.createTableRow(row, properties)));
      if (group.total > group.rows.length) {
        panel.appendChild(this.createSpacer());
      }
    }

    return panel;
  }

  private createTableRow(row: DatabaseRow, properties: PropertyDefinition[]): HTMLElement {
    const line = document.createElement('div');

    line.setAttribute('data-blok-database-timeline-table-row', '');
    line.setAttribute('data-row-id', row.id);
    for (const property of properties) {
      const cell = document.createElement('div');

      cell.setAttribute('data-property-id', property.id);
      if (property.id === this.options.titlePropertyId) {
        cell.setAttribute('data-blok-database-timeline-table-title', '');
        cell.textContent = this.titleOf(row);
      } else {
        cell.appendChild(renderCellValue(property, row.properties[property.id], {
          i18n: this.options.i18n,
          readOnly: true,
          locale: this.options.locale,
        }));
      }
      line.appendChild(cell);
    }

    return line;
  }

  private createSpacer(): HTMLElement {
    const spacer = document.createElement('div');

    spacer.setAttribute('data-blok-database-timeline-spacer', '');

    return spacer;
  }

  private createScroller(): HTMLElement {
    const scroller = document.createElement('div');
    const canvas = document.createElement('div');

    scroller.setAttribute('data-blok-database-timeline-scroller', '');
    scroller.setAttribute('data-blok-keyboard-owner', '');
    scroller.tabIndex = 0;
    scroller.setAttribute('aria-label', this.t('tools.database.timelineLabel'));
    scroller.addEventListener('scroll', this.onScroll);
    this.scroller = scroller;

    canvas.setAttribute('data-blok-database-timeline-canvas', '');
    canvas.style.width = `${this.window.days * this.dayWidth}px`;
    canvas.style.setProperty('--blok-database-timeline-day', `${this.dayWidth}px`);
    canvas.appendChild(this.createHeader());
    canvas.appendChild(this.createBackground());

    const firstDated = this.sections.flatMap((group) => group.rows).find((row) => this.spanOf(row) !== null)?.id;

    for (const group of this.sections) {
      if (this.options.grouped) {
        canvas.appendChild(this.createGroupHeader(group, 'canvas'));
      }
      for (const row of group.rows) {
        canvas.appendChild(this.createRow(row, group.key, row.id === firstDated));
      }
      if (group.total > group.rows.length) {
        const more = document.createElement('button');

        more.type = 'button';
        more.setAttribute('data-blok-database-timeline-load-more', '');
        more.setAttribute('data-group-key', group.key);
        more.textContent = this.t('tools.database.timelineLoadMore');
        canvas.appendChild(more);
      }
    }
    scroller.appendChild(canvas);

    return scroller;
  }

  private createHeader(): HTMLElement {
    const header = document.createElement('div');
    const { groups, units } = headerUnits(this.window, this.zoom, this.options.locale ?? 'en-US');
    const line = (attr: string, items: typeof groups): HTMLElement => {
      const el = document.createElement('div');

      el.setAttribute(attr, '');
      for (const item of items) {
        const label = document.createElement('div');

        label.setAttribute('data-day', item.day);
        label.style.insetInlineStart = `${item.offset}px`;
        label.style.width = `${item.width}px`;
        label.textContent = item.label;
        el.appendChild(label);
      }

      return el;
    };

    header.setAttribute('data-blok-database-timeline-header', '');
    header.setAttribute('aria-hidden', 'true');
    header.append(line('data-blok-database-timeline-groups', groups), line('data-blok-database-timeline-units', units));

    const todayIndex = daysBetween(this.window.start, this.options.today);

    if (todayIndex >= 0 && todayIndex < this.window.days) {
      const dot = document.createElement('div');

      dot.setAttribute('data-blok-database-timeline-today-dot', '');
      dot.style.insetInlineStart = `${todayIndex * this.dayWidth + this.dayWidth / 2}px`;
      dot.textContent = this.options.today.slice(8).replace(/^0/, '');
      header.appendChild(dot);
    }

    return header;
  }

  /** Weekend columns and the today line, behind the rows. */
  private createBackground(): HTMLElement {
    const layer = document.createElement('div');

    layer.setAttribute('data-blok-database-timeline-background', '');
    layer.setAttribute('aria-hidden', 'true');
    const weekends = DAY_LEVEL.has(this.zoom)
      ? Array.from({ length: this.window.days }, (_, i) => i).filter((i) => isWeekend(addDays(this.window.start, i)))
      : [];

    for (const i of weekends) {
      const column = document.createElement('div');

      column.setAttribute('data-blok-database-timeline-weekend', '');
      column.style.insetInlineStart = `${i * this.dayWidth}px`;
      layer.appendChild(column);
    }

    const todayIndex = daysBetween(this.window.start, this.options.today);

    if (todayIndex >= 0 && todayIndex < this.window.days) {
      const line = document.createElement('div');

      line.setAttribute('data-blok-database-timeline-today-line', '');
      line.style.insetInlineStart = `${todayIndex * this.dayWidth + this.dayWidth / 2}px`;
      layer.appendChild(line);
    }

    return layer;
  }

  private createGroupHeader(group: TimelineGroup, where: 'table' | 'canvas'): HTMLElement {
    const header = document.createElement('div');

    header.setAttribute(where === 'canvas' ? 'data-blok-database-timeline-group' : 'data-blok-database-timeline-table-group', '');
    header.setAttribute('data-group-key', group.key);

    const label = document.createElement('div');

    label.setAttribute('data-blok-database-timeline-group-label', '');
    if (group.option !== undefined) {
      label.appendChild(createOptionPill(group.option));
    } else {
      label.textContent = group.label;
    }

    const count = document.createElement('span');

    count.setAttribute('data-blok-database-timeline-group-count', '');
    count.textContent = String(group.total);
    label.appendChild(count);
    header.appendChild(label);

    return header;
  }

  private titleOf(row: DatabaseRow): string {
    const title = row.properties[this.options.titlePropertyId];

    return typeof title === 'string' ? title : '';
  }

  private spanOf(row: DatabaseRow): EventSpan | null {
    const startId = this.options.startPropertyId;
    const endId = this.options.endPropertyId;

    if (startId === undefined) {
      return null;
    }

    return timelineSpan(row.properties[startId], endId === undefined ? undefined : row.properties[endId] ?? null);
  }

  private createRow(row: DatabaseRow, groupKey: string, tabbable: boolean): HTMLElement {
    const line = document.createElement('div');
    const span = this.spanOf(row);

    line.setAttribute('data-blok-database-timeline-row', '');
    line.setAttribute('data-row-id', row.id);
    line.setAttribute('data-group-key', groupKey);

    const edge = document.createElement('div');

    edge.setAttribute('data-blok-database-timeline-row-edge', '');
    if (this.canReorder) {
      const handle = document.createElement('span');

      handle.setAttribute('data-blok-database-timeline-row-handle', '');
      handle.setAttribute('aria-hidden', 'true');
      handle.innerHTML = IconMenu;
      edge.appendChild(handle);
    }
    edge.appendChild(this.createOffscreenArrow('before'));
    line.appendChild(edge);

    if (span !== null) {
      line.appendChild(this.createBar(row, span, tabbable));
    }

    const end = document.createElement('div');

    end.setAttribute('data-blok-database-timeline-row-end', '');
    end.appendChild(this.createOffscreenArrow('after'));
    line.appendChild(end);

    return line;
  }

  private createOffscreenArrow(side: 'before' | 'after'): HTMLElement {
    const arrow = document.createElement('button');

    arrow.type = 'button';
    arrow.hidden = true;
    arrow.tabIndex = -1;
    arrow.setAttribute('data-blok-database-timeline-offscreen', side);
    arrow.setAttribute('aria-label', this.t(side === 'before' ? 'tools.database.timelineJumpBack' : 'tools.database.timelineJumpForward'));
    arrow.innerHTML = side === 'before' ? IconChevronLeft : IconChevronRight;

    return arrow;
  }

  private createBar(row: DatabaseRow, span: EventSpan, tabbable: boolean): HTMLElement {
    const el = document.createElement('div');
    const { offset, width } = barGeometry(span, this.window.start, this.zoom);
    const title = this.titleOf(row);

    el.setAttribute('data-blok-database-timeline-bar', '');
    el.setAttribute('data-row-id', row.id);
    el.setAttribute('role', 'button');
    el.tabIndex = tabbable ? 0 : -1;
    el.style.insetInlineStart = `${offset}px`;
    el.style.width = `${width}px`;

    if (this.canEdit) {
      el.appendChild(this.createHandle('start'));
    }

    const titleEl = document.createElement('span');

    titleEl.setAttribute('data-blok-database-timeline-bar-title', '');
    titleEl.textContent = title;
    if (title === '') {
      titleEl.setAttribute('data-placeholder', this.t('tools.database.cardTitlePlaceholder'));
    }
    el.appendChild(titleEl);

    for (const property of this.barProperties()) {
      const cell = renderCellValue(property, row.properties[property.id], {
        i18n: this.options.i18n,
        readOnly: true,
        locale: this.options.locale,
      });

      if (!cell.hasAttribute('data-empty')) {
        const item = document.createElement('span');

        item.setAttribute('data-blok-database-timeline-bar-property', '');
        item.setAttribute('data-property-id', property.id);
        item.appendChild(cell);
        el.appendChild(item);
      }
    }

    if (this.canEdit) {
      el.appendChild(this.createHandle('end'));
    }

    return el;
  }

  private barProperties(): PropertyDefinition[] {
    return resolveViewProperties(this.options.view, this.options.schema)
      .filter((p) => p.visible && p.id !== this.options.titlePropertyId)
      .flatMap((p) => this.options.schema.filter((property) => property.id === p.id));
  }

  private createHandle(edge: 'start' | 'end'): HTMLElement {
    const handle = document.createElement('span');

    handle.setAttribute('data-blok-database-timeline-resize', edge);
    handle.setAttribute('aria-hidden', 'true');

    return handle;
  }

  private rowsOf(attr: string): HTMLElement[] {
    return [...(this.root?.querySelectorAll<HTMLElement>(attr) ?? [])];
  }

  private findRow(rowId: string): DatabaseRow | undefined {
    for (const group of this.sections) {
      const found = group.rows.find((r) => r.id === rowId);

      if (found !== undefined) {
        return found;
      }
    }

    return undefined;
  }

  /** Scroll position measured from the inline start, whatever the direction. */
  private get scrollStart(): number {
    const left = this.scroller?.scrollLeft ?? 0;

    return this.rtl ? -left : left;
  }

  private set scrollStart(value: number) {
    if (this.scroller !== null) {
      this.scroller.scrollLeft = this.rtl ? -value : value;
    }
  }

  private scrollToDay(day: string, align: 'center' | 'start'): void {
    const offset = daysBetween(this.window.start, day) * this.dayWidth;
    const viewport = this.scroller?.clientWidth ?? 0;

    this.recentring = true;
    this.scrollStart = Math.max(0, align === 'center' ? offset - viewport / 2 : offset - this.dayWidth);
    this.recentring = false;
    this.refreshOffscreen();
  }

  /** Shows the arrow on each row whose bar lies off screen. */
  refreshOffscreen(): void {
    if (this.scroller === null) {
      return;
    }

    const range = visibleRange({
      scrollStart: this.scrollStart,
      viewport: this.scroller.clientWidth,
      windowStart: this.window.start,
      zoom: this.zoom,
    });

    for (const line of this.rowsOf('[data-blok-database-timeline-row]')) {
      const row = this.findRow(line.getAttribute('data-row-id') ?? '');
      const span = row === undefined ? null : this.spanOf(row);
      const side = span === null || this.scroller.clientWidth === 0 ? null : offscreenSide(span, range);

      line.querySelectorAll('[data-blok-database-timeline-offscreen]').forEach((arrow) => {
        arrow.toggleAttribute('hidden', arrow.getAttribute('data-blok-database-timeline-offscreen') !== side);
      });
    }
  }

  private readonly onScroll = (): void => {
    this.refreshOffscreen();

    const scroller = this.scroller;

    if (this.recentring || scroller === null || scroller.clientWidth === 0) {
      return;
    }

    const total = this.window.days * this.dayWidth;
    const start = this.scrollStart;
    const near = total * EDGE_SHARE;

    if (start < near || start + scroller.clientWidth > total - near) {
      const middle = addDays(this.window.start, Math.floor((start + scroller.clientWidth / 2) / this.dayWidth));

      this.options.handlers?.navigate(middle);
    }
  };

  private jumpTo(rowId: string): void {
    const row = this.findRow(rowId);
    const span = row === undefined ? null : this.spanOf(row);

    if (span === null) {
      return;
    }

    const index = daysBetween(this.window.start, span.start);

    if (index < 0 || index >= this.window.days) {
      this.options.handlers?.navigate(span.start);

      return;
    }
    this.scrollToDay(span.start, 'start');
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

    const actions: Array<[string, (el: Element) => void]> = [
      ['[data-blok-database-timeline-table-toggle]', () => handlers.toggleTable()],
      ['[data-blok-database-timeline-zoom]', (el) => {
        if (el instanceof HTMLElement) {
          handlers.openZoomMenu(el);
        }
      }],
      ['[data-blok-database-timeline-today]', () => handlers.navigate(this.options.today)],
      ['[data-blok-database-timeline-new]', () => {
        if (this.canEdit) {
          handlers.addRow(this.options.grouped ? this.options.groups[0]?.key ?? null : null);
        }
      }],
      ['[data-blok-database-timeline-load-more]', (el) => handlers.loadMore(el.getAttribute('data-group-key') ?? '')],
      ['[data-blok-database-timeline-offscreen]', (el) => this.jumpTo(el.closest('[data-row-id]')?.getAttribute('data-row-id') ?? '')],
      ['[data-blok-database-timeline-table-title], [data-blok-database-timeline-bar]', (el) => {
        const rowId = el.closest('[data-row-id]')?.getAttribute('data-row-id');

        if (rowId !== null && rowId !== undefined) {
          handlers.openRow(rowId);
        }
      }],
    ];

    for (const [selector, run] of actions) {
      const el = target.closest(selector);

      if (el !== null) {
        run(el);

        return;
      }
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target instanceof HTMLElement ? event.target : null;

    if (target === null || event.metaKey || event.ctrlKey || event.altKey || target.closest('input, textarea, [contenteditable="true"]') !== null) {
      return;
    }

    if (target.hasAttribute('data-blok-database-timeline-bar') && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      target.click();

      return;
    }

    if (target.closest('[data-blok-database-timeline-scroller]') === null) {
      return;
    }

    if (event.key === '+' || event.key === '=' || event.key === '-') {
      event.preventDefault();
      this.options.handlers?.setZoom(zoomStep(this.zoom, event.key === '-' ? -1 : 1));

      return;
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      this.scrollStart = this.scrollStart + ((event.key === 'ArrowRight') !== this.rtl ? PAN_PX : -PAN_PX);

      return;
    }

    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && target.hasAttribute('data-blok-database-timeline-bar')) {
      const all = this.rowsOf('[data-blok-database-timeline-bar]');
      const next = all[all.indexOf(target) + (event.key === 'ArrowDown' ? 1 : -1)];

      event.preventDefault();
      if (next !== undefined) {
        all.forEach((el) => el.setAttribute('tabindex', el === next ? '0' : '-1'));
        next.focus();
      }
    }
  };

  /** The day under a pointer, from the canvas box. */
  private dayAt(x: number): string {
    const box = this.root?.querySelector('[data-blok-database-timeline-canvas]')?.getBoundingClientRect();
    const edge = this.rtl ? (box?.right ?? 0) - x : x - (box?.left ?? 0);
    const fromStart = box === undefined ? 0 : edge;

    return addDays(this.window.start, Math.floor(fromStart / this.dayWidth));
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !this.canEdit || !(event.target instanceof Element)) {
      return;
    }

    const handle = event.target.closest('[data-blok-database-timeline-row-handle]');

    if (handle !== null && this.canReorder) {
      const line = handle.closest('[data-blok-database-timeline-row]');

      this.drag = {
        kind: 'row',
        rowId: line?.getAttribute('data-row-id') ?? '',
        fromGroupKey: line?.getAttribute('data-group-key') ?? '',
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        target: null,
      };
      this.listen();

      return;
    }

    const barEl = event.target.closest('[data-blok-database-timeline-bar]');
    const rowId = barEl?.getAttribute('data-row-id');

    if (rowId === null || rowId === undefined) {
      return;
    }

    const edge = event.target.closest('[data-blok-database-timeline-resize]')?.getAttribute('data-blok-database-timeline-resize');
    const grabDay = this.dayAt(event.clientX);

    this.drag = {
      kind: 'bar',
      rowId,
      mode: edge === 'start' || edge === 'end' ? edge : 'move',
      grabDay,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      overDay: grabDay,
    };
    this.listen();
  };

  private listen(): void {
    document.addEventListener('pointermove', this.onPointerMove);
    document.addEventListener('pointerup', this.onPointerUp);
    document.addEventListener('pointercancel', this.cancelDrag);
    document.addEventListener('keydown', this.onDragKeyDown);
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
      this.root?.setAttribute('data-dragging', drag.kind === 'bar' ? drag.mode : 'row');
      this.partsOf(drag.rowId).forEach((el) => el.setAttribute('data-dragging', ''));
    }

    if (drag.kind === 'bar') {
      drag.overDay = this.dayAt(event.clientX);
      this.previewBar(drag);

      return;
    }

    this.setRowTarget(this.rowTargetAt(drag, event.clientY));
  };

  private partsOf(rowId: string): HTMLElement[] {
    return this.rowsOf('[data-blok-database-timeline-bar], [data-blok-database-timeline-row]')
      .filter((el) => el.getAttribute('data-row-id') === rowId);
  }

  /** Writes the bar's would-be place on the bar itself while dragging. */
  private previewBar(drag: BarDrag): void {
    const span = this.spanAfter(drag);
    const barEl = this.rowsOf('[data-blok-database-timeline-bar]').find((el) => el.getAttribute('data-row-id') === drag.rowId);

    if (span === null || barEl === undefined) {
      return;
    }

    const { offset, width } = barGeometry(span, this.window.start, this.zoom);

    barEl.style.insetInlineStart = `${offset}px`;
    barEl.style.width = `${width}px`;
  }

  private barValues(rowId: string): { start: DatabaseRow['properties'][string] | undefined; end: DatabaseRow['properties'][string] | undefined } | null {
    const row = this.findRow(rowId);
    const startId = this.options.startPropertyId;
    const endId = this.options.endPropertyId;

    if (row === undefined || startId === undefined) {
      return null;
    }

    return { start: row.properties[startId], end: endId === undefined ? undefined : row.properties[endId] ?? null };
  }

  private writeFor(drag: BarDrag): BarWrite {
    const values = this.barValues(drag.rowId);

    if (values === null) {
      return {};
    }

    return drag.mode === 'move'
      ? moveBar(values, daysBetween(drag.grabDay, drag.overDay))
      : resizeBar(values, drag.mode, drag.overDay);
  }

  private spanAfter(drag: BarDrag): EventSpan | null {
    const values = this.barValues(drag.rowId);
    const write = this.writeFor(drag);

    if (values === null) {
      return null;
    }

    return timelineSpan(write.start ?? values.start, values.end === undefined ? undefined : write.end ?? values.end);
  }

  private rowTargetAt(drag: RowDrag, y: number): RowDrag['target'] {
    for (const line of this.rowsOf('[data-blok-database-timeline-row]')) {
      const box = line.getBoundingClientRect();

      if (line.getAttribute('data-row-id') !== drag.rowId && y >= box.top && y < box.bottom) {
        return { row: line, side: y < box.top + box.height / 2 ? 'before' : 'after' };
      }
    }

    return null;
  }

  private setRowTarget(target: RowDrag['target']): void {
    const drag = this.drag;

    if (drag?.kind !== 'row') {
      return;
    }
    drag.target?.row.removeAttribute('data-drop');
    drag.target = target;
    target?.row.setAttribute('data-drop', target.side);
  }

  private readonly onPointerUp = (): void => {
    const drag = this.drag;

    this.endDrag();

    if (drag === null || !drag.active) {
      return;
    }

    this.guardNextClick(true);

    if (drag.kind === 'bar') {
      const write = this.writeFor(drag);
      const values = this.barValues(drag.rowId);
      const changed = values !== null
        && ((write.start !== undefined && write.start !== values.start) || (write.end !== undefined && write.end !== values.end));

      if (changed) {
        this.options.handlers?.writeDates(drag.rowId, write);
      }

      return;
    }

    if (drag.target === null) {
      return;
    }

    const groupKey = drag.target.row.getAttribute('data-group-key') ?? '';
    const siblings = this.rowsOf('[data-blok-database-timeline-row]')
      .filter((line) => line.getAttribute('data-group-key') === groupKey && line.getAttribute('data-row-id') !== drag.rowId);
    const at = siblings.indexOf(drag.target.row) + (drag.target.side === 'after' ? 1 : 0);

    this.options.handlers?.moveRow({
      rowId: drag.rowId,
      afterRowId: siblings[at - 1]?.getAttribute('data-row-id') ?? null,
      beforeRowId: siblings[at]?.getAttribute('data-row-id') ?? null,
      groupKey,
      fromGroupKey: drag.fromGroupKey,
    });
  };

  private readonly onDragKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      this.cancelDrag();
    }
  };

  private readonly cancelDrag = (): void => {
    const drag = this.drag;
    const wasActive = drag?.active === true;

    this.endDrag();
    if (drag?.kind === 'bar' && wasActive) {
      const values = this.barValues(drag.rowId);
      const span = values === null ? null : timelineSpan(values.start, values.end);

      if (span !== null) {
        this.previewBar({ ...drag, mode: 'move', overDay: drag.grabDay });
      }
    }
    this.guardNextClick(wasActive);
  };

  private endDrag(): void {
    const drag = this.drag;

    if (drag !== null) {
      this.partsOf(drag.rowId).forEach((el) => el.removeAttribute('data-dragging'));
      if (drag.kind === 'row') {
        drag.target?.row.removeAttribute('data-drop');
      }
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
    this.scroller?.removeEventListener('scroll', this.onScroll);
  }

  appendRow(): void {
    // The tool redraws the timeline after a row is added.
  }

  removeRow(wrapper: HTMLElement, rowId: string): void {
    wrapper.querySelectorAll('[data-blok-database-timeline-row], [data-blok-database-timeline-table-row]').forEach((el) => {
      if (el.getAttribute('data-row-id') === rowId) {
        el.remove();
      }
    });
  }

  updateRowTitle(wrapper: HTMLElement, rowId: string, title: string): void {
    const titles = [...wrapper.querySelectorAll('[data-blok-database-timeline-bar-title], [data-blok-database-timeline-table-title]')]
      .filter((el) => el.closest('[data-row-id]')?.getAttribute('data-row-id') === rowId);

    for (const titleEl of titles) {
      titleEl.textContent = title;
    }
  }
}
