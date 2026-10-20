import type { I18n } from '../../../types';
import type { PopoverItemParams } from '../../../types/utils/popover/popover-item';
import { IconCopy, IconPage, IconPencil, IconPlayerLoop, IconPlus, IconTrash } from '../../components/icons';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { onHover } from '../../components/utils/tooltip';
import { wallTime, zonedToEpoch } from './formula/dates';
import { repeatZone } from './templates';
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
  /** IANA zone a new or re-timed schedule keeps. Default: the viewer's. */
  timeZone?: string;
}

const FREQUENCIES: readonly TemplateRepeatFrequency[] = ['daily', 'weekly', 'monthly', 'yearly'];

const capital = (word: string): string => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

type Translate = (key: string, vars?: Record<string, string | number>) => string;

const translator = (i18n: Pick<I18n, 't'>): Translate => (key, vars) => i18n.t(`tools.database.${key}`, vars);

/** Plural keys: `_one` / `_other` and whatever forms each language adds. */
const EVERY_KEYS: Record<TemplateRepeatFrequency, string> = { daily: 'templateRepeatEveryDay', weekly: 'templateRepeatEveryWeek', monthly: 'templateRepeatEveryMonth', yearly: 'templateRepeatEveryYear' };

const UNIT_NAMES: Record<TemplateRepeatFrequency, string> = { daily: 'Day', weekly: 'Week', monthly: 'Month', yearly: 'Year' };

/** Notion's "Duplicate every…" presets, in its order. Weekday is left out: a schedule has no weekdays yet. */
const PRESETS: ReadonlyArray<{ id: string; key: string; frequency: TemplateRepeatFrequency; interval: number }> = [
  { id: 'day', key: 'templateRepeatPresetDay', frequency: 'daily', interval: 1 },
  { id: 'week', key: 'templateRepeatPresetWeek', frequency: 'weekly', interval: 1 },
  { id: '2-weeks', key: 'templateRepeatPresetTwoWeeks', frequency: 'weekly', interval: 2 },
  { id: 'month', key: 'templateRepeatPresetMonth', frequency: 'monthly', interval: 1 },
  { id: '3-months', key: 'templateRepeatPresetThreeMonths', frequency: 'monthly', interval: 3 },
  { id: '6-months', key: 'templateRepeatPresetSixMonths', frequency: 'monthly', interval: 6 },
  { id: 'year', key: 'templateRepeatPresetYear', frequency: 'yearly', interval: 1 },
];

/**
 * The banner's label: "Duplicate every 2 weeks", "Duplicate every day".
 * Interval 1 has its own key: a `_one` form also covers 21, 31… in some languages.
 */
export const templateRepeatSummary = (i18n: Pick<I18n, 't'>, repeat: TemplateRepeat | undefined): string => {
  const t = translator(i18n);

  if (repeat === undefined) return t('templateRepeatSummaryNone');
  const interval = repeat.interval ?? 1;

  return interval === 1
    ? t(`templateRepeatSummary${UNIT_NAMES[repeat.frequency]}`)
    : t(`templateRepeatSummary${UNIT_NAMES[repeat.frequency]}s`, { count: interval });
};

/** The ↻ hint in the templates list. Notion names only the unit there, even for every 2 weeks. */
const repeatHint = (t: Translate, repeat: TemplateRepeat): string => t(`templateRepeatHint${capital(repeat.frequency)}`);

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** The keyboard-owner attribute keeps Blok's editor keydown handling out of the fields. */
const fieldRow = (tag: 'label' | 'div', name: string): HTMLElement => {
  const row = document.createElement(tag);

  row.setAttribute('data-blok-database-property-menu-field', name);
  row.setAttribute('data-blok-keyboard-owner', '');

  return row;
};

const input = (type: string, value: string, onInput: (value: string) => void): HTMLInputElement => {
  const el = document.createElement('input');

  el.type = type;
  el.value = value;
  // `input`, not `change`: a popover closed by Escape removes the field without a blur.
  el.addEventListener('input', () => onInput(el.value.trim()));

  return el;
};

