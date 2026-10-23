import type { I18n } from '../../../types';
import type { PopoverItemDefaultParams, PopoverItemParams } from '../../../types/utils/popover/popover-item';
import { IconChevronLeft, IconChevronRight, IconCopy, IconPage, IconPencil, IconPlayerLoop, IconPlus, IconTrash } from '../../components/icons';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { hasEscapeLayer } from '../../components/utils/dismissable-layer';
import { onHover } from '../../components/utils/tooltip';
import { openDatabaseConfirm } from './database-confirm-dialog';
import { formatDatePart, resolveLocale, resolveWeekStart, timeZones, zoneCity, zoneOffsetText } from './cells/date-format';
import { wallTime, zonedToEpoch } from './formula/dates';
import { nextRun, repeatWeekdays, repeatZone } from './templates';
import type { TemplateRepeat, TemplateRepeatFrequency } from './types';

/** What the "New" dropdown asks of the database tool. */
export interface TemplateMenuHost {
  i18n: Pick<I18n, 't'>;
  /** The database's title, for "Templates for <name>". */
  databaseName?: () => string;
  templates: () => Array<{ id: string; title: string }>;
  defaultTemplateId: () => string | undefined;
  repeatOf: (templateId: string) => TemplateRepeat | undefined;
  newEmpty: () => void;
  newFromTemplate: (templateId: string) => void;
  addTemplate: () => void;
  editTemplate: (templateId: string) => void;
  /** Null makes an empty page the default. */
  setDefault: (templateId: string | null) => void;
  duplicate: (templateId: string) => void;
  remove: (templateId: string) => void;
}

/** What the template banner's "Duplicate every…" menu asks of the database tool. */
export interface TemplateRepeatHost {
  i18n: Pick<I18n, 't'>;
  repeat: () => TemplateRepeat | undefined;
  setRepeat: (repeat: TemplateRepeat | null) => void;
  /** Opens Edit cadence on the same button with a draft that is not saved yet. */
  editCadence: (draft: TemplateRepeat) => void;
  close: () => void;
  /** IANA zone a new or re-timed schedule keeps. Default: the viewer's. */
  timeZone?: string;
  locale?: string;
  now?: () => Date;
}

const FREQUENCIES: readonly TemplateRepeatFrequency[] = ['daily', 'weekly', 'monthly', 'yearly'];

const capital = (word: string): string => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

type Translate = (key: string, vars?: Record<string, string | number>) => string;

const translator = (i18n: Pick<I18n, 't'>): Translate => (key, vars) => i18n.t(`tools.database.${key}`, vars);

const UNIT_NAMES: Record<TemplateRepeatFrequency, string> = { daily: 'Day', weekly: 'Week', monthly: 'Month', yearly: 'Year' };

const WORKWEEK = [1, 2, 3, 4, 5];

/** Notion's "Duplicate every…" presets, in its order (research/21 shot 60). Shot 61 has Mo on for 2 Weeks. */
const PRESETS: ReadonlyArray<{ id: string; key: string; frequency: TemplateRepeatFrequency; interval: number; weekdays?: number[] }> = [
  { id: 'day', key: 'templateRepeatPresetDay', frequency: 'daily', interval: 1 },
  { id: 'weekday', key: 'templateRepeatPresetWeekday', frequency: 'weekly', interval: 1, weekdays: WORKWEEK },
  { id: 'week', key: 'templateRepeatPresetWeek', frequency: 'weekly', interval: 1 },
  { id: '2-weeks', key: 'templateRepeatPresetTwoWeeks', frequency: 'weekly', interval: 2, weekdays: [1] },
  { id: 'month', key: 'templateRepeatPresetMonth', frequency: 'monthly', interval: 1 },
  { id: '3-months', key: 'templateRepeatPresetThreeMonths', frequency: 'monthly', interval: 3 },
  { id: '6-months', key: 'templateRepeatPresetSixMonths', frequency: 'monthly', interval: 6 },
  { id: 'year', key: 'templateRepeatPresetYear', frequency: 'yearly', interval: 1 },
];

const isWorkweek = (repeat: TemplateRepeat): boolean =>
  (repeat.interval ?? 1) === 1 && repeatWeekdays(repeat)?.join() === WORKWEEK.join();

/**
 * The banner's label: "Duplicate every 2 weeks", "Duplicate every day", "Duplicate every weekday".
 * Interval 1 has its own key: a `_one` form also covers 21, 31… in some languages.
 */
