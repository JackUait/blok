import type { I18n } from '../../../types';
import type { DatabaseViewRenderer } from './database-view-renderer';
import { fileChipIcon, pageIconElement, pagePlaceholderIcon, showsPageIcon } from './page-icon';
import { propertyTypeMeta } from './database-property-types';
import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition, SelectOption, TimelineZoom } from './types';
import type { GalleryDropResult } from './database-gallery-view';
import { createOptionPill, renderCellValue } from './cells';
import { showAvatarsOnly } from './avatar-only';
import { rowCellContext } from './reminders';
import type { CellContext } from './cells';
import { readPropertyValue } from './property-values';
import { addDays, daysBetween, isWeekend } from './calendar-dates';
import { formatShortDatePart, resolveLocale, toLocalDate } from './cells/date-format';
import { hide as hideReadout, showReadout } from '../../components/utils/tooltip';
import type { EventSpan } from './calendar-dates';
import {
  TIMELINE_DAY_WIDTH,
  barGeometry,
  hourBarGeometry,
  headerUnits,
  moveBar,
  newBarWrite,
  offscreenSide,
  resizeBar,
  resizeBarByMinutes,
  snapMinutes,
  timedEdges,
  timelineSpan,
  timelineWindow,
  visibleRange,
  zoomStep,
} from './timeline-dates';
import type { BarValues, BarWrite, TimelineWindow } from './timeline-dates';
import { resolveCalculations, resolveCountCaps, resolveShowTimelineTable, resolveTimelineTableProperties, resolveTimelineZoom, resolveViewProperties } from './view-settings';
import { fillCalculationCell } from './database-table-view';
import { isHistoryKey } from './database-keyboard';
import { getElementDirection } from '../../components/utils/direction';
import { startInlineRename } from '../../components/utils/inline-rename';
import { syncCommentBadge } from './database-comment-badge';
import type { CommentBadges } from './database-comment-badge';
import { openNoDatePanel } from './database-no-date';
import type { NoDateControl } from './database-no-date';
import type { DatabasePanel } from './database-panel';
import { IconArrowLeftSmall, IconArrowRightSmall, IconCalendar, IconChevronDoubleRight, IconChevronDown, IconChevronLeft, IconChevronRight, IconMenu, IconPlus } from '../../components/icons';

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
  /** Cmd/Ctrl- or Shift-click on a row: add it to the selection instead of opening it. */
  pickRow?: (rowId: string, range: boolean) => void;
  /** Arrow keys on the bars: the selection becomes exactly these rows, as in the list and gallery. */
  lassoRows?: (rowIds: string[]) => void;
  /** Group key, or null when the timeline is not grouped; the new bar's dates. */
  addRow: (groupKey: string | null, write: BarWrite) => void;
  /** A title typed into a new bar. */
  renameRow?: (rowId: string, title: string) => void;
  /** New stored values for the start and/or end property. */
  writeDates: (rowId: string, write: BarWrite) => void;
  moveRow: (result: GalleryDropResult) => void;
  setZoom: (zoom: TimelineZoom) => void;
  openZoomMenu: (anchor: HTMLElement) => void;
  /** Redraw centred on `day`. */
  navigate: (day: string) => void;
  toggleTable: () => void;
  loadMore: (groupKey: string) => void;
  /** A link drawn from one bar's handle onto another: `from` now blocks `to`. */
  link?: (fromRowId: string, toRowId: string) => void;
  /** A table panel footer cell was clicked: pick its calculation. */
  openCalculationMenu?: (anchor: HTMLElement, propertyId: string) => void;
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
  /** What cells need from the host: relation titles, computed result types. */
  cellContext?: Partial<CellContext>;
  /** Dependency arrows (the view's `arrowsBy`), from the blocking row to the blocked one. */
  arrows?: Array<{ from: string; to: string }>;
  /** Sub-item depth of a row, for the indent of nested rows. */
  depthOf?: (rowId: string) => number;
  /** Comment counts. Only the table panel rows show a badge; bars never do (research/22 §11). */
  commentBadges?: CommentBadges;
  /** The host's "Manage in Calendar" (`config.calendar`), a toolbar button. Read-only keeps it. */
  manageInCalendar?: { label: string; onClick: () => void };
}

