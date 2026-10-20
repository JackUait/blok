import type { I18n } from '../../../types';
import type { PopoverItemParams } from '../../../types/utils/popover/popover-item';
import { IconCopy, IconPage, IconPencil, IconPlayerLoop, IconPlus, IconTrash } from '../../components/icons';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { onHover } from '../../components/utils/tooltip';
import { resolveLocale } from './cells/date-format';
import { wallTime, zonedToEpoch } from './formula/dates';
import { nextRun, repeatZone } from './templates';
import type { TemplateRepeat, TemplateRepeatFrequency } from './types';

/** What the "New" dropdown asks of the database tool. */
export interface TemplateMenuHost {
  i18n: Pick<I18n, 't'>;
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
  repeat.frequency === 'weekly' && (repeat.interval ?? 1) === 1 && Array.isArray(repeat.weekdays)
  && [...new Set(repeat.weekdays)].sort((a, b) => a - b).join() === WORKWEEK.join();

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

/**
 * Notion's "Edit cadence" (research/21 shots 61, 64, 73): a draft that only
 * Save stores. At, Starting, Ending and Timezone open submenus in Notion that
 * were not measured, so At and Starting keep Blok's time and date fields and
 * Ending and Timezone only show their value.
 */
const cadencePanel = (host: TemplateRepeatHost, initial: TemplateRepeat, c: CadenceContext): { panel: HTMLElement; next: HTMLElement } => {
  const { t } = c;
  const zone = initial.timeZone === undefined ? c.viewerZone : repeatZone(initial);
  const draft: TemplateRepeat = { ...initial };
  const panel = el('div', 'data-blok-database-template-cadence');
  const next = el('div', 'data-blok-database-template-cadence-next');
  const save = el('button', 'data-blok-database-template-cadence-save', t('templateRepeatSave'));
  const header = el('div', 'data-blok-database-template-cadence-header');
  const every = el('input');
  const unit = el('select');
  const days = el('div', 'data-blok-database-template-cadence-days');
  const startWall = wallTime(new Date(initial.start).getTime(), zone);
  const date = el('input');
  const time = el('input');
  const longDay = new Intl.DateTimeFormat(c.locale, { weekday: 'long', timeZone: 'UTC' });
  const shortDay = new Intl.DateTimeFormat(c.locale, { weekday: 'short', timeZone: 'UTC' });
  // Jan 5 2026 was a Monday.
  const dayName = (format: Intl.DateTimeFormat, weekday: number): string => format.format(Date.UTC(2026, 0, 4 + weekday));
  const shownDays = (): number[] => {
    const set = Array.isArray(draft.weekdays) ? draft.weekdays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7) : [];

    return set.length > 0 ? set : [isoWeekday(new Date(draft.start).getTime(), zone)];
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
  const refresh = (): void => {
    const count = draft.interval ?? 1;

    FREQUENCIES.forEach((frequency, i) => {
      const option = unit.options[i];

      if (option !== undefined) option.textContent = t(`templateRepeatUnit${UNIT_NAMES[frequency]}`, { count });
    });
    unit.value = draft.frequency;
    if (draft.frequency === 'weekly') {
      const on = shownDays();

      chips.forEach((chip, i) => chip.setAttribute('aria-pressed', String(on.includes(i + 1))));
      if (days.parentElement !== panel) everyRow.after(days);
    } else {
      days.remove();
    }
    const at = nextRun(draft, c.now());

    next.replaceChildren(el('div', undefined, t('templateRepeatNextOccurrence')), el('div', undefined, at === null ? '' : occurrenceText(at, zone, c)));
  };
  const retime = (): void => {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.value);
    const h = /^(\d{2}):(\d{2})/.exec(time.value);

    if (d === null || h === null) return;
    const ms = zonedToEpoch({ year: Number(d[1]), month: Number(d[2]), day: Number(d[3]), hour: Number(h[1]), minute: Number(h[2]), second: 0, ms: 0 }, zone);

    draft.start = new Date(ms).toISOString();
    draft.timeZone = zone;
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

  date.type = 'date';
  date.value = `${pad(startWall.year, 4)}-${pad(startWall.month)}-${pad(startWall.day)}`;
  date.setAttribute('aria-label', t('templateRepeatStarting'));
  date.addEventListener('input', retime);
  time.type = 'time';
  time.value = `${pad(startWall.hour)}:${pad(startWall.minute)}`;
  time.setAttribute('aria-label', t('templateRepeatAt'));
  time.addEventListener('input', retime);

  const value = (text: string): HTMLElement => el('span', 'data-blok-database-template-cadence-value', text);
  const end = typeof draft.end === 'string' && !Number.isNaN(Date.parse(draft.end))
    ? new Intl.DateTimeFormat(c.locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: zone }).format(Date.parse(draft.end))
    : t('templateRepeatNever');
  const everyRow = row('every', t('templateRepeatEvery'), every, unit);

  panel.setAttribute('data-blok-keyboard-owner', '');
  panel.append(
    header,
    everyRow,
    row('at', t('templateRepeatAt'), time),
    el('hr'),
    row('starting', t('templateRepeatStarting'), date),
    row('ending', t('templateRepeatEnding'), value(end)),
    row('timezone', t('templateRepeatTimezone'), value(zoneOffset(zone, c))),
  );
  refresh();

  return { panel, next };
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
  const { panel, next } = cadencePanel(host, editing, c);

  return [
    { type: PopoverItemType.Html, element: panel, name: 'template-repeat-cadence' },
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

/**
 * The "New" dropdown (research/05 §7): one entry per template, then an
 * empty page and "+ New template". Each entry's submenu holds what Notion
 * puts behind its "•••": use, edit, set as default, duplicate, delete.
 * Repeat lives in the template's banner, as in Notion (research/21 §3).
 */
export const templateMenuItems = (host: TemplateMenuHost): PopoverItemParams[] => {
  const t = translator(host.i18n);
  const current = host.defaultTemplateId();
  const entry = (id: string, title: string): PopoverItemParams => {
    const repeat = host.repeatOf(id);
    const shown = title === '' ? t('templateUntitled') : title;

    return {
      name: `template-${id}`,
      title: shown,
      ...(repeat === undefined ? {} : { titleEl: repeatingTitle(shown, repeatHint(t, repeat)) }),
      icon: IconPage,
      children: {
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
  return [
    ...host.templates().map((template) => entry(template.id, template.title)),
    {
      name: 'template-empty',
      title: t('templateEmptyPage'),
      icon: IconPage,
      children: {
        items: [
          { name: 'template-empty-use', title: t('templateUse'), icon: IconPlus, closeOnActivate: true, onActivate: () => host.newEmpty() },
          { name: 'template-empty-default', title: t('templateSetDefault'), isActive: current === undefined, closeOnActivate: true, onActivate: () => host.setDefault(null) },
        ],
      },
    },
    { name: 'template-add', title: t('templateNew'), icon: IconPlus, closeOnActivate: true, onActivate: () => host.addTemplate() },
  ];
};
