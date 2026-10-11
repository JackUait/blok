import { nanoid } from 'nanoid';
import type { I18n } from '../../../types';
import { panelInput, panelRow, panelSwitch, panelText } from './database-panel';
import type { PanelPage } from './database-panel';
import { isReadOnlyType } from './property-values';
import type { DatabaseSavedAutomation, DatabaseSavedAutomations, DatabaseViewConfig, PropertyDefinition, PropertyValue } from './types';

export interface AutomationSettings {
  read: () => DatabaseSavedAutomations | undefined;
  schema: () => PropertyDefinition[];
  views: () => DatabaseViewConfig[];
  writable: () => boolean;
  write: (next: DatabaseSavedAutomations, before: DatabaseSavedAutomations | undefined) => boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// A repeated or empty id makes the shared list lose its keyed merge.
const uniqueIds = (value: unknown): value is Array<Record<string, unknown>> =>
  Array.isArray(value) && value.every((item: unknown) => isRecord(item) && typeof item.id === 'string' && item.id !== '')
  && new Set(value.map((item: Record<string, unknown>) => item.id)).size === value.length;

const validValue = (property: PropertyDefinition, value: unknown): value is PropertyValue => {
  if (value === null) return true;
  switch (property.type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'checkbox':
      return typeof value === 'boolean';
    case 'select':
    case 'status':
      return typeof value === 'string' && (property.config?.options ?? []).some((option) => option.id === value);
    case 'multiSelect':
      return Array.isArray(value) && value.every((id: unknown) => typeof id === 'string'
        && (property.config?.options ?? []).some((option) => option.id === id));
    case 'person':
    case 'relation':
      return uniqueIds(value) && value.every((item) => Object.keys(item).length === 1);
    case 'files':
      return uniqueIds(value) && value.every((item) => Object.keys(item).length === 3
        && typeof item.name === 'string' && typeof item.url === 'string');
    case 'place':
      return isRecord(value) && typeof value.address === 'string';
    case 'verification':
      return isRecord(value) && (value.state === 'verified' || value.state === 'unverified');
    case 'richText':
      return typeof value === 'string' || (isRecord(value) && Array.isArray(value.blocks));
    case 'title':
    case 'text':
    case 'date':
    case 'url':
    case 'email':
    case 'phone':
    case 'button':
    case 'createdBy':
    case 'createdTime':
    case 'formula':
    case 'lastEditedBy':
    case 'lastEditedTime':
    case 'rollup':
    case 'uniqueId':
    default:
      return !isReadOnlyType(property.type) && typeof value === 'string';
  }
};

const valueText = (value: PropertyValue): string => {
  if (value === null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
};

const parseValue = (property: PropertyDefinition, text: string, literal: PropertyValue): PropertyValue | undefined => {
  if (text === '' && !['title', 'text', 'richText', 'url', 'email', 'phone'].includes(property.type)) return null;
  if (property.type === 'number') {
    const value = Number(text);

    return validValue(property, value) ? value : undefined;
  }
  if (property.type === 'checkbox' || ['multiSelect', 'person', 'relation', 'files', 'place', 'verification'].includes(property.type)
    || (property.type === 'richText' && isRecord(literal) && text.trimStart().startsWith('{'))) {
    try {
      const value: unknown = JSON.parse(text);

      return validValue(property, value) ? value : undefined;
    } catch {
      return undefined;
    }
  }
  return validValue(property, text) ? text : undefined;
};

const validationError = (definition: DatabaseSavedAutomation, ctx: AutomationSettings): string | undefined => {
  if (definition.name.trim() === '') return 'automationErrorName';
  if (!Array.isArray(definition.triggers) || definition.triggers.length === 0) return 'automationErrorTriggers';
  if (!Array.isArray(definition.actions) || definition.actions.length === 0) return 'automationErrorActions';
  const scope = definition.scope;

  if (scope.type === 'view' && !ctx.views().some((view) => view.id === scope.viewId)) return 'automationErrorView';
  const schema = ctx.schema();

  if (definition.triggers.some((trigger) => trigger.type !== 'pageAdded'
    && (trigger.type !== 'propertyEdited' || !schema.some((property) => property.id === trigger.propertyId)))) {
    return 'automationErrorProperty';
  }
  for (const action of definition.actions) {
    const property = schema.find((entry) => entry.id === action.propertyId);

    if (action.type !== 'editProperty' || action.target !== 'triggerRow' || property === undefined || isReadOnlyType(property.type)) {
      return 'automationErrorProperty';
    }
    if (!validValue(property, action.value)) return 'automationErrorValue';
  }
  return undefined;
};

export const automationListPage = (ctx: AutomationSettings, i18n: Pick<I18n, 't'>): PanelPage => {
  const t = (key: string): string => i18n.t('tools.database.' + key);
  const editable = (): PropertyDefinition[] => ctx.schema().filter((property) => !isReadOnlyType(property.type));
  const editorPage = (existing?: DatabaseSavedAutomation): PanelPage => {
    const state: { before: DatabaseSavedAutomations | undefined; error: string | undefined } = {
      before: ctx.read(), error: undefined,
    };
    const draft: DatabaseSavedAutomation = existing === undefined ? {
      id: nanoid(), name: '', status: 'active', scope: { type: 'database' }, triggerMode: 'any', triggers: [], actions: [],
    } : structuredClone(existing);
    const invalidValues = new Map<string, string>();

    return {
      title: t(existing === undefined ? 'automationNew' : 'automationTitle'),
      build: (panel) => {
        const root = document.createElement('div');

        root.setAttribute('data-blok-testid', 'database-automation-builder');
        const scope = draft.scope;
        const live = (control: HTMLElement): boolean => {
          if (!control.isConnected || !panel.root.contains(control) || !ctx.writable() || ctx.read() !== state.before) {
            panel.close();
            return false;
          }
          return true;
        };
        const row = (testId: string, label: string, act: () => void, value?: string): HTMLButtonElement => {
          const control = panelRow({
            testId, label, ...(value === undefined ? {} : { value }), disabled: !ctx.writable(),
            onClick: () => { if (live(control)) act(); },
          });

          return control;
        };
        const field = (testId: string, label: string, value: string, update: (text: string) => void): HTMLInputElement => {
          const control = panelInput({
            testId, label, value, placeholder: label,
            onInput: (text) => { if (live(control)) update(text); },
          });

          control.disabled = !ctx.writable();
          return control;
        };
        const choices = (title: string, entries: Array<{ id: string; label: string; checked?: boolean; act: () => void }>): void => {
          panel.push({
            title,
            build: () => entries.map((entry) => {
              const control = panelRow({
                testId: 'database-automation-choice-' + entry.id, label: entry.label,
                ...(entry.checked === undefined ? {} : { checked: entry.checked }), disabled: !ctx.writable(),
                onClick: () => {
                  if (!live(control)) return;
                  entry.act();
                  panel.back();
                },
              });

              return control;
            }),
          });
        };
        const store = (definition: DatabaseSavedAutomation): boolean => {
          const definitions = state.before?.definitions ?? [];
          const next = existing === undefined
            ? [...definitions, structuredClone(definition)]
            : definitions.map((saved) => saved.id === draft.id ? structuredClone(definition) : saved);

          if (existing !== undefined && !definitions.some((saved) => saved.id === draft.id)) return false;
          if (!ctx.write({ ...state.before, version: 1, definitions: next }, state.before)) return false;
          state.before = ctx.read();
          return true;
        };

        root.append(
          field('database-automation-name', t('buttonCallbackName'), draft.name, (name) => { draft.name = name; }),
          row('database-automation-scope', t('automationScope'), () => choices(t('automationScope'), [
            { id: 'database', label: t('automationEntireDatabase'), checked: draft.scope.type === 'database', act: () => { draft.scope = { type: 'database' }; } },
            ...ctx.views().map((view) => ({
              id: view.id, label: view.name, checked: draft.scope.type === 'view' && draft.scope.viewId === view.id,
              act: () => { draft.scope = { type: 'view', viewId: view.id }; },
            })),
          ]), scope.type === 'database' ? t('automationEntireDatabase') : ctx.views().find((view) => view.id === scope.viewId)?.name ?? t('settingsNone')),
          row('database-automation-mode', t('automationMode'), () => choices(t('automationMode'), [
            { id: 'any', label: t('automationAny'), checked: draft.triggerMode === 'any', act: () => { draft.triggerMode = 'any'; } },
            { id: 'all', label: t('automationAll'), checked: draft.triggerMode === 'all', act: () => { draft.triggerMode = 'all'; } },
          ]), t(draft.triggerMode === 'any' ? 'automationAny' : 'automationAll'))
        );
        draft.triggers.forEach((triggerDefinition) => {
          const trigger = triggerDefinition;

          if (trigger.type === 'pageAdded') {
            root.append(panelText(t('automationPageAdded')));
          } else {
            root.append(row('database-automation-trigger-property-' + trigger.id, t('automationPropertyEdited'), () =>
              choices(t('propertyName'), ctx.schema().map((property) => ({
                id: property.id, label: property.name, checked: trigger.propertyId === property.id,
                act: () => { trigger.propertyId = property.id; },
              }))), ctx.schema().find((property) => property.id === trigger.propertyId)?.name ?? t('settingsNone')));
          }
          root.append(row('database-automation-remove-trigger-' + trigger.id, t('deleteView'), () => {
            draft.triggers = draft.triggers.filter((entry) => entry.id !== trigger.id);
            panel.refresh();
          }));
        });
        root.append(row('database-automation-add-trigger', t('automationAddTrigger'), () => choices(t('automationAddTrigger'), [
          { id: 'page-added', label: t('automationPageAdded'), act: () => { draft.triggers.push({ id: nanoid(), type: 'pageAdded' }); } },
          {
            id: 'property-edited', label: t('automationPropertyEdited'), act: () => {
              const property = ctx.schema()[0];

              if (property !== undefined) draft.triggers.push({ id: nanoid(), type: 'propertyEdited', propertyId: property.id });
            },
          },
        ])));
        draft.actions.forEach((actionDefinition, index) => {
          const action = actionDefinition;
          const suffix = index === 0 ? '' : '-' + action.id;
          const property = ctx.schema().find((entry) => entry.id === action.propertyId);

          root.append(
            row('database-automation-action-target' + suffix, t('automationTarget'), () => choices(t('automationTarget'), [
              { id: 'trigger-row', label: t('automationTriggerPage'), checked: true, act: () => { action.target = 'triggerRow'; } },
            ]), t('automationTriggerPage')),
            row('database-automation-action-property' + suffix, t('propertyName'), () => choices(t('propertyName'), editable().map((entry) => ({
              id: entry.id, label: entry.name, checked: entry.id === action.propertyId,
              act: () => {
                if (action.propertyId === entry.id) return;
                action.propertyId = entry.id;
                action.value = ['title', 'text', 'richText', 'url', 'email', 'phone'].includes(entry.type) ? '' : null;
                invalidValues.delete(action.id);
              },
            }))), property?.name ?? t('settingsNone')),
            field('database-automation-action-value' + suffix, t('filterValue'), invalidValues.get(action.id) ?? valueText(action.value), (text) => {
              const current = ctx.schema().find((entry) => entry.id === action.propertyId);
              const parsed = current === undefined ? undefined : parseValue(current, text, action.value);

              if (parsed === undefined) invalidValues.set(action.id, text);
              else {
                action.value = parsed;
                invalidValues.delete(action.id);
              }
            }),
            row('database-automation-remove-action-' + action.id, t('deleteView'), () => {
              draft.actions = draft.actions.filter((entry) => entry.id !== action.id);
              invalidValues.delete(action.id);
              panel.refresh();
            })
          );
        });
        root.append(row('database-automation-add-action', t('buttonAddAction'), () => choices(t('buttonAddAction'), [
          {
            id: 'edit-property', label: t('editProperty'), act: () => {
              const property = editable()[0];

              if (property !== undefined) draft.actions.push({
                id: nanoid(), type: 'editProperty', target: 'triggerRow', propertyId: property.id,
                value: ['title', 'text', 'richText', 'url', 'email', 'phone'].includes(property.type) ? '' : null,
              });
            },
          },
        ])));
        if (existing !== undefined) {
          const saved = state.before?.definitions.find((definition) => definition.id === draft.id);
          const active = panelSwitch({
            testId: 'database-automation-active', label: t('automationActive'),
            checked: saved?.status === 'active', disabled: !ctx.writable(),
            onToggle: (next) => {
              if (!live(active) || saved === undefined) return;
              state.error = next ? validationError(saved, ctx) : undefined;
              if (state.error === undefined && store({ ...saved, status: next ? 'active' : 'paused' })) {
                draft.status = next ? 'active' : 'paused';
              }
              panel.refresh();
            },
          });

          root.append(active);
        }
        root.append(
          row(existing === undefined ? 'database-automation-create' : 'database-automation-save',
            t(existing === undefined ? 'selectCreate' : 'automationSave'), () => {
              state.error = invalidValues.size > 0 ? 'automationErrorValue' : validationError(draft, ctx);
              if (state.error !== undefined) {
                panel.refresh();
                return;
              }
              if (store(draft)) panel.back();
            }),
          row('database-automation-cancel', t('optionDeleteCancel'), () => panel.back())
        );
        if (existing !== undefined) {
          root.append(row('database-automation-delete', t('deleteView'), () => {
            const definitions = state.before?.definitions ?? [];

            if (!definitions.some((definition) => definition.id === draft.id)) return;
            if (ctx.write({ ...state.before, version: 1, definitions: definitions.filter((definition) => definition.id !== draft.id) }, state.before)) panel.back();
          }));
        }
        if (state.error !== undefined) {
          const notice = panelText(t(state.error));

          notice.setAttribute('data-blok-testid', 'database-automation-error');
          notice.setAttribute('role', 'alert');
          root.append(notice);
        }
        return [root];
      },
    };
  };

  return {
    title: t('automationTitle'),
    build: (panel) => {
      const before = ctx.read();
      const root = document.createElement('div');

      root.setAttribute('data-blok-testid', 'database-automations');
      const supported = before === undefined || before.version === 1;
      const add = panelRow({
        testId: 'database-automation-new', label: t('automationNew'), disabled: !ctx.writable() || !supported,
        onClick: () => {
          if (!add.isConnected || !ctx.writable() || !supported || ctx.read() !== before) return;
          panel.push(editorPage());
        },
      });

      root.append(add);
      if (!supported) root.append(panelText(t('automationErrorUnavailable')));
      else before?.definitions.forEach((definition) => {
        const control = panelRow({
          testId: 'database-automation-open-' + definition.id, label: definition.name, disabled: !ctx.writable(),
          onClick: () => {
            if (!control.isConnected || !ctx.writable() || ctx.read() !== before) return;
            panel.push(editorPage(definition));
          },
        });

        root.append(control);
      });
      return [root];
    },
  };
};