const DRAG_THRESHOLD = 4;
const DAY_MINUTES = 24 * 60;
const BAR_INSET = 1.5;
/** findings C07: Notion's "+ New" made a 5-day bar. */
const NEW_BAR_DAYS = 5;
/** Within this share of either canvas end, a scroll redraws around a new centre. */
const EDGE_SHARE = 0.1;
/** Zooms whose days are wide enough to shade weekends one by one. */
const DAY_LEVEL: ReadonlySet<TimelineZoom> = new Set(['hours', 'day', 'week', 'bi_week', 'month']);
/** Zooms whose header shows day numbers only: the month is named in the toolbar. */
const MONTH_IN_TOOLBAR: ReadonlySet<TimelineZoom> = new Set(['day', 'week', 'bi_week', 'month']);

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
  /** Pixels from the canvas start; hours zoom reads minutes from them. */
  grabPx: number;
  startX: number;
  startY: number;
  active: boolean;
  overDay: string;
  overPx: number;
}

interface LinkDrag {
  kind: 'link';
  rowId: string;
  startX: number;
  startY: number;
  active: boolean;
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
  private drag: BarDrag | RowDrag | LinkDrag | null = null;
  private suppressClick = false;
  private selectionAnchor: HTMLElement | null = null;
  private recentring = false;
  private noDatePanel: DatabasePanel | null = null;

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
    root.style.setProperty('--blok-database-timeline-header-rows', MONTH_IN_TOOLBAR.has(this.zoom) ? '1' : '2');
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
    toggle.innerHTML = IconChevronDoubleRight;

    const month = document.createElement('div');

    month.setAttribute('data-blok-database-timeline-month', '');
    month.textContent = this.monthLabel(this.options.center);

    const spacer = document.createElement('div');

    spacer.setAttribute('data-blok-database-timeline-toolbar-spacer', '');

    const zoom = document.createElement('button');

    zoom.type = 'button';
    zoom.setAttribute('data-blok-database-timeline-zoom', '');
    zoom.setAttribute('aria-haspopup', 'menu');
    zoom.textContent = this.t(ZOOM_KEYS[this.zoom]);
    zoom.insertAdjacentHTML('beforeend', IconChevronDown);

    const today = document.createElement('button');

    today.type = 'button';
    today.setAttribute('data-blok-database-timeline-today', '');
    today.textContent = this.t('tools.database.timelineToday');
    const step = (attr: string, label: string, icon: string): HTMLButtonElement => {
      const el = document.createElement('button');

      el.type = 'button';
      el.setAttribute(attr, '');
      el.setAttribute('aria-label', this.t(label));
      el.innerHTML = icon;

      return el;
    };

    bar.append(toggle, month, spacer);

    const calendar = this.options.manageInCalendar;

    if (calendar !== undefined) {
      const manage = document.createElement('button');

      manage.type = 'button';
      manage.setAttribute('data-blok-database-timeline-manage-calendar', '');
      manage.innerHTML = IconCalendar;
      manage.append(calendar.label);
      // Its own listener: the root's click handling needs edit handlers, and read-only has none.
      manage.addEventListener('click', () => calendar.onClick());
      bar.append(manage);
    }
    bar.append(
      zoom,
      step('data-blok-database-timeline-prev', 'tools.database.timelinePrevious', IconChevronLeft),
      today,
      step('data-blok-database-timeline-next', 'tools.database.timelineNext', IconChevronRight)
    );