export const templateRepeatSummary = (i18n: Pick<I18n, 't'>, repeat: TemplateRepeat | undefined): string => {
  const t = translator(i18n);

  if (repeat === undefined) return t('templateRepeatSummaryNone');
  if (isWorkweek(repeat)) return t('templateRepeatSummaryWeekday');
  const interval = repeat.interval ?? 1;

  return interval === 1
    ? t(`templateRepeatSummary${UNIT_NAMES[repeat.frequency]}`)
    : t(`templateRepeatSummary${UNIT_NAMES[repeat.frequency]}s`, { count: interval });
};

/** The ↻ hint in the templates list. Notion names only the unit there, even for every 2 weeks. */
const repeatHint = (t: Translate, repeat: TemplateRepeat): string => t(`templateRepeatHint${capital(repeat.frequency)}`);

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attribute?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);

  if (attribute !== undefined) node.setAttribute(attribute, '');
  if (text !== undefined) node.textContent = text;

  return node;
};

const row = (name: string, label: string, ...controls: Node[]): HTMLElement => {
  const line = el('div');

  line.setAttribute('data-blok-database-template-cadence-row', name);
  line.append(el('span', 'data-blok-database-template-cadence-label', label), ...controls);

  return line;
};

/** 1 = Monday … 7 = Sunday, on the wall calendar of `zone`. */
const isoWeekday = (ms: number, zone: string): number => {
  const w = wallTime(ms, zone);

  return ((new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay() + 6) % 7) + 1;
};

/** "Mo" from "Mon" as Notion shows; scripts without letter case keep the whole short name. */
const chipLabel = (short: string): string => {
  const letters = [...short.replace(/\.$/, '')];
  const first = letters[0] ?? '';

  return first.toLowerCase() !== first.toUpperCase() && letters.length > 2 ? letters.slice(0, 2).join('') : letters.join('');
};

/** Tomorrow at 00:00 in `zone`: Notion's preset starts "Tomorrow", "Around midnight". */
const tomorrowMidnight = (now: Date, zone: string): string => {
  const w = wallTime(now.getTime(), zone);
  const next = new Date(Date.UTC(w.year, w.month - 1, w.day + 1));

  return new Date(zonedToEpoch({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate(), hour: 0, minute: 0, second: 0, ms: 0 }, zone)).toISOString();
};

interface CadenceContext {
  t: Translate;
  locale: string;
  viewerZone: string;
  now: () => Date;
}

