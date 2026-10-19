import { nanoid } from 'nanoid';
import type { I18n } from '../../../types';
import type { PopoverItemParams } from '../../../types/utils/popover/popover-item';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { MAX_NOTIFY_PEOPLE } from './database-button';
import { operatorNeedsValue } from './database-filter-labels';
import { countFilterRules } from './filter-tree';
import { isReadOnlyType, orderedStatusOptions } from './property-values';
import type {
  ButtonAction,
  ButtonAddPageAction,
  ButtonEditPagesAction,
  ButtonPropertyEdit,
  ButtonSendNotificationAction,
  ButtonSettings,
  FilterConfig,
  PropertyDefinition,
  PropertySettingsV2,
  PropertyValue,
} from './types';

export interface ButtonMenuContext {
  i18n: Pick<I18n, 't'>;
  schema: () => PropertyDefinition[];
  /** The host set `config.buttons.onAction`. */
  hasHostActions: boolean;
  update: (patch: Partial<PropertySettingsV2>) => void;
  /** The host set `config.buttons.onNotify`: buttons may send notifications. */
  hasNotify?: boolean;
  /** The editor has `agent.assistant`: buttons may message the agent. */
  hasAgent?: boolean;
  /** This database block. */
  databaseId?: string;
  /** Databases a page can be added to or edited in, this one first. */
  dataSources?: () => Array<{ id: string; title: string }>;
  /** A data source's schema. */
  targetSchema?: (databaseId: string) => PropertyDefinition[];
  /** People the host lists. Without it, "Specific people" is not offered. */
  people?: () => Array<{ id: string; name: string }>;
  /** Opens the filter editor of an "Edit pages in" step. */
  editFilter?: (actionId: string) => void;
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
  addPage: 'tools.database.buttonActionAddPage',
  editPages: 'tools.database.buttonActionEditPages',
  sendNotification: 'tools.database.buttonActionSendNotification',
  showConfirmation: 'tools.database.buttonActionShowConfirmation',
  openPage: 'tools.database.buttonActionOpenPage',
  sendAgentMessage: 'tools.database.buttonActionSendAgentMessage',
  defineVariables: 'tools.database.buttonActionDefineVariables',
  insertBlocks: 'tools.database.buttonActionInsertBlocks',
  callback: 'tools.database.buttonActionCallback',
};

const textField = (name: string, label: string, value: string, onChange: (value: string) => void, placeholder?: string): PopoverItemParams => {
  const wrap = document.createElement('label');
  const input = document.createElement('input');

  wrap.setAttribute('data-blok-database-property-menu-field', name);
  wrap.setAttribute('data-blok-keyboard-owner', '');
  wrap.append(label);
  input.type = 'text';
  input.value = value;
  if (placeholder !== undefined) input.placeholder = placeholder;
  input.addEventListener('change', () => onChange(input.value.trim()));
  wrap.appendChild(input);

  return { type: PopoverItemType.Html, element: wrap, name };
};

/** A property a button may write: not computed, not a relation, not itself. */
const writable = (schema: PropertyDefinition[], buttonId: string): PropertyDefinition[] =>
  schema.filter((p) => p.id !== buttonId && !isReadOnlyType(p.type) && p.type !== 'relation');

/** A filter rule that says something: an empty value means "all pages" (research/17 §3c). */
const isSetRule = (filter: FilterConfig): boolean =>
  !operatorNeedsValue(filter.operator) || !(filter.value === '' || filter.value === null || (Array.isArray(filter.value) && filter.value.length === 0));

