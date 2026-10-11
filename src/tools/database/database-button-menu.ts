import { nanoid } from 'nanoid';
import type { I18n } from '../../../types';
import type { PopoverItemParams } from '../../../types/utils/popover/popover-item';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { isReadOnlyType, orderedStatusOptions } from './property-values';
import type { ButtonAction, ButtonSettings, PropertyDefinition, PropertySettingsV2, PropertyValue } from './types';

export interface ButtonMenuContext {
  i18n: Pick<I18n, 't'>;
  schema: () => PropertyDefinition[];
  /** The host set `config.buttons.onAction`. */
  hasHostActions: boolean;
  update: (patch: Partial<PropertySettingsV2>) => void;
}

/** One value a button can write, with its label key and label params. */
export interface ValueChoice {
  key: string;
  label?: string;
  value: PropertyValue;
}

/** What "Edit property" can set a property to. `@today` and `@me` are filled in on click. */
export const valueChoicesFor = (property: PropertyDefinition): ValueChoice[] => {
  const clear: ValueChoice = { key: 'tools.database.buttonValueClear', value: property.type === 'person' || property.type === 'multiSelect' ? [] : null };
  const options = property.type === 'status' ? orderedStatusOptions(property) : (property.config?.options ?? []);
  const byType: Partial<Record<PropertyDefinition['type'], ValueChoice[]>> = {
    checkbox: [{ key: 'tools.database.buttonValueChecked', value: true }, { key: 'tools.database.buttonValueUnchecked', value: false }],
    select: [...options.map((o) => ({ key: '', label: o.label, value: o.id })), clear],
    status: [...options.map((o) => ({ key: '', label: o.label, value: o.id })), clear],
    multiSelect: [...options.map((o) => ({ key: '', label: o.label, value: [o.id] })), clear],
    date: [{ key: 'tools.database.buttonValueToday', value: '@today' }, clear],
    person: [{ key: 'tools.database.buttonValueMe', value: [{ id: '@me' }] }, clear],
  };

  return byType[property.type] ?? [clear];
};

/** A button action before it gets its id. */
type NewAction = ButtonAction extends infer A ? A extends ButtonAction ? Omit<A, 'id'> : never : never;

const ACTION_KEYS: Record<ButtonAction['type'], string> = {
  editProperty: 'tools.database.buttonActionEditProperty',
  insertBlocks: 'tools.database.buttonActionInsertBlocks',
  openPage: 'tools.database.buttonActionOpenPage',
  callback: 'tools.database.buttonActionCallback',
};

const textField = (name: string, label: string, value: string, onChange: (value: string) => void): PopoverItemParams => {
  const wrap = document.createElement('label');
  const input = document.createElement('input');

  wrap.setAttribute('data-blok-database-property-menu-field', name);
  wrap.setAttribute('data-blok-keyboard-owner', '');
  wrap.append(label);
  input.type = 'text';
  input.value = value;
  input.addEventListener('change', () => onChange(input.value.trim()));
  wrap.appendChild(input);

  return { type: PopoverItemType.Html, element: wrap, name };
};

/** "Edit property" for a button: its label, its actions and "Add action". */
export const buttonEditItems = (property: PropertyDefinition, ctx: ButtonMenuContext): PopoverItemParams[] => {
  const t = (key: string): string => ctx.i18n.t(key);
  const settings: ButtonSettings = property.button ?? {};
  const actions = settings.buttonActions ?? [];
  const save = (next: ButtonAction[], label = settings.label): void =>
    ctx.update({ button: { ...(label !== undefined ? { label } : {}), buttonActions: next } });
  const add = (action: NewAction): void => save([...actions, { ...action, id: nanoid() }]);
  const nameOf = (id: string): string => ctx.schema().find((p) => p.id === id)?.name ?? '';
  const describe = (action: ButtonAction): string => {
    const base = t(ACTION_KEYS[action.type] ?? 'tools.database.buttonActionUnknown');

    if (action.type === 'editProperty') return `${base}: ${nameOf(action.propertyId)}`;
    if (action.type === 'openPage' && action.url !== undefined) return `${base}: ${action.url}`;
    if (action.type === 'callback' && action.name !== undefined) return `${base}: ${action.name}`;

    return base;
  };
  const replace = (next: ButtonAction): void => save(actions.map((a) => (a.id === next.id ? next : a)));
  const actionFields = (action: ButtonAction): PopoverItemParams[] => {
    if (action.type === 'insertBlocks') {
      const first = action.blocks[0];
      const text = typeof first?.data.text === 'string' ? first.data.text : '';

      return [textField(`buttonAction-${action.id}-text`, t('tools.database.buttonBlockText'), text, (value) => replace({
        ...action,
        blocks: [{ id: first?.id ?? nanoid(), type: first?.type ?? 'paragraph', data: { ...(first?.data ?? {}), text: value } }, ...action.blocks.slice(1)],
      }))];
    }
    if (action.type === 'openPage') {
      return [textField(`buttonAction-${action.id}-url`, t('tools.database.buttonUrl'), action.url ?? '', (url) => replace(url === '' ? { id: action.id, type: 'openPage' } : { ...action, url }))];
    }
    if (action.type === 'callback') {
      return [textField(`buttonAction-${action.id}-name`, t('tools.database.buttonCallbackName'), action.name ?? '', (name) => replace(name === '' ? { id: action.id, type: 'callback' } : { ...action, name }))];
    }

    return [];
  };
  const targets = ctx.schema().filter((p) => p.id !== property.id && !isReadOnlyType(p.type) && p.type !== 'relation');

  return [
    textField('buttonLabel', t('tools.database.buttonLabel'), settings.label ?? '', (label) => save(actions, label === '' ? undefined : label)),
    ...actions.map((action): PopoverItemParams => ({
      name: `buttonAction-${action.id}`,
      title: describe(action),
      children: {
        items: [...actionFields(action), {
          name: `buttonAction-${action.id}-remove`,
          title: t('tools.database.buttonActionRemove'),
          isDestructive: true,
          closeOnActivate: true,
          onActivate: () => save(actions.filter((a) => a.id !== action.id)),
        }],
      },
    })),
    {
      name: 'buttonAddAction',
      title: t('tools.database.buttonAddAction'),
      children: {
        items: [
          {
            name: 'buttonAdd-editProperty',
            title: t(ACTION_KEYS.editProperty),
            children: {
              items: targets.map((target) => ({
                name: `buttonAdd-editProperty-${target.id}`,
                title: target.name,
                children: {
                  items: valueChoicesFor(target).map((choice, index) => ({
                    name: `buttonValue-${target.id}-${index}`,
                    title: choice.label ?? t(choice.key),
                    closeOnActivate: true,
                    onActivate: () => add({ type: 'editProperty', propertyId: target.id, value: choice.value }),
                  })),
                },
              })),
            },
          },
          {
            name: 'buttonAdd-insertBlocks',
            title: t(ACTION_KEYS.insertBlocks),
            closeOnActivate: true,
            onActivate: () => add({ type: 'insertBlocks', blocks: [{ id: nanoid(), type: 'paragraph', data: { text: '' } }] }),
          },
          {
            name: 'buttonAdd-openPage',
            title: t(ACTION_KEYS.openPage),
            closeOnActivate: true,
            onActivate: () => add({ type: 'openPage' }),
          },
          ...(ctx.hasHostActions
            ? [{
              name: 'buttonAdd-callback',
              title: t(ACTION_KEYS.callback),
              closeOnActivate: true,
              onActivate: () => add({ type: 'callback' }),
            }]
            : []),
        ],
      },
    },
  ];
};
