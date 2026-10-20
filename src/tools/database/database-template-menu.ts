import type { I18n } from '../../../types';
import type { PopoverItemParams } from '../../../types/utils/popover/popover-item';
import { IconCopy, IconPage, IconPencil, IconPlus, IconTrash } from '../../components/icons';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
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
  setRepeat: (templateId: string, repeat: TemplateRepeat | null) => void;
  duplicate: (templateId: string) => void;
  remove: (templateId: string) => void;
  /** IANA zone a new or re-timed schedule keeps. Default: the viewer's. */
  timeZone?: string;
}

const FREQUENCIES: readonly TemplateRepeatFrequency[] = ['daily', 'weekly', 'monthly', 'yearly'];

const capital = (word: string): string => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Plural keys: `_one` / `_other` and whatever forms each language adds. */
const EVERY_KEYS: Record<TemplateRepeatFrequency, string> = { daily: 'templateRepeatEveryDay', weekly: 'templateRepeatEveryWeek', monthly: 'templateRepeatEveryMonth', yearly: 'templateRepeatEveryYear' };

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
 * The "New" dropdown (research/05 §7): one entry per template, then an
 * empty page and "+ New template". Each entry's submenu holds what Notion
 * puts behind its "•••": use, edit, set as default, repeat, duplicate, delete.
 */
export const templateMenuItems = (host: TemplateMenuHost): PopoverItemParams[] => {
  const t: Translate = (key, vars) => host.i18n.t(`tools.database.${key}`, vars);
  const current = host.defaultTemplateId();
  const viewerZone = host.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const entry = (id: string, title: string): PopoverItemParams => {
    const repeat = host.repeatOf(id);
    // Reads the stored schedule again: an earlier edit in the same open menu must survive.
    const patchRepeat = (patch: Partial<TemplateRepeat>): void => {
      const latest = host.repeatOf(id);

      if (latest !== undefined) host.setRepeat(id, { ...latest, ...patch });
    };
    const scheduleFields: PopoverItemParams[] = repeat === undefined
      ? []
      : [
        { type: PopoverItemType.Separator },
        intervalField(`template-${id}-repeat-interval`, t, repeat, patchRepeat),
        startField(`template-${id}-repeat-start`, t, repeat, viewerZone, patchRepeat),
      ];

    return {
      name: `template-${id}`,
      title: title === '' ? t('templateUntitled') : title,
      icon: IconPage,
      children: {
        items: [
          { name: `template-${id}-use`, title: t('templateUse'), icon: IconPlus, closeOnActivate: true, onActivate: () => host.newFromTemplate(id) },
          { name: `template-${id}-edit`, title: t('templateEdit'), icon: IconPencil, closeOnActivate: true, onActivate: () => host.editTemplate(id) },
          { name: `template-${id}-default`, title: t('templateSetDefault'), isActive: current === id, closeOnActivate: true, onActivate: () => host.setDefault(id) },
          {
            name: `template-${id}-repeat`,
            title: t('templateRepeat'),
            children: {
              items: [
                { name: `template-${id}-repeat-off`, title: t('templateRepeatOff'), isActive: repeat === undefined, closeOnActivate: true, onActivate: () => host.setRepeat(id, null) },
                ...FREQUENCIES.map((frequency): PopoverItemParams => ({
                  name: `template-${id}-repeat-${frequency}`,
                  title: t(`templateRepeat${capital(frequency)}`),
                  isActive: repeat?.frequency === frequency,
                  closeOnActivate: true,
                  // A spread keeps `lastRunAt`: without it the latest past run would be offered again.
                  onActivate: () => host.setRepeat(id, repeat === undefined ? { frequency, start: new Date().toISOString(), timeZone: viewerZone } : { ...repeat, frequency }),
                })),
                ...scheduleFields,
              ],
            },
          },
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