/** The schema an "Edit pages in" step writes to. Undefined: no target, or it is gone. */
const editTargetSchema = (action: ButtonEditPagesAction, actions: readonly ButtonAction[], ctx: ButtonMenuContext): PropertyDefinition[] | undefined => {
  const here = ctx.databaseId;
  const target = action.target;

  if (target === undefined) return undefined;
  if (target.type === 'thisPage') return ctx.schema();
  const step = target.type === 'addedPage' ? actions.find((a): a is ButtonAddPageAction => a.type === 'addPage' && a.id === target.stepId) : undefined;

  if (target.type === 'addedPage' && step === undefined) return undefined;
  const databaseId = target.type === 'database' ? target.databaseId : (step?.databaseId ?? here);

  if (databaseId === undefined || databaseId === here) return ctx.schema();
  if (ctx.dataSources !== undefined && !ctx.dataSources().some((source) => source.id === databaseId)) return undefined;

  return ctx.targetSchema?.(databaseId);
};

const addPageSchema = (action: ButtonAddPageAction, ctx: ButtonMenuContext): PropertyDefinition[] | undefined => {
  if (action.databaseId === undefined || action.databaseId === ctx.databaseId) return ctx.schema();
  if (ctx.dataSources !== undefined && !ctx.dataSources().some((source) => source.id === action.databaseId)) return undefined;

  return ctx.targetSchema?.(action.databaseId);
};

const editsValid = (edits: ButtonPropertyEdit[] | undefined, schema: PropertyDefinition[]): boolean =>
  (edits ?? []).every((edit) => schema.some((p) => p.id === edit.propertyId));

const recipientsValid = (action: ButtonSendNotificationAction, schema: PropertyDefinition[]): boolean => {
  const recipients = action.recipients;

  if (recipients?.type === 'people') return recipients.people.length > 0;
  if (recipients?.type === 'property') return schema.some((p) => p.id === recipients.propertyId && p.type === 'person');

  return false;
};

/**
 * An action that cannot run as set: a required field is empty, or it names a
 * database or property that is gone. Notion flags its header then (research/17 §3d,
 * seen with a notification that had no recipients).
 */
export const buttonHasError = (settings: ButtonSettings, ctx: Pick<ButtonMenuContext, 'schema' | 'databaseId' | 'dataSources' | 'targetSchema'>): boolean => {
  const actions = settings.buttonActions ?? [];
  const full = { ...ctx, i18n: { t: (key: string) => key }, hasHostActions: false, update: () => undefined };

  return actions.some((action) => {
    switch (action.type) {
      case 'editProperty':
        return !ctx.schema().some((p) => p.id === action.propertyId);
      case 'addPage': {
        const schema = addPageSchema(action, full);

        return schema === undefined || !editsValid(action.edits, schema);
      }
      case 'editPages': {
        const schema = editTargetSchema(action, actions, full);

        return schema === undefined || !editsValid(action.edits, schema);
      }
      case 'sendNotification':
        return !recipientsValid(action, ctx.schema());
      case 'sendAgentMessage':
        return (action.message ?? '').trim() === '';
      case 'insertBlocks':
      case 'openPage':
      case 'callback':
      case 'showConfirmation':
      case 'defineVariables':
        return false;
    }
  });
};