/** "Tomorrow, 12:00 AM", "Nov 2, 12:00 AM". Blok runs at the exact time, so there is no "between" window. */
const occurrenceText = (at: number, zone: string, c: CadenceContext): string => {
  const today = wallTime(c.now().getTime(), zone);
  const day = wallTime(at, zone);
  const dayNumber = (w: { year: number; month: number; day: number }): number => Date.UTC(w.year, w.month - 1, w.day) / 86_400_000;
  const ahead = dayNumber(day) - dayNumber(today);
  const time = new Intl.DateTimeFormat(c.locale, { hour: 'numeric', minute: '2-digit', timeZone: zone }).format(at);

  if (ahead === 0) return c.t('templateRepeatTodayAt', { time });
  if (ahead === 1) return c.t('templateRepeatTomorrowAt', { time });

  return new Intl.DateTimeFormat(c.locale, { month: 'short', day: 'numeric', ...(day.year === today.year ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit', timeZone: zone }).format(at);
};

const zoneOffset = (zone: string, c: CadenceContext): string =>
  new Intl.DateTimeFormat(c.locale, { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(c.now()).find((part) => part.type === 'timeZoneName')?.value ?? zone;

/** "Starting" reads Today / Tomorrow / "Nov 1" (shot 61 shows "Tomorrow"); another year adds it. */
const dayText = (at: number, zone: string, c: CadenceContext): string => {
  const today = wallTime(c.now().getTime(), zone);
  const day = wallTime(at, zone);
  const ahead = (Date.UTC(day.year, day.month - 1, day.day) - Date.UTC(today.year, today.month - 1, today.day)) / 86_400_000;

  if (ahead === 0) return c.t('filterDateToday');
  if (ahead === 1) return c.t('filterDateTomorrow');

  return new Intl.DateTimeFormat(c.locale, { month: 'short', day: 'numeric', ...(day.year === today.year ? {} : { year: 'numeric' }), timeZone: zone }).format(at);
};

const ORDINAL_KEYS: Partial<Record<Intl.LDMLPluralRule, string>> = { one: 'One', two: 'Two', few: 'Few' };

/** "1st", "2nd", "3rd", "4th": the locale's ordinal category picks the key. */
const ordinalText = (day: number, c: CadenceContext): string =>
  c.t(`templateRepeatOrdinal${ORDINAL_KEYS[new Intl.PluralRules(c.locale, { type: 'ordinal' }).select(day)] ?? 'Other'}`, { day });

const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** A "Label  value ›" row of Edit cadence that opens a submenu. */
const settingTitle = (name: string, label: string, valueEl: HTMLElement): HTMLElement => {
  const line = el('span');

  line.setAttribute('data-blok-database-template-cadence-setting', name);
  line.append(el('span', 'data-blok-database-template-cadence-label', label), valueEl);

  return line;
};

/** A field in a row's submenu. It owns its keys, so typing does not move the menu. */
const fieldItem = (name: string, ...controls: Node[]): PopoverItemParams => {
  const wrap = el('div', 'data-blok-database-template-cadence-field');

  wrap.setAttribute('data-blok-database-template-cadence-field', name);
  wrap.setAttribute('data-blok-keyboard-owner', '');
  wrap.append(...controls);

  return { type: PopoverItemType.Html, element: wrap, name: `template-repeat-${name}-field` };
};

/**
 * Notion's "Edit cadence" (research/21 shots 61, 64, 73): a draft that only
 * Save stores. At, Starting, Ending and Timezone are "Label  value ›" rows
 * with submenus, as in shot 61. What Notion's submenus hold was not measured,
 * so they hold Blok's controls: a time field, a date field, Never or a date,
 * and a searchable zone list.
 */
const cadencePanel = (host: TemplateRepeatHost, initial: TemplateRepeat, c: CadenceContext, unsaved: boolean): { panel: HTMLElement; settings: PopoverItemParams[]; next: HTMLElement } => {
  const { t } = c;
  // The Timezone submenu changes it.
  const live = { zone: initial.timeZone === undefined ? c.viewerZone : repeatZone(initial) };
  // The repeat comes from the document: a start that does not parse opens as a preset would.
  const draft: TemplateRepeat = Number.isNaN(Date.parse(initial.start)) ? { ...initial, start: tomorrowMidnight(c.now(), live.zone) } : { ...initial };

  if (repeatWeekdays({ frequency: 'weekly', weekdays: draft.weekdays }) === null) delete draft.weekdays;
  if (typeof draft.end !== 'string' || Number.isNaN(Date.parse(draft.end))) delete draft.end;
  const panel = el('div', 'data-blok-database-template-cadence');
  const next = el('div', 'data-blok-database-template-cadence-next');
  const save = el('button', 'data-blok-database-template-cadence-save', t('templateRepeatSave'));
  const header = el('div', 'data-blok-database-template-cadence-header');
  const every = el('input');
  const unit = el('select');
  const days = el('div', 'data-blok-database-template-cadence-days');
  const ordinal = el('select', 'data-blok-database-template-cadence-ordinal');
  const dayKind = el('select', 'data-blok-database-template-cadence-day-kind');
  const time = el('input');
  const calendar = el('div', 'data-blok-database-template-cadence-calendar');
  const endDate = el('input');
  /** The whole last day counts: a run on it is still made. */
  const endOfDay = (w: { year: number; month: number; day: number }): string =>
    new Date(zonedToEpoch({ year: w.year, month: w.month, day: w.day, hour: 23, minute: 59, second: 59, ms: 999 }, live.zone)).toISOString();
  const value = (): HTMLElement => el('span', 'data-blok-database-template-cadence-value');
  const atValue = value();
  const startValue = value();
  const endValue = value();
  const zoneValue = value();
  const longDay = new Intl.DateTimeFormat(c.locale, { weekday: 'long', timeZone: 'UTC' });
  const shortDay = new Intl.DateTimeFormat(c.locale, { weekday: 'short', timeZone: 'UTC' });
  // Jan 5 2026 was a Monday.
  const dayName = (format: Intl.DateTimeFormat, weekday: number): string => format.format(Date.UTC(2026, 0, 4 + weekday));
  const shownDays = (): number[] => repeatWeekdays({ frequency: 'weekly', weekdays: draft.weekdays }) ?? [isoWeekday(new Date(draft.start).getTime(), live.zone)];
  const startWall = (): ReturnType<typeof wallTime> => wallTime(new Date(draft.start).getTime(), live.zone);
  const isoDay = (w: { year: number; month: number; day: number }): string => `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;
  const setStart = (w: { year: number; month: number; day: number; hour: number; minute: number }): void => {
    draft.start = new Date(zonedToEpoch({ ...w, second: 0, ms: 0 }, live.zone)).toISOString();
    draft.timeZone = live.zone;
  };
  const chips = Array.from({ length: 7 }, (_, i) => {
    const weekday = i + 1;
    const chip = el('button', undefined, chipLabel(dayName(shortDay, weekday)));

    chip.type = 'button';
    chip.setAttribute('data-weekday', String(weekday));
    chip.setAttribute('aria-label', dayName(longDay, weekday));
    chip.addEventListener('click', () => {
      const on = shownDays();
      const toggled = on.includes(weekday) ? on.filter((d) => d !== weekday) : [...on, weekday];

      // Notion's look with every chip off is unmeasured: the last day stays on.
      if (toggled.length === 0) return;
      draft.weekdays = toggled.sort((a, b) => a - b);
      refresh();
    });

    return chip;
  });
  // Notion's months row (r21:233). Only "Day" is measured for its second list, so it has no other choice.
  const monthDay = row('month-day', t('templateRepeatOnThe'), ordinal, dayKind);
  const refresh = (): void => {
    const count = draft.interval ?? 1;
    const w = startWall();
    const startAt = new Date(draft.start).getTime();

    FREQUENCIES.forEach((frequency, i) => {
      const option = unit.options[i];

      if (option !== undefined) option.textContent = t(`templateRepeatUnit${UNIT_NAMES[frequency]}`, { count });
    });
    unit.value = draft.frequency;
    days.remove();
    monthDay.remove();
    if (draft.frequency === 'weekly') {
      const on = shownDays();

      chips.forEach((chip, i) => chip.setAttribute('aria-pressed', String(on.includes(i + 1))));
      everyRow.after(days);
    } else if (draft.frequency === 'monthly') {
      ordinal.value = String(w.day);
      everyRow.after(monthDay);
    }
    const fields: Array<[HTMLInputElement, string]> = [
      [time, `${pad(w.hour)}:${pad(w.minute)}`],
      [endDate, draft.end === undefined ? '' : isoDay(wallTime(Date.parse(draft.end), live.zone))],
    ];

    // Only on change: rewriting the field being typed in can reset the browser's date or time segment.
    for (const [input, text] of fields) {
      if (input.value !== text) input.value = text;
    }
    atValue.textContent = new Intl.DateTimeFormat(c.locale, { hour: 'numeric', minute: '2-digit', timeZone: live.zone }).format(startAt);
    startValue.textContent = dayText(startAt, live.zone, c);
    endValue.textContent = draft.end === undefined
      ? t('templateRepeatNever')
      : new Intl.DateTimeFormat(c.locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: live.zone }).format(Date.parse(draft.end));
    zoneValue.textContent = zoneOffset(live.zone, c);
    drawCalendar();
    const at = nextRun(draft, c.now());

    next.replaceChildren(el('div', undefined, t('templateRepeatNextOccurrence')), el('div', undefined, at === null ? '' : occurrenceText(at, live.zone, c)));
  };
  const retime = (): void => {
    const h = /^(\d{2}):(\d{2})/.exec(time.value);

    if (h === null) return;
    setStart({ ...startWall(), hour: Number(h[1]), minute: Number(h[2]) });
    refresh();
  };

  header.append(el('span', 'data-blok-database-template-cadence-title', t('templateRepeatEditCadence')), save);
  save.type = 'button';
  save.addEventListener('click', () => {
    const latest = host.repeat();
    const lastRunAt = latest?.lastRunAt ?? draft.lastRunAt;
    const saved: TemplateRepeat = { ...draft };

    if (lastRunAt === undefined) delete saved.lastRunAt;
    else saved.lastRunAt = lastRunAt;
    host.setRepeat(saved);
    host.close();
  });

  every.type = 'number';
  every.min = '1';
  every.value = String(draft.interval ?? 1);
  every.setAttribute('aria-label', t('templateRepeatEvery'));
  // `input`, not `change`: a popover closed by Escape removes the field without a blur.
  every.addEventListener('input', () => {
    const text = every.value.trim();
    const interval = Number(text);

    if (text === '' || !Number.isInteger(interval) || interval < 1) return;
    if (interval === 1) delete draft.interval;
    else draft.interval = interval;
    refresh();
  });
  unit.setAttribute('aria-label', t('templateRepeatEvery'));
  unit.append(...FREQUENCIES.map((frequency) => {
    const option = el('option');

    option.value = frequency;

    return option;
  }));
  unit.addEventListener('change', () => {
    const frequency = FREQUENCIES.find((f) => f === unit.value);

    if (frequency === undefined || frequency === draft.frequency) return;
    draft.frequency = frequency;
    delete draft.weekdays;
    refresh();
  });
  days.append(...chips);

  ordinal.setAttribute('aria-label', t('templateRepeatOnThe'));
  ordinal.append(...Array.from({ length: 31 }, (_, i) => {
    const option = el('option', undefined, ordinalText(i + 1, c));

    option.value = String(i + 1);

    return option;
  }));
  // Monthly runs keep the start's day of the month, so the day moves the start: to the first such day on or after it.
  ordinal.addEventListener('change', () => {
    const day = Number(ordinal.value);
    const w = startWall();

    if (!Number.isInteger(day) || day === w.day) return;
    const month = Array.from({ length: 13 }, (_, i) => new Date(Date.UTC(w.year, w.month - 1 + i, 1)))
      .find((first, i) => day <= daysInMonth(first.getUTCFullYear(), first.getUTCMonth() + 1) && (i > 0 || day > w.day));

    if (month === undefined) return;
    setStart({ year: month.getUTCFullYear(), month: month.getUTCMonth() + 1, day, hour: w.hour, minute: w.minute });
    refresh();
  });
  dayKind.setAttribute('aria-label', t('templateRepeatDayOfMonth'));
  dayKind.append(el('option', undefined, t('templateRepeatDayOfMonth')));

  time.type = 'time';
  time.setAttribute('aria-label', t('templateRepeatAt'));
  time.addEventListener('input', retime);
  endDate.type = 'date';
  endDate.setAttribute('aria-label', t('templateRepeatEnding'));
  endDate.addEventListener('input', () => {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endDate.value);

    if (d === null) return;
    draft.end = endOfDay({ year: Number(d[1]), month: Number(d[2]), day: Number(d[3]) });
    refresh();
  });

  // The month the Starting grid shows. It follows the start until the arrows move it.
  const view = { year: startWall().year, month: startWall().month, start: draft.start };
  const weekStart = resolveWeekStart(c.locale);
  const monthName = new Intl.DateTimeFormat(c.locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const weekdayName = new Intl.DateTimeFormat(c.locale, { weekday: 'short', timeZone: 'UTC' });
  const step = (attribute: string, icon: string, key: string, months: number): HTMLButtonElement => {
    const button = el('button', attribute);

    button.type = 'button';
    button.setAttribute('aria-label', t(key));
    button.innerHTML = icon;
    button.addEventListener('click', () => {
      const first = new Date(Date.UTC(view.year, view.month - 1 + months, 1));

      view.year = first.getUTCFullYear();
      view.month = first.getUTCMonth() + 1;
      drawCalendar();
    });

    return button;
  };
  /** The cell date picker's month grid, without Today and without a time (research/35:400). */
  function drawCalendar(): void {
    const w = startWall();
    const today = wallTime(c.now().getTime(), live.zone);
    const header = el('div', 'data-blok-database-date-header');
    const grid = el('div', 'data-blok-database-date-grid');
    const weekdays = el('div');

    // A new start shows its own month.
    if (view.start !== draft.start) Object.assign(view, { start: draft.start, year: w.year, month: w.month });
    const first = new Date(Date.UTC(view.year, view.month - 1, 1));
    const lead = (first.getUTCDay() - weekStart + 7) % 7;

    header.append(
      el('span', 'data-blok-database-date-month', monthName.format(first)),
      step('data-blok-database-date-prev', IconChevronLeft, 'datePreviousMonth', -1),
      step('data-blok-database-date-next', IconChevronRight, 'dateNextMonth', 1)
    );
    grid.setAttribute('role', 'grid');
    weekdays.setAttribute('role', 'row');
    weekdays.append(...Array.from({ length: 7 }, (_, i) => {
      const cell = el('span', 'data-blok-database-date-weekday');

      cell.setAttribute('role', 'columnheader');
      // 4 January 2026 was a Sunday.
      cell.textContent = weekdayName.format(Date.UTC(2026, 0, 4 + ((weekStart + i) % 7)));

      return cell;
    }));
    grid.append(weekdays, ...Array.from({ length: 6 }, (_, week) => {
      const line = el('div');

      line.setAttribute('role', 'row');
      line.append(...Array.from({ length: 7 }, (__, d) => {
        const shown = new Date(Date.UTC(view.year, view.month - 1, 1 + week * 7 + d - lead));
        const day = { year: shown.getUTCFullYear(), month: shown.getUTCMonth() + 1, day: shown.getUTCDate() };
        const iso = isoDay(day);
        const button = el('button', undefined, String(day.day));

        button.type = 'button';
        button.setAttribute('role', 'gridcell');
        button.setAttribute('data-blok-database-date-day', iso);
        button.setAttribute('aria-selected', String(iso === isoDay(w)));
        button.setAttribute('aria-label', formatDatePart(iso, c.locale));
        if (day.month !== view.month) button.setAttribute('data-outside', '');
        if (iso === isoDay(today)) button.setAttribute('data-today', '');
        button.addEventListener('click', () => {
          const kept = startWall();

          setStart({ ...day, hour: kept.hour, minute: kept.minute });
          refresh();
        });

        return button;
      }));

      return line;
    }));
    const focused = document.activeElement;
    // A redraw replaces the focused button: keyboard focus moves to its new copy.
    const refocus = focused instanceof HTMLElement && calendar.contains(focused)
      ? ['data-blok-database-date-prev', 'data-blok-database-date-next', 'data-blok-database-date-day'].find((name) => focused.hasAttribute(name))
      : undefined;
    const value = refocus === undefined ? null : focused?.getAttribute(refocus);

    calendar.replaceChildren(header, grid);
    if (refocus !== undefined) calendar.querySelector<HTMLElement>(value === '' ? `[${refocus}]` : `[${refocus}="${value ?? ''}"]`)?.focus();
  }

  const zones = timeZones();
  const zoneHeading = (key: string): HTMLElement => {
    const heading = el('div', 'data-blok-database-date-zone-heading', t(key));

    heading.setAttribute('role', 'presentation');

    return heading;
  };
  const currentHeading = zoneHeading('timeZoneCurrent');
  const zoneItem = (id: string): PopoverItemDefaultParams => {
    const city = zoneCity(id);
    const titleEl = el('span', 'data-blok-database-template-cadence-zone', city);

    titleEl.append(el('span', 'data-blok-database-template-cadence-zone-offset', zoneOffsetText(id, c.now())));

    return {
      name: `template-repeat-zone-${id}`,
      title: city,
      titleEl,
      searchTerms: [id],
      // One check: the viewer's zone is checked under "Current timezone" only.
      isActive: () => live.zone === id && id !== c.viewerZone,
      onActivate: () => {
        // A new zone keeps the start's wall time and the end's last day, and moves the instants.
        const w = startWall();
        const endDay = draft.end === undefined ? undefined : wallTime(Date.parse(draft.end), live.zone);

        live.zone = id;
        setStart(w);
        if (endDay !== undefined) draft.end = endOfDay(endDay);
        refresh();
      },
    };
  };
  const everyRow = row('every', t('templateRepeatEvery'), every, unit);
  const settings: PopoverItemParams[] = [
    { name: 'template-repeat-at', title: t('templateRepeatAt'), titleEl: settingTitle('at', t('templateRepeatAt'), atValue), children: { items: [fieldItem('at', time)] } },
    { type: PopoverItemType.Separator },
    { name: 'template-repeat-starting', title: t('templateRepeatStarting'), titleEl: settingTitle('starting', t('templateRepeatStarting'), startValue), children: { width: '268px', items: [fieldItem('starting', calendar)] } },
    {
      name: 'template-repeat-ending',
      title: t('templateRepeatEnding'),
      titleEl: settingTitle('ending', t('templateRepeatEnding'), endValue),
      children: {
        items: [
          { name: 'template-repeat-ending-never', title: t('templateRepeatNever'), isActive: () => draft.end === undefined, onActivate: () => { delete draft.end; refresh(); } },
          fieldItem('ending', endDate),
        ],
      },
    },
    {
      name: 'template-repeat-timezone',
      title: t('templateRepeatTimezone'),
      titleEl: settingTitle('timezone', t('templateRepeatTimezone'), zoneValue),
      children: {
        searchable: true,
        // The search field's placeholder comes from the parent popover's messages; this submenu reads as the date editor's.
        onOpen: () => {
          const search = currentHeading.closest('[data-blok-popover]')?.querySelector('[data-blok-field="search"] input');

          if (search instanceof HTMLInputElement) search.placeholder = t('timeZoneSearch');
        },
        items: [
          { type: PopoverItemType.Html, element: currentHeading, name: 'template-repeat-timezone-current-heading' },
          { ...zoneItem(c.viewerZone), name: 'template-repeat-current-zone', isActive: () => live.zone === c.viewerZone },
          { type: PopoverItemType.Html, element: zoneHeading('timeZoneSelect'), name: 'template-repeat-timezone-select-heading' },
          ...(zones.includes(live.zone) ? zones : [live.zone, ...zones]).map(zoneItem),
        ],
      },
    },
  ];

  panel.setAttribute('data-blok-keyboard-owner', '');
  panel.append(header, everyRow);
  refresh();
  const pristine = JSON.stringify(draft);
  // Window capture runs before the popover registry's Escape backstop, as CellPopover does.
  const onEscape = (event: KeyboardEvent): void => {
    if (!panel.isConnected) {
      window.removeEventListener('keydown', onEscape, true);

      return;
    }
    // The open dialog's own layer takes this Escape.
    if (event.key !== 'Escape' || event.isComposing || hasEscapeLayer() || (!unsaved && JSON.stringify(draft) === pristine)) return;
    event.preventDefault();
    event.stopPropagation();
    const root = panel.closest<HTMLElement>('[data-blok-popover]');

    void openDatabaseConfirm({
      title: t('templateRepeatDiscardTitle'),
      confirmLabel: t('layoutDiscard'),
      cancelLabel: t('layoutCancel'),
      destructive: true,
      filled: true,
      focusConfirm: true,
      directionSource: panel,
      // Inside the popover: focus on a dialog outside it would close the popover.
      // The top layer keeps it above the popover and an open submenu.
      ...(root === null ? {} : { container: root, topLayer: true }),
    }).then((discard) => {
      if (discard) host.close();
    });
  };

  window.addEventListener('keydown', onEscape, true);

  return { panel, settings, next };
};

/**
 * The template banner's "Duplicate every…" menu (research/21 §3): Notion's
 * presets while the template does not repeat; a preset opens Edit cadence
 * with a draft. Once it repeats, or with a draft, Edit cadence itself.
 */
export const templateRepeatItems = (host: TemplateRepeatHost, draft?: TemplateRepeat): PopoverItemParams[] => {
  const c: CadenceContext = {
    t: translator(host.i18n),
    locale: resolveLocale(host.locale),
    viewerZone: host.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    now: host.now ?? ((): Date => new Date()),
  };
  const editing = draft ?? host.repeat();

  if (editing === undefined) {
    return PRESETS.map((preset): PopoverItemParams => ({
      name: `template-repeat-${preset.id}`,
      title: c.t(preset.key),
      closeOnActivate: true,
      onActivate: () => host.editCadence({
        frequency: preset.frequency,
        ...(preset.interval === 1 ? {} : { interval: preset.interval }),
        ...(preset.weekdays === undefined ? {} : { weekdays: [...preset.weekdays] }),
        start: tomorrowMidnight(c.now(), c.viewerZone),
        timeZone: c.viewerZone,
      }),
    }));
  }
  // A preset's draft is unsaved from the start.
  const { panel, settings, next } = cadencePanel(host, editing, c, draft !== undefined);

  return [
    { type: PopoverItemType.Html, element: panel, name: 'template-repeat-cadence' },
    ...settings,
    { type: PopoverItemType.Separator },
    { name: 'template-repeat-cancel', title: c.t('templateRepeatCancel'), closeOnActivate: true, onActivate: () => host.setRepeat(null) },
    { type: PopoverItemType.Separator },
    { type: PopoverItemType.Html, element: next, name: 'template-repeat-next' },
  ];
};

/** The name, then ↻ when the template repeats. */
const repeatingTitle = (title: string, hint: string): HTMLElement => {
  const el = document.createElement('span');
  const icon = document.createElement('span');

  icon.setAttribute('data-blok-database-template-repeat-icon', '');
  icon.setAttribute('role', 'img');
  icon.setAttribute('aria-label', hint);
  icon.innerHTML = IconPlayerLoop;
  onHover(icon, hint, { placement: 'top' });
  el.append(title, icon);

  return el;
};

/** research/27:44: the default template reads "Default" after its name. */
const defaultTitle = (titleEl: HTMLElement | undefined, title: string, label: string): HTMLElement => {
  const el = titleEl ?? document.createElement('span');
  const badge = document.createElement('span');

  if (titleEl === undefined) el.append(title);
  badge.setAttribute('data-blok-database-template-default', '');
  badge.textContent = label;
  // The space keeps the accessible name "New task Default", not "New taskDefault".
  el.append(' ', badge);

  return el;
};

/**
 * The "New" dropdown (research/05 §7): one entry per template, then an
 * empty page and "+ New template". A click on an entry makes a row; its
 * "…" opens use, edit, set as default, duplicate, delete.
 * Repeat lives in the template's banner, as in Notion (research/21 §3).
 */
export const templateMenuItems = (host: TemplateMenuHost): PopoverItemParams[] => {
  const t = translator(host.i18n);
  const current = host.defaultTemplateId();
  const entry = (id: string, title: string): PopoverItemParams => {
    const repeat = host.repeatOf(id);
    const shown = title === '' ? t('templateUntitled') : title;
    const titleEl = repeat === undefined ? undefined : repeatingTitle(shown, repeatHint(t, repeat));
    const marked = current === id ? defaultTitle(titleEl, shown, t('templateDefault')) : titleEl;

    return {
      name: `template-${id}`,
      title: shown,
      ...(marked === undefined ? {} : { titleEl: marked }),
      icon: IconPage,
      // research/33 §3.8: a click makes a row; research/30 X1: "…" opens the rest on click.
      closeOnActivate: true,
      onActivate: () => host.newFromTemplate(id),
      children: {
        moreButton: { label: t('templateMore') },
        items: [
          { name: `template-${id}-use`, title: t('templateUse'), icon: IconPlus, closeOnActivate: true, onActivate: () => host.newFromTemplate(id) },
          { name: `template-${id}-edit`, title: t('templateEdit'), icon: IconPencil, closeOnActivate: true, onActivate: () => host.editTemplate(id) },
          { name: `template-${id}-default`, title: t('templateSetDefault'), isActive: current === id, closeOnActivate: true, onActivate: () => host.setDefault(id) },
          { name: `template-${id}-duplicate`, title: t('templateDuplicate'), icon: IconCopy, closeOnActivate: true, onActivate: () => host.duplicate(id) },
          { name: `template-${id}-delete`, title: t('templateDelete'), icon: IconTrash, isDestructive: true, closeOnActivate: true, onActivate: () => host.remove(id) },
        ],
      },
    };
  };
  const line = (attribute: string, text: string): HTMLElement => {
    const el = document.createElement('div');

    el.setAttribute(attribute, '');
    el.textContent = text;

    return el;
  };
  const templates = host.templates();
  // Notion heads the panel and lists "Empty page" only beside real templates (findings V23).
  const empty: PopoverItemParams[] = templates.length === 0 ? [] : [{
      name: 'template-empty',
      title: t('templateEmptyPage'),
      icon: IconPage,
      closeOnActivate: true,
      onActivate: () => host.newEmpty(),
      children: {
        // The hint of Empty's "…" was not measured.
        moreButton: { label: t('tableMoreActions') },
        items: [
          { name: 'template-empty-use', title: t('templateUse'), icon: IconPlus, closeOnActivate: true, onActivate: () => host.newEmpty() },
          { name: 'template-empty-default', title: t('templateSetDefault'), isActive: current === undefined, closeOnActivate: true, onActivate: () => host.setDefault(null) },
        ],
      },
    }];

  return [
    { type: PopoverItemType.Html, name: 'template-header', element: line('data-blok-database-template-header', t('templatesFor', { name: host.databaseName?.() ?? '' })) },
    { type: PopoverItemType.Html, name: 'template-description', element: line('data-blok-database-template-description', t('templatesDescription')) },
    { type: PopoverItemType.Separator },
    ...templates.map((template) => entry(template.id, template.title)),
    ...empty,
    ...(templates.length === 0 ? [] : [{ type: PopoverItemType.Separator } as const]),
    { name: 'template-add', title: t('templateNew'), icon: IconPlus, closeOnActivate: true, onActivate: () => host.addTemplate() },
  ];
};