    return bar;
  }

  /** The database toolbar's "No date (N)" (findings C03). Undefined when every item has a date, or read-only. */
  noDateControl(): NoDateControl | undefined {
    const rows = this.sections.flatMap((group) => group.rows).filter((row) => this.spanOf(row) === null);
    const handlers = this.options.handlers;

    if (rows.length === 0 || !this.canEdit || handlers === undefined) {
      return undefined;
    }

    return {
      count: rows.length,
      label: this.options.i18n.t('tools.database.calendarNoDate', { count: String(rows.length) }),
      open: (anchor) => {
        this.noDatePanel = openNoDatePanel({
          anchor,
          i18n: this.options.i18n,
          rows,
          titlePropertyId: this.options.titlePropertyId,
          hint: this.t('tools.database.timelineNoDateHint'),
          pick: (rowId) => handlers.writeDates(rowId, this.newBar()),
          open: (rowId) => handlers.openRow(rowId),
        });
      },
    };
  }

  /**
   * A new bar: NEW_BAR_DAYS long from the second day on screen. Notion's rule
   * is unmeasured; this matches its one measured case (screen from Oct 14, bar Oct 15–19).
   */
  private newBar(): BarWrite {
    const viewport = this.scroller?.clientWidth ?? 0;
    const start = viewport > 0
      ? addDays(visibleRange({ scrollStart: this.scrollStart, viewport, windowStart: this.window.start, zoom: this.zoom }).first, 1)
      : this.options.today;

    return newBarWrite(start, NEW_BAR_DAYS, this.options.endPropertyId !== undefined);
  }

  private monthLabel(day: string): string {
    return new Intl.DateTimeFormat(resolveLocale(this.options.locale), { month: 'long', year: 'numeric' }).format(toLocalDate(day));
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

      const glyph = document.createElement('span');

      cell.setAttribute('data-property-id', property.id);
      glyph.setAttribute('data-blok-database-timeline-table-header-icon', '');
      glyph.setAttribute('aria-hidden', 'true');
      glyph.innerHTML = propertyTypeMeta(property.type).icon;
      cell.append(glyph, property.name);
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
    if (this.canEdit) {
      const add = document.createElement('button');

      add.type = 'button';
      add.setAttribute('data-blok-database-timeline-table-new', '');
      add.innerHTML = IconPlus;
      add.append(this.t('tools.database.timelineNew'));
      panel.appendChild(add);
    }
    panel.appendChild(this.createTableFooter(properties));

    return panel;
  }

  private createTableFooter(properties: PropertyDefinition[]): HTMLElement {
    const footer = document.createElement('div');
    const shown = (property: PropertyDefinition): PropertyDefinition => this.options.cellContext?.valueProperty?.(property) ?? property;
    const calculations = resolveCalculations(this.options.view, this.options.schema.map(shown));
    const caps = resolveCountCaps(this.options.view);
    const rows = this.sections.flatMap((group) => group.rows);
    const handlers = this.options.handlers;

    footer.setAttribute('data-blok-database-timeline-table-footer', '');
    for (const property of properties) {
      const cell = document.createElement(this.canEdit && property.type !== 'button' ? 'button' : 'div');

      cell.setAttribute('data-blok-database-table-calc', '');
      cell.setAttribute('data-property-id', property.id);
      cell.setAttribute('data-type', property.type);
      if (cell instanceof HTMLButtonElement) {
        cell.type = 'button';
        cell.addEventListener('click', () => handlers?.openCalculationMenu?.(cell, property.id));
      }
      fillCalculationCell(cell, {
        fn: calculations.get(property.id), property, shown: shown(property), rows, i18n: this.options.i18n, locale: this.options.locale, capCounts: caps.has(property.id),
      });
      footer.appendChild(cell);
    }

    return footer;
  }

  private createTableRow(row: DatabaseRow, properties: PropertyDefinition[]): HTMLElement {
    const line = document.createElement('div');

    line.setAttribute('data-blok-database-timeline-table-row', '');
    line.setAttribute('data-row-id', row.id);
    const depth = this.options.depthOf?.(row.id) ?? 0;

    if (depth > 0) {
      line.setAttribute('data-subitem-depth', String(depth));
      line.style.setProperty('--blok-database-subitem-depth', String(depth));
    }
    for (const property of properties) {
      const cell = document.createElement('div');

      cell.setAttribute('data-property-id', property.id);
      if (property.id === this.options.titlePropertyId) {
        this.fillTitleCell(cell, row);
      } else {
        cell.appendChild(renderCellValue(property, readPropertyValue(row, property), {
          ...this.options.cellContext,
          i18n: this.options.i18n,
          readOnly: true,
          locale: this.options.locale,
          ...rowCellContext(row, property.id),
        }));
      }
      line.appendChild(cell);
    }

    return line;
  }

  /** The whole cell opens the row; the text span anchors the comment badge. */
  private fillTitleCell(cell: HTMLElement, row: DatabaseRow): void {
    const title = document.createElement('span');

    cell.setAttribute('data-blok-database-timeline-table-title', '');
    title.setAttribute('data-blok-database-timeline-table-title-text', '');
    title.textContent = this.titleOf(row);
    cell.append(pageIconElement(row) ?? pagePlaceholderIcon(), title);
    if (this.options.commentBadges !== undefined) {
      syncCommentBadge(title, row.id, this.options.commentBadges, this.options.i18n);
    }
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
    const tableShown = resolveShowTimelineTable(this.options.view);

    for (const group of this.sections) {
      if (this.options.grouped) {
        canvas.appendChild(this.createGroupHeader(group, 'canvas'));
      }
      // findings C03: with the table hidden, an undated item has no lane; the toolbar's "No date" lists it.
      for (const row of group.rows.filter((r) => tableShown || this.spanOf(r) !== null)) {
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
    if ((this.options.arrows ?? []).length > 0) {
      canvas.appendChild(this.createArrows());
    }
    if (this.canEdit) {
      canvas.appendChild(this.createNewLane());
    }
    scroller.appendChild(canvas);

    return scroller;
  }

  /** findings C07: "+ New" is the canvas's last 36px lane. */
  private createNewLane(): HTMLElement {
    const lane = document.createElement('div');
    const add = document.createElement('button');

    lane.setAttribute('data-blok-database-timeline-new-lane', '');
    // With the table shown, "+ New" is the panel's last row; this lane only keeps the rows lined up.
    if (resolveShowTimelineTable(this.options.view)) {
      return lane;
    }
    add.type = 'button';
    add.setAttribute('data-blok-database-timeline-new', '');
    add.innerHTML = IconPlus;
    add.append(this.t('tools.database.timelineNew'));
    lane.appendChild(add);

    return lane;
  }

  /**
   * findings C07: a new bar's title is typed in the bar. Enter keeps the bar
   * selected; Escape keeps the name and leaves nothing selected.
   */
  editTitle(rowId: string): void {
    const barEl = this.rowsOf('[data-blok-database-timeline-bar]').find((el) => el.getAttribute('data-row-id') === rowId);
    const titleEl = barEl?.querySelector<HTMLElement>('[data-blok-database-timeline-bar-title]');

    if (!this.canEdit || barEl === undefined || titleEl === null || titleEl === undefined) {
      return;
    }
    const original = titleEl.textContent ?? '';
    const escaped = { value: false };

    startInlineRename({
      target: titleEl,
      currentValue: original,
      allowEmpty: true,
      escapeCommits: true,
      label: this.t('tools.database.editCardTitle'),
      configureInput: (input) => {
        input.setAttribute('data-blok-database-timeline-title-input', '');
        input.setAttribute('placeholder', this.t('tools.database.cardNamePlaceholder'));
        input.addEventListener('keydown', (event) => {
          escaped.value = event.key === 'Escape';
        });
      },
      buildRestored: (title) => this.createBarTitle(title),
      onCommit: (title) => {
        if (title !== original) {
          this.options.handlers?.renameRow?.(rowId, title);
        }
        if (!escaped.value) {
          this.options.handlers?.pickRow?.(rowId, false);
        }
      },
    });
  }

  private createBarTitle(title: string): HTMLElement {
    const titleEl = document.createElement('span');

    titleEl.setAttribute('data-blok-database-timeline-bar-title', '');
    titleEl.textContent = title;
    if (title === '') {
      titleEl.setAttribute('data-placeholder', this.t('tools.database.cardTitlePlaceholder'));
    }

    return titleEl;
  }

  /**
   * One elbow per dependency: out of the blocker's end, down (or up) to the
   * blocked row, into its start. Days place it across; rows place it down,
   * once the canvas has a layout. An arrow into an item that starts before
   * its blocker ends is a conflict.
   */
  private createArrows(): HTMLElement {
    const layer = document.createElement('div');

    layer.setAttribute('data-blok-database-timeline-arrows', '');
    layer.setAttribute('aria-hidden', 'true');
    for (const { from, to } of this.options.arrows ?? []) {
      const source = this.findRow(from);
      const target = this.findRow(to);
      const fromSpan = source === undefined ? null : this.spanOf(source);
      const toSpan = target === undefined ? null : this.spanOf(target);

      if (fromSpan === null || toSpan === null) continue;
      const out = barGeometry(fromSpan, this.window.start, this.zoom);
      const into = barGeometry(toSpan, this.window.start, this.zoom);
      const arrow = document.createElement('div');

      arrow.setAttribute('data-blok-database-timeline-arrow', '');
      arrow.setAttribute('data-from', from);
      arrow.setAttribute('data-to', to);
      arrow.toggleAttribute('data-conflict', toSpan.start <= fromSpan.end);
      arrow.style.setProperty('--blok-database-arrow-from', `${out.offset + out.width}px`);
      arrow.style.setProperty('--blok-database-arrow-to', `${into.offset}px`);
      for (const part of ['out', 'cross', 'in', 'head']) {
        const segment = document.createElement('div');

        segment.setAttribute('data-blok-database-timeline-arrow-part', part);
        arrow.appendChild(segment);
      }
      layer.appendChild(arrow);
    }
    queueMicrotask(() => this.placeArrows(layer));

    return layer;
  }

  /** The rows' vertical middles, read from the layout. */
  private placeArrows(layer: HTMLElement): void {
    const middle = (rowId: string | null): number | null => {
      const line = this.rowsOf('[data-blok-database-timeline-row]').find((el) => el.getAttribute('data-row-id') === rowId);

      return line === undefined ? null : line.offsetTop + line.offsetHeight / 2;
    };

    layer.querySelectorAll<HTMLElement>('[data-blok-database-timeline-arrow]').forEach((arrow) => {
      const y1 = middle(arrow.getAttribute('data-from'));
      const y2 = middle(arrow.getAttribute('data-to'));

      if (y1 === null || y2 === null) return;
      arrow.style.setProperty('--blok-database-arrow-y1', `${y1}px`);
      arrow.style.setProperty('--blok-database-arrow-y2', `${y2}px`);
    });
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
    // findings C06: at day-level zooms the toolbar names the month, so the header has no month row.
    if (!MONTH_IN_TOOLBAR.has(this.zoom)) {
      header.append(line('data-blok-database-timeline-groups', groups));
    }
    header.append(line('data-blok-database-timeline-units', units));

    const todayIndex = daysBetween(this.window.start, this.options.today);

    if (todayIndex >= 0 && todayIndex < this.window.days) {
      const dot = document.createElement('div');

      dot.setAttribute('data-blok-database-timeline-today-dot', '');
      dot.style.insetInlineStart = `${todayIndex * this.dayWidth + this.dayWidth / 2}px`;
      dot.textContent = new Intl.DateTimeFormat(this.options.locale ?? 'en-US', { day: 'numeric' }).format(toLocalDate(this.options.today));
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
    arrow.innerHTML = side === 'before' ? IconArrowLeftSmall : IconArrowRightSmall;

    return arrow;
  }

  private createBar(row: DatabaseRow, span: EventSpan, tabbable: boolean): HTMLElement {
    const el = document.createElement('div');
    const { offset, width } = this.geometryOf(span, this.valuesOf(row));
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

    const chip = document.createElement('span');

    chip.setAttribute('data-blok-database-timeline-bar-chip', '');
    chip.setAttribute('aria-hidden', 'true');
    chip.innerHTML = IconArrowLeftSmall;
    el.appendChild(chip);

    const titleEl = this.createBarTitle(title);
    const icon = showsPageIcon(this.options.view) ? pageIconElement(row) : null;

    if (icon !== null) {
      el.appendChild(icon);
    }
    el.appendChild(titleEl);

    for (const property of this.barProperties()) {
      const cell = renderCellValue(property, readPropertyValue(row, property), {
        ...this.options.cellContext,
        i18n: this.options.i18n,
        readOnly: true,
        locale: this.options.locale,
        ...rowCellContext(row, property.id),
      });

      showAvatarsOnly(cell);
      cell.querySelectorAll('[data-blok-database-file-chip]').forEach((chip) => chip.prepend(fileChipIcon()));
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
    if (this.canEdit && this.options.handlers?.link !== undefined) {
      const link = document.createElement('span');

      // Just past the end edge, so it never takes the resize zone.
      link.setAttribute('data-blok-database-timeline-link-handle', '');
      link.setAttribute('aria-hidden', 'true');
      link.innerHTML = IconChevronRight;
      el.appendChild(link);
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

    const month = this.root?.querySelector('[data-blok-database-timeline-month]');

    if (month !== null && month !== undefined && this.scroller.clientWidth > 0) {
      month.textContent = this.monthLabel(range.first);
    }

    for (const line of this.rowsOf('[data-blok-database-timeline-row]')) {
      const row = this.findRow(line.getAttribute('data-row-id') ?? '');
      const span = row === undefined ? null : this.spanOf(row);
      const side = span === null || this.scroller.clientWidth === 0 ? null : offscreenSide(span, range);

      line.querySelectorAll('[data-blok-database-timeline-offscreen]').forEach((arrow) => {
        arrow.toggleAttribute('hidden', arrow.getAttribute('data-blok-database-timeline-offscreen') !== side);
      });
      const barStart = row === undefined || span === null ? null : this.geometryOf(span, this.valuesOf(row)).offset;

      line.querySelector('[data-blok-database-timeline-bar]')
        ?.toggleAttribute('data-clipped-start', barStart !== null && side === null && barStart < this.scrollStart);
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

  private stepScreen(direction: 1 | -1): void {
    this.scrollStart = this.scrollStart + direction * (this.scroller?.clientWidth ?? 0);
  }

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
      // Unmeasured in Notion: the step is one screen.
      ['[data-blok-database-timeline-prev]', () => this.stepScreen(-1)],
      ['[data-blok-database-timeline-next]', () => this.stepScreen(1)],
      ['[data-blok-database-timeline-new], [data-blok-database-timeline-table-new]', () => {
        if (this.canEdit) {
          handlers.addRow(this.options.grouped ? this.options.groups[0]?.key ?? null : null, this.newBar());
        }
      }],
      ['[data-blok-database-timeline-load-more]', (el) => handlers.loadMore(el.getAttribute('data-group-key') ?? '')],
      ['[data-blok-database-timeline-offscreen], [data-blok-database-timeline-bar-chip]', (el) => this.jumpTo(el.closest('[data-row-id]')?.getAttribute('data-row-id') ?? '')],
      ['[data-blok-database-timeline-table-title], [data-blok-database-timeline-bar]', (el) => {
        const rowId = el.closest('[data-row-id]')?.getAttribute('data-row-id');

        if (rowId === null || rowId === undefined) {
          return;
        }
        if ((event.metaKey || event.ctrlKey || event.shiftKey) && handlers.pickRow !== undefined) {
          handlers.pickRow(rowId, event.shiftKey);
        } else {
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

    // Notion: Left and Right leave the bars and the canvas alone. Panning is Shift+wheel and drag.
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();

      return;
    }

    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && target.hasAttribute('data-blok-database-timeline-bar')) {
      const all = this.rowsOf('[data-blok-database-timeline-bar]');
      const next = all[all.indexOf(target) + (event.key === 'ArrowDown' ? 1 : -1)];

      event.preventDefault();
      if (next !== undefined) {
        all.forEach((el) => el.setAttribute('tabindex', el === next ? '0' : '-1'));
        next.focus();
        this.selectByKey(all, next, event.shiftKey ? this.selectionAnchor ?? target : next);
      }
    }
  };

  /** Arrows select the bar they reach; Shift+Arrow selects from the anchor to it. The halo is the gray selection. */
  private selectByKey(bars: HTMLElement[], target: HTMLElement, anchor: HTMLElement): void {
    const lasso = this.options.handlers?.lassoRows;

    if (this.options.readOnly || lasso === undefined) {
      return;
    }
    // A redraw may have dropped the old anchor: start again from the target.
    const start = bars.includes(anchor) ? anchor : target;
    const [from, to] = [bars.indexOf(start), bars.indexOf(target)].sort((a, b) => a - b);

    this.selectionAnchor = start;
    lasso(bars.slice(from, to + 1).map((el) => el.getAttribute('data-row-id') ?? ''));
  }

  /** Pixels from the canvas start to a pointer, from the canvas box. */
  private canvasOffset(x: number): number {
    const box = this.root?.querySelector('[data-blok-database-timeline-canvas]')?.getBoundingClientRect();
    const edge = this.rtl ? (box?.right ?? 0) - x : x - (box?.left ?? 0);

    return box === undefined ? 0 : edge;
  }

  /** The day under a pointer. */
  private dayAt(x: number): string {
    return addDays(this.window.start, Math.floor(this.canvasOffset(x) / this.dayWidth));
  }


  /** Hours zoom places a timed value by its time; every other case by whole days. */
  private geometryOf(span: EventSpan, values: BarValues): { offset: number; width: number } {
    const geometry = (this.zoom === 'hours' ? hourBarGeometry(values, this.window.start) : null) ?? barGeometry(span, this.window.start, this.zoom);

    // findings C23: at day-level zooms a bar sits 1.5px in from each day edge (37px of a 40px day).
    return MONTH_IN_TOOLBAR.has(this.zoom) ? { offset: geometry.offset + BAR_INSET, width: geometry.width - 2 * BAR_INSET } : geometry;
  }

  private valuesOf(row: DatabaseRow): BarValues {
    const endId = this.options.endPropertyId;

    return { start: this.options.startPropertyId === undefined ? undefined : row.properties[this.options.startPropertyId], end: endId === undefined ? undefined : row.properties[endId] ?? null };
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

    if (event.target.closest('[data-blok-database-timeline-link-handle]') !== null) {
      this.drag = { kind: 'link', rowId, startX: event.clientX, startY: event.clientY, active: false };
      this.listen();

      return;
    }

    const edge = event.target.closest('[data-blok-database-timeline-resize]')?.getAttribute('data-blok-database-timeline-resize');
    const grabDay = this.dayAt(event.clientX);
    const grabPx = this.canvasOffset(event.clientX);

    this.drag = {
      kind: 'bar',
      rowId,
      mode: edge === 'start' || edge === 'end' ? edge : 'move',
      grabDay,
      grabPx,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      overDay: grabDay,
      overPx: grabPx,
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
      this.root?.setAttribute('data-dragging', drag.kind === 'bar' ? drag.mode : drag.kind);
      this.partsOf(drag.rowId).forEach((el) => el.setAttribute('data-dragging', ''));
    }

    if (drag.kind === 'bar') {
      drag.overDay = this.dayAt(event.clientX);
      drag.overPx = this.canvasOffset(event.clientX);
      this.previewBar(drag);

      return;
    }
    if (drag.kind === 'link') {
      this.setLinkTarget(this.linkTargetAt(event.clientX, event.clientY, drag.rowId));

      return;
    }

    this.setRowTarget(this.rowTargetAt(drag, event.clientY));
  };

  private partsOf(rowId: string): HTMLElement[] {
    return this.rowsOf('[data-blok-database-timeline-bar], [data-blok-database-timeline-row]')
      .filter((el) => el.getAttribute('data-row-id') === rowId);
  }

  /**
   * Writes the bar's would-be place on the bar itself while dragging. At
   * hours zoom a move is a ghost that follows the pointer and snaps only on
   * drop, and a resize snaps live with a readout of the dragged edge
   * (research/22 §9).
   */
  private previewBar(drag: BarDrag): void {
    const ghost = this.zoom === 'hours' && drag.mode === 'move';
    const values = ghost ? this.barValues(drag.rowId) : this.valuesAfter(drag);
    const span = values === null ? null : timelineSpan(values.start, values.end);
    const barEl = this.rowsOf('[data-blok-database-timeline-bar]').find((el) => el.getAttribute('data-row-id') === drag.rowId);

    if (span === null || values === null || barEl === undefined) {
      return;
    }

    const { offset, width } = this.geometryOf(span, values);

    barEl.style.insetInlineStart = `${ghost ? offset + drag.overPx - drag.grabPx : offset}px`;
    barEl.style.width = `${width}px`;
    if (!drag.active) {
      return;
    }
    // The pill spans whole days, whatever inset the bar has.
    this.showRange(span, this.zoom === 'hours' ? { offset, width } : barGeometry(span, this.window.start, this.zoom));
    if (this.zoom === 'hours' && drag.mode !== 'move') {
      this.showEdgeReadout(barEl, drag.mode, values, span);
    }
    if (this.zoom !== 'hours' && drag.mode !== 'move') {
      this.showDayReadout(barEl, drag.mode, span);
    }
  }

  /** findings C15: a pill over the dragged range's day numbers; its first and last day in ink. */
  private showRange(span: EventSpan, { offset, width }: { offset: number; width: number }): void {
    const header = this.root?.querySelector('[data-blok-database-timeline-header]');

    if (header === null || header === undefined) {
      return;
    }
    const pill = header.querySelector<HTMLElement>('[data-blok-database-timeline-range]') ?? document.createElement('div');

    pill.setAttribute('data-blok-database-timeline-range', '');
    pill.style.insetInlineStart = `${offset}px`;
    pill.style.width = `${width}px`;
    if (!pill.isConnected) {
      header.prepend(pill);
    }
    header.querySelectorAll('[data-blok-database-timeline-units] > [data-day]').forEach((label) => {
      const day = label.getAttribute('data-day');

      label.toggleAttribute('data-range-edge', day === span.start || day === span.end);
    });
  }

  /** findings C15: the moving edge's day in 12px ink just outside the bar. */
  private showDayReadout(barEl: HTMLElement, edge: 'start' | 'end', span: EventSpan): void {
    const readout = barEl.querySelector<HTMLElement>('[data-blok-database-timeline-edge-readout]') ?? document.createElement('span');

    readout.setAttribute('data-blok-database-timeline-edge-readout', edge);
    readout.setAttribute('aria-hidden', 'true');
    readout.textContent = formatShortDatePart(span[edge], resolveLocale(this.options.locale));
    if (!readout.isConnected) {
      barEl.appendChild(readout);
    }
  }

  private clearDragMarks(): void {
    this.root?.querySelectorAll('[data-blok-database-timeline-range], [data-blok-database-timeline-edge-readout]').forEach((el) => el.remove());
    this.root?.querySelectorAll('[data-range-edge]').forEach((el) => el.removeAttribute('data-range-edge'));
  }

  private showEdgeReadout(barEl: HTMLElement, edge: 'start' | 'end', values: BarValues, span: EventSpan): void {
    const handle = barEl.querySelector<HTMLElement>(`[data-blok-database-timeline-resize="${edge}"]`);

    if (handle === null) {
      return;
    }
    // The physical side of the dragged edge, so the text sits outside the bar.
    const before = (edge === 'start') !== this.rtl;
    const part = timedEdges(values)?.[edge] ?? span[edge];

    showReadout(handle, formatShortDatePart(part, resolveLocale(this.options.locale)), { placement: before ? 'left' : 'right' });
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

    const deltaDays = daysBetween(drag.grabDay, drag.overDay);

    if (this.zoom !== 'hours') {
      return drag.mode === 'move' ? moveBar(values, deltaDays) : resizeBar(values, drag.mode, drag.overDay);
    }

    const deltaMinutes = snapMinutes((drag.overPx - drag.grabPx) / (this.dayWidth / DAY_MINUTES));

    return drag.mode === 'move'
      ? moveBar(values, deltaDays, deltaMinutes)
      : resizeBarByMinutes(values, drag.mode, deltaMinutes) ?? resizeBar(values, drag.mode, drag.overDay);
  }

  private valuesAfter(drag: BarDrag): BarValues | null {
    const values = this.barValues(drag.rowId);
    const write = this.writeFor(drag);

    if (values === null) {
      return null;
    }

    return { start: write.start ?? values.start, end: values.end === undefined ? undefined : write.end ?? values.end };
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

  /** The other bar under the pointer while a link is drawn. */
  private linkTargetAt(x: number, y: number, fromRowId: string): HTMLElement | null {
    const bar = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-blok-database-timeline-bar]') ?? null;

    return bar === null || bar.getAttribute('data-row-id') === fromRowId || !(this.root?.contains(bar) ?? false) ? null : bar;
  }

  private setLinkTarget(bar: HTMLElement | null): void {
    this.rowsOf('[data-blok-database-timeline-bar][data-link-target]').forEach((el) => el.removeAttribute('data-link-target'));
    bar?.setAttribute('data-link-target', '');
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    const drag = this.drag;

    this.endDrag();

    if (drag === null || !drag.active) {
      return;
    }

    this.guardNextClick(true);

    if (drag.kind === 'link') {
      const to = this.linkTargetAt(event.clientX, event.clientY, drag.rowId)?.getAttribute('data-row-id');

      this.setLinkTarget(null);
      if (typeof to === 'string') {
        this.options.handlers?.link?.(drag.rowId, to);
      }

      return;
    }

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
    // The editor's undo would rewrite rows under the drag.
    if (isHistoryKey(event)) {
      event.preventDefault();
    }
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
        this.previewBar({ ...drag, mode: 'move', active: false, overDay: drag.grabDay, overPx: drag.grabPx });
      }
    }
    this.guardNextClick(wasActive);
  };

  private endDrag(): void {
    const drag = this.drag;

    if (drag !== null) {
      this.partsOf(drag.rowId).forEach((el) => el.removeAttribute('data-dragging'));
      if (drag.kind === 'link') {
        this.setLinkTarget(null);
      }
      if (drag.kind === 'row') {
        drag.target?.row.removeAttribute('data-drop');
      }
      if (drag.kind === 'bar' && drag.active && drag.mode !== 'move') {
        hideReadout();
      }
      this.clearDragMarks();
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
    this.noDatePanel?.close();
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
    const titles = [...wrapper.querySelectorAll('[data-blok-database-timeline-bar-title], [data-blok-database-timeline-table-title-text]')]
      .filter((el) => el.closest('[data-row-id]')?.getAttribute('data-row-id') === rowId);

    for (const titleEl of titles) {
      titleEl.textContent = title;
    }
  }
}