/** "Edit property" for a button: its label, its actions and "Add action". */
export const buttonEditItems = (property: PropertyDefinition, ctx: ButtonMenuContext): PopoverItemParams[] => {
  const t = (key: string, vars?: Record<string, string | number>): string => (vars === undefined ? ctx.i18n.t(key) : ctx.i18n.t(key, vars));
  const settings: ButtonSettings = property.button ?? {};
  const actions = settings.buttonActions ?? [];
  const save = (next: ButtonAction[], label = settings.label): void =>
    ctx.update({ button: { ...(label !== undefined ? { label } : {}), buttonActions: next } });
  const add = (action: NewAction): void => save([...actions, { ...action, id: nanoid() }]);
  const nameOf = (id: string): string => ctx.schema().find((p) => p.id === id)?.name ?? '';
  const sources = (): Array<{ id: string; title: string }> => ctx.dataSources?.() ?? [];
  const sourceTitle = (id: string | undefined): string => {
    const title = sources().find((source) => source.id === (id ?? ctx.databaseId))?.title;

    return title === undefined || title === '' ? t('tools.database.relationUntitled') : title;
  };
  const describe = (action: ButtonAction): string => {
    const base = t(ACTION_KEYS[action.type] ?? 'tools.database.buttonActionUnknown');

    if (action.type === 'editProperty') return `${base}: ${nameOf(action.propertyId)}`;
    if (action.type === 'openPage' && action.url !== undefined) return `${base}: ${action.url}`;
    if (action.type === 'callback' && action.name !== undefined) return `${base}: ${action.name}`;

    return base;
  };
  const replace = (next: ButtonAction): void => save(actions.map((a) => (a.id === next.id ? next : a)));
  /** Earlier "Add page to" steps: what "Page added" can point at. */
  const addedBefore = (action: ButtonAction): ButtonAddPageAction[] =>
    actions.slice(0, actions.indexOf(action)).filter((a): a is ButtonAddPageAction => a.type === 'addPage');

  /** "Edit property" inside Add page to / Edit pages in: one value per property. */
  const editItems = (
    action: ButtonAddPageAction | ButtonEditPagesAction,
    schema: PropertyDefinition[],
    onEdits: (edits: ButtonPropertyEdit[]) => void
  ): PopoverItemParams[] => {
    const edits = action.edits ?? [];
    const set = (propertyId: string, value: PropertyValue): void => {
      const kept = edits.filter((edit) => edit.propertyId !== propertyId);

      onEdits([...kept, { id: edits.find((edit) => edit.propertyId === propertyId)?.id ?? nanoid(), propertyId, value }]);
    };

    return [
      ...edits.map((edit): PopoverItemParams => ({
        name: `buttonAction-${action.id}-set-${edit.propertyId}`,
        title: schema.find((p) => p.id === edit.propertyId)?.name ?? '',
        children: {
          items: [{
            name: `buttonAction-${action.id}-unset-${edit.propertyId}`,
            title: t('tools.database.buttonActionRemove'),
            isDestructive: true,
            closeOnActivate: true,
            onActivate: () => onEdits(edits.filter((e) => e.id !== edit.id)),
          }],
        },
      })),
      {
        name: `buttonAction-${action.id}-edit`,
        title: t('tools.database.buttonActionEditProperty'),
        children: {
          searchable: true,
          items: writable(schema, property.id).filter((p) => p.type !== 'title').map((target) => ({
            name: `buttonAction-${action.id}-edit-${target.id}`,
            title: target.name,
            children: {
              items: valueChoicesFor(target).map((choice, index) => ({
                name: `buttonAction-${action.id}-value-${target.id}-${index}`,
                title: choice.label ?? t(choice.key),
                closeOnActivate: true,
                onActivate: () => set(target.id, choice.value),
              })),
            },
          })),
        },
      },
    ];
  };

  const sourceItems = (action: ButtonAction, onPick: (databaseId: string) => void): PopoverItemParams[] =>
    sources().map((source) => ({
      name: `buttonSource-${action.id}-${source.id}`,
      title: source.title === '' ? t('tools.database.relationUntitled') : source.title,
      closeOnActivate: true,
      onActivate: () => onPick(source.id),
    }));

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
      const earlier = addedBefore(action);

      return [
        {
          name: `buttonAction-${action.id}-page`,
          title: action.stepId !== undefined ? t('tools.database.automationPageAdded') : t('tools.database.filterThisPage'),
          children: {
            items: [
              {
                name: `buttonOpen-${action.id}-thisPage`,
                title: t('tools.database.filterThisPage'),
                isActive: action.stepId === undefined && action.url === undefined,
                closeOnActivate: true,
                onActivate: () => replace({ id: action.id, type: 'openPage' }),
              },
              ...earlier.map((step) => ({
                name: `buttonOpen-${action.id}-step-${step.id}`,
                title: t('tools.database.automationPageAdded'),
                valueLabel: t('tools.database.buttonPageAddedTo', { name: sourceTitle(step.databaseId) }),
                isActive: action.stepId === step.id,
                closeOnActivate: true,
                onActivate: () => replace({ id: action.id, type: 'openPage', stepId: step.id }),
              })),
            ],
          },
        },
        textField(`buttonAction-${action.id}-url`, t('tools.database.buttonUrl'), action.url ?? '', (url) => replace(url === '' ? { id: action.id, type: 'openPage' } : { id: action.id, type: 'openPage', url })),
      ];
    }
    if (action.type === 'callback') {
      return [textField(`buttonAction-${action.id}-name`, t('tools.database.buttonCallbackName'), action.name ?? '', (name) => replace(name === '' ? { id: action.id, type: 'callback' } : { ...action, name }))];
    }
    if (action.type === 'addPage') {
      const schema = addPageSchema(action, ctx) ?? [];

      return [
        {
          name: `buttonAction-${action.id}-source`,
          title: t('tools.database.buttonDataSource'),
          valueLabel: sourceTitle(action.databaseId),
          children: {
            items: sourceItems(action, (databaseId) => {
              const { databaseId: _old, edits: _edits, ...rest } = action;

              replace({ ...rest, ...(databaseId === ctx.databaseId ? {} : { databaseId }), edits: [] });
            }),
          },
        },
        textField(`buttonAction-${action.id}-title`, t('tools.database.buttonCallbackName'), action.name ?? '', (name) => {
          const { name: _old, ...rest } = action;

          replace(name === '' ? rest : { ...rest, name });
        }, t('tools.database.relationUntitled')),
        ...editItems(action, schema, (edits) => replace({ ...action, edits })),
      ];
    }
    if (action.type === 'editPages') {
      const target = action.target;
      const schema = editTargetSchema(action, actions, ctx);
      const pick = (next: ButtonEditPagesAction['target']): void => replace({ id: action.id, type: 'editPages', ...(next === undefined ? {} : { target: next }), edits: [] });
      const set = target?.type === 'database' ? (target.filters ?? []).filter(isSetRule).length + countFilterRules(target.filterTree) : 0;
      const filterTitles: Record<number, string> = { 0: t('tools.database.buttonAllPages'), 1: t('tools.database.buttonMatchOneFilter') };
      const filterTitle = filterTitles[set] ?? t('tools.database.buttonMatchFilters', { count: set });
      const targetLabels = {
        thisPage: () => t('tools.database.filterThisPage'),
        addedPage: () => t('tools.database.automationPageAdded'),
        database: () => sourceTitle(target?.type === 'database' ? target.databaseId : undefined),
      };

      return [
        {
          name: `buttonAction-${action.id}-target`,
          title: t('tools.database.buttonDataSource'),
          ...(target === undefined ? {} : { valueLabel: targetLabels[target.type]() }),
          children: {
            items: [
              {
                name: `buttonTarget-${action.id}-thisPage`,
                title: t('tools.database.filterThisPage'),
                isActive: target?.type === 'thisPage',
                closeOnActivate: true,
                onActivate: () => pick({ type: 'thisPage' }),
              },
              ...addedBefore(action).map((step) => ({
                name: `buttonTarget-${action.id}-step-${step.id}`,
                title: t('tools.database.automationPageAdded'),
                valueLabel: t('tools.database.buttonPageAddedTo', { name: sourceTitle(step.databaseId) }),
                isActive: target?.type === 'addedPage' && target.stepId === step.id,
                closeOnActivate: true,
                onActivate: () => pick({ type: 'addedPage', stepId: step.id }),
              })),
              ...sources().map((source) => ({
                name: `buttonTarget-${action.id}-${source.id}`,
                title: source.title === '' ? t('tools.database.relationUntitled') : source.title,
                isActive: target?.type === 'database' && target.databaseId === source.id,
                closeOnActivate: true,
                onActivate: () => pick({ type: 'database', databaseId: source.id }),
              })),
            ],
          },
        },
        ...(target?.type === 'database' && ctx.editFilter !== undefined ? [{
          name: `buttonAction-${action.id}-filter`,
          title: filterTitle,
          closeOnActivate: true,
          onActivate: () => ctx.editFilter?.(action.id),
        }] : []),
        ...(schema === undefined ? [] : editItems(action, schema, (edits) => replace({ ...action, edits }))),
      ];
    }
    if (action.type === 'showConfirmation') {
      return [
        textField(`buttonAction-${action.id}-message`, t('tools.database.buttonConfirmMessage'), action.message ?? '', (message) => replace({ ...action, message })),
        textField(`buttonAction-${action.id}-confirm`, t('tools.database.buttonConfirmContinueText'), action.confirmLabel ?? '', (confirmLabel) => replace({ ...action, confirmLabel })),
        textField(`buttonAction-${action.id}-cancel`, t('tools.database.buttonConfirmCancelText'), action.cancelLabel ?? '', (cancelLabel) => replace({ ...action, cancelLabel })),
      ];
    }
    if (action.type === 'defineVariables') {
      const variables = action.variables;
      const setVariables = (next: typeof variables): void => replace({ ...action, variables: next });

      return [
        ...variables.map((variable): PopoverItemParams => {
          const change = (patch: Partial<typeof variable>): void => setVariables(variables.map((v) => (v.id === variable.id ? { ...v, ...patch } : v)));

          return {
            name: `buttonVariable-${action.id}-${variable.id}`,
            title: variable.name,
            ...(variable.value === undefined || variable.value === '' ? {} : { valueLabel: variable.value }),
            children: {
              items: [
                textField(`buttonVariable-${variable.id}-name`, t('tools.database.buttonCallbackName'), variable.name, (name) => { if (name !== '') change({ name }); }),
                textField(`buttonVariable-${variable.id}-value`, t('tools.database.filterValue'), variable.value ?? '', (value) => change({ value })),
                {
                  name: `buttonVariable-${variable.id}-text`,
                  title: t('tools.database.buttonVariableAsText'),
                  isActive: variable.kind !== 'formula',
                  closeOnActivate: true,
                  onActivate: () => change({ kind: 'text' }),
                },
                {
                  name: `buttonVariable-${variable.id}-formula`,
                  title: t('tools.database.buttonVariableAsFormula'),
                  isActive: variable.kind === 'formula',
                  closeOnActivate: true,
                  onActivate: () => change({ kind: 'formula' }),
                },
                {
                  name: `buttonVariable-${variable.id}-clear`,
                  title: t('tools.database.buttonVariableClear'),
                  isDestructive: true,
                  closeOnActivate: true,
                  onActivate: () => setVariables(variables.filter((v) => v.id !== variable.id)),
                },
              ],
            },
          };
        }),
        {
          name: `buttonAction-${action.id}-addVariable`,
          title: t('tools.database.buttonVariableAdd'),
          closeOnActivate: true,
          onActivate: () => setVariables([...variables, { id: nanoid(), name: t('tools.database.buttonVariableName', { n: variables.length + 1 }), kind: 'text', value: '' }]),
        },
      ];
    }
    if (action.type === 'sendNotification') {
      const recipients = action.recipients;
      const picked = recipients?.type === 'people' ? recipients.people : [];
      const people = ctx.people;
      const persons = ctx.schema().filter((p) => p.type === 'person');
      const togglePerson = (id: string): void => {
        const has = picked.some((person) => person.id === id);

        if (!has && picked.length >= MAX_NOTIFY_PEOPLE) return;
        replace({ ...action, recipients: { type: 'people', people: has ? picked.filter((person) => person.id !== id) : [...picked, { id }] } });
      };
      const peopleLabel = picked.length > 0 ? t('tools.database.buttonSpecificPeople') : undefined;
      const recipientsLabel = recipients?.type === 'property' ? nameOf(recipients.propertyId) : peopleLabel;

      return [
        {
          name: `buttonAction-${action.id}-recipients`,
          title: t('tools.database.buttonSelectRecipients'),
          ...(recipientsLabel === undefined ? {} : { valueLabel: recipientsLabel }),
          children: {
            items: [
              ...(people === undefined ? [] : [{
                name: `buttonRecipients-${action.id}-people`,
                title: t('tools.database.buttonSpecificPeople'),
                children: {
                  searchable: true,
                  items: people().map((person) => ({
                    name: `buttonPerson-${action.id}-${person.id}`,
                    title: person.name,
                    isActive: picked.some((p) => p.id === person.id),
                    onActivate: () => togglePerson(person.id),
                  })),
                },
              }]),
              {
                name: `buttonRecipients-${action.id}-property`,
                title: t('tools.database.buttonPersonProperty'),
                children: {
                  items: persons.map((person) => ({
                    name: `buttonRecipientProperty-${action.id}-${person.id}`,
                    title: person.name,
                    isActive: recipients?.type === 'property' && recipients.propertyId === person.id,
                    closeOnActivate: true,
                    onActivate: () => replace({ ...action, recipients: { type: 'property', propertyId: person.id } }),
                  })),
                },
              },
            ],
          },
        },
        textField(`buttonAction-${action.id}-message`, t('tools.database.buttonMessage'), action.message ?? '', (message) => {
          const { message: _old, ...rest } = action;

          replace(message === '' ? rest : { ...rest, message });
        }),
      ];
    }
    if (action.type === 'sendAgentMessage') {
      return [textField(`buttonAction-${action.id}-message`, t('tools.database.buttonMessage'), action.message ?? '', (message) => {
        const { message: _old, ...rest } = action;

        replace(message === '' ? rest : { ...rest, message });
      })];
    }

    return [];
  };
  const targets = writable(ctx.schema(), property.id);
  const hasNotification = actions.some((action) => action.type === 'sendNotification');
  const hasAgentMessage = actions.some((action) => action.type === 'sendAgentMessage');

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
            name: 'buttonAdd-addPage',
            title: t(ACTION_KEYS.addPage),
            closeOnActivate: true,
            onActivate: () => add({ type: 'addPage' }),
          },
          {
            name: 'buttonAdd-editPages',
            title: t(ACTION_KEYS.editPages),
            closeOnActivate: true,
            onActivate: () => add({ type: 'editPages' }),
          },
          // research/17 §3b: gone from the list once one is added.
          ...(ctx.hasNotify === true && !hasNotification
            ? [{
              name: 'buttonAdd-sendNotification',
              title: t(ACTION_KEYS.sendNotification),
              closeOnActivate: true,
              onActivate: () => add({ type: 'sendNotification' }),
            }]
            : []),
          {
            name: 'buttonAdd-showConfirmation',
            title: t(ACTION_KEYS.showConfirmation),
            closeOnActivate: true,
            // Notion fills these in as values, not placeholders (research/17 §3c).
            onActivate: () => add({
              type: 'showConfirmation',
              message: t('tools.database.buttonConfirmDefault'),
              confirmLabel: t('tools.database.buttonConfirmContinue'),
              cancelLabel: t('tools.database.optionDeleteCancel'),
            }),
          },
          {
            name: 'buttonAdd-openPage',
            title: t(ACTION_KEYS.openPage),
            closeOnActivate: true,
            onActivate: () => add({ type: 'openPage' }),
          },
          // Only one agent turn runs at a time, so a click can send one message.
          ...(ctx.hasAgent === true && !hasAgentMessage
            ? [{
              name: 'buttonAdd-sendAgentMessage',
              title: t(ACTION_KEYS.sendAgentMessage),
              closeOnActivate: true,
              onActivate: () => add({ type: 'sendAgentMessage' }),
            }]
            : []),
          {
            name: 'buttonAdd-defineVariables',
            title: t(ACTION_KEYS.defineVariables),
            closeOnActivate: true,
            onActivate: () => add({ type: 'defineVariables', variables: [{ id: nanoid(), name: t('tools.database.buttonVariableName', { n: 1 }), kind: 'text', value: '' }] }),
          },
          {
            name: 'buttonAdd-insertBlocks',
            title: t(ACTION_KEYS.insertBlocks),
            closeOnActivate: true,
            onActivate: () => add({ type: 'insertBlocks', blocks: [{ id: nanoid(), type: 'paragraph', data: { text: '' } }] }),
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