/** "Every [N] weeks", worded by the plural form the language picks for N. */
const intervalField = (name: string, t: Translate, repeat: TemplateRepeat, save: (patch: Partial<TemplateRepeat>) => void): PopoverItemParams => {
  const row = fieldRow('label', name);
  const before = document.createTextNode('');
  const after = document.createTextNode('');
  // Every plural form holds {count} once and no other digit (plural-forms.test.ts), so the first run of N's digits is the slot.
  const word = (count: number): void => {
    const text = t(EVERY_KEYS[repeat.frequency], { count });
    const at = text.indexOf(String(count));

    before.data = at < 0 ? text : text.slice(0, at);
    after.data = at < 0 ? '' : text.slice(at + String(count).length);
  };
  const field = input('number', String(repeat.interval ?? 1), (text) => {
    const interval = Number(text);

    if (text !== '' && Number.isInteger(interval) && interval >= 1) {
      word(interval);
      save({ interval });
    }
  });

  field.setAttribute('min', '1');
  word(repeat.interval ?? 1);
  row.append(before, field, after);

  return { type: PopoverItemType.Html, element: row, name };
};

/**
 * Start date and time, on the wall clock of the schedule's zone. A schedule
 * with no zone is shown in the viewer's and takes it on its first edit.
 */
const startField = (name: string, t: Translate, repeat: TemplateRepeat, viewerZone: string, save: (patch: Partial<TemplateRepeat>) => void): PopoverItemParams => {
  const zone = repeat.timeZone === undefined ? viewerZone : repeatZone(repeat);
  const w = wallTime(new Date(repeat.start).getTime(), zone);
  const row = fieldRow('div', name);
  const date = input('date', `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`, () => commit());
  const time = input('time', `${pad(w.hour)}:${pad(w.minute)}`, () => commit());
  const commit = (): void => {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.value);
    const h = /^(\d{2}):(\d{2})/.exec(time.value);

    if (d === null || h === null) return;
    const ms = zonedToEpoch({ year: Number(d[1]), month: Number(d[2]), day: Number(d[3]), hour: Number(h[1]), minute: Number(h[2]), second: 0, ms: 0 }, zone);

    save({ start: new Date(ms).toISOString(), timeZone: zone });
  };

  date.setAttribute('aria-label', t('dateStart'));
  time.setAttribute('aria-label', t('dateTime'));
  row.append(t('dateStart'), date, time);

  return { type: PopoverItemType.Html, element: row, name };
};

/**
 * The template banner's "Duplicate every…" menu (research/21 §3): Notion's
 * presets while the template does not repeat, then the schedule's fields
 * and "Cancel recurrence".
 */
export const templateRepeatItems = (host: TemplateRepeatHost): PopoverItemParams[] => {
  const t = translator(host.i18n);
  const viewerZone = host.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const repeat = host.repeat();

  if (repeat === undefined) {
    return PRESETS.map((preset): PopoverItemParams => ({
      name: `template-repeat-${preset.id}`,
      title: t(preset.key),
      closeOnActivate: true,
      onActivate: () => host.setRepeat({
        frequency: preset.frequency,
        ...(preset.interval === 1 ? {} : { interval: preset.interval }),
        start: new Date().toISOString(),
        timeZone: viewerZone,
      }),
    }));
  }
  // Reads the stored schedule again: an earlier edit in the same open menu must survive.
  const patchRepeat = (patch: Partial<TemplateRepeat>): void => {
    const latest = host.repeat();

    if (latest !== undefined) host.setRepeat({ ...latest, ...patch });
  };

  return [
    intervalField('template-repeat-interval', t, repeat, patchRepeat),
    ...FREQUENCIES.map((frequency): PopoverItemParams => ({
      name: `template-repeat-${frequency}`,
      title: t(`templateRepeat${capital(frequency)}`),
      isActive: repeat.frequency === frequency,
      closeOnActivate: true,
      // A spread keeps `lastRunAt`: without it the latest past run would be offered again.
      onActivate: () => host.setRepeat({ ...repeat, frequency }),
    })),
    { type: PopoverItemType.Separator },
    startField('template-repeat-start', t, repeat, viewerZone, patchRepeat),
    { type: PopoverItemType.Separator },
    { name: 'template-repeat-cancel', title: t('templateRepeatCancel'), closeOnActivate: true, onActivate: () => host.setRepeat(null) },
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
