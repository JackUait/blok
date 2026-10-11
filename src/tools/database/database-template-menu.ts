import type { I18n } from '../../../types';
import type { PopoverItemParams } from '../../../types/utils/popover/popover-item';
import { IconCopy, IconPage, IconPencil, IconPlus, IconTrash } from '../../components/icons';
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
}

const FREQUENCIES: readonly TemplateRepeatFrequency[] = ['daily', 'weekly', 'monthly', 'yearly'];

const capital = (word: string): string => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

/**
 * The "New" dropdown (research/05 §7): one entry per template, then an
 * empty page and "+ New template". Each entry's submenu holds what Notion
 * puts behind its "•••": use, edit, set as default, repeat, duplicate, delete.
 */
export const templateMenuItems = (host: TemplateMenuHost): PopoverItemParams[] => {
  const t = (key: string): string => host.i18n.t(`tools.database.${key}`);
  const current = host.defaultTemplateId();
  const entry = (id: string, title: string): PopoverItemParams => {
    const repeat = host.repeatOf(id);

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
                  onActivate: () => host.setRepeat(id, { frequency, interval: 1, start: repeat?.start ?? new Date().toISOString() }),
                })),
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
