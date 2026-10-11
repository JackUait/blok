import { IconDotsHorizontal } from '../../components/icons';
import type { I18n } from '../../../types';
import { openCellEditor, renderCellValue } from './cells';
import type { CellContext, CellEditorHandle } from './cells';
import { DatabasePanel, panelInput, panelRow, panelSwitch } from './database-panel';
import { addablePropertyTypes, propertyTypeMeta } from './database-property-types';
import type { DatabaseViewRenderer } from './database-view-renderer';
import { isReadOnlyType } from './property-values';
import type { DatabaseRow, DatabaseSourceRef, DatabaseViewConfig, PropertyDefinition, PropertyType, PropertyValue, ViewPropertySetting } from './types';
import { resolveViewProperties, withPropertySetting } from './view-settings';
import type { ViewPropertyPatch } from './view-settings';

export interface DatabaseFormViewOptions {
  i18n: Pick<I18n, 't'>;
  view: DatabaseViewConfig;
  schema: PropertyDefinition[];
  readOnly: boolean;
  source?: DatabaseSourceRef;
  onSubmit: (values: Record<string, PropertyValue>) => void;
  setRequired?: (propertyId: string, required: boolean) => void;
  setQuestionSetting?: (propertyId: string, changes: ViewPropertyPatch) => void;
  addQuestion?: () => PropertyDefinition | null;
  renameProperty?: (propertyId: string, name: string) => void;
  changePropertyType?: (propertyId: string, type: PropertyType) => void;
  duplicateProperty?: (propertyId: string) => PropertyDefinition | null;
  deleteProperty?: (propertyId: string) => void;
  cellContext?: Partial<CellContext>;
  hasPeople?: boolean;
  onInteractionEnd?: () => void;
  submitted?: boolean;
  onSubmittedChange?: (submitted: boolean) => void;
}

const ASKABLE: readonly PropertyType[] = [
  'title', 'text', 'richText', 'url', 'email', 'phone', 'number', 'checkbox', 'select', 'status', 'multiSelect', 'date', 'place',
  'person', 'files', 'relation',
];

const INPUT_TYPES: Partial<Record<PropertyType, string>> = {
  url: 'url', email: 'email', phone: 'tel', number: 'number', date: 'date', checkbox: 'checkbox',
};

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLFieldSetElement | HTMLButtonElement;

interface FormDraft {
  viewId: string;
  source?: DatabaseSourceRef;
  answers: Map<string, {
    type: PropertyType;
    value: PropertyValue | undefined;
    targetDatabaseId?: string;
    targetDocumentId?: string;
  }>;
}

export class DatabaseFormView implements DatabaseViewRenderer {
  private readonly fields = new Map<string, { property: PropertyDefinition; field: Field; required: boolean; maxSelections?: number }>();
  private readonly answers = new Map<string, PropertyValue>();
  private submitted: boolean;
  private root: HTMLDivElement | null = null;
  private panel: DatabasePanel | null = null;
  private editor: CellEditorHandle | null = null;
  private building = false;
  private destroying = false;

  constructor(private readonly options: DatabaseFormViewOptions) {
    this.submitted = options.submitted === true;
  }

  get interacting(): boolean {
    return this.building || this.panel !== null || this.editor?.isOpen === true;
  }

  captureDraft(): FormDraft | undefined {
    if (this.destroying) return undefined;
    const answers: FormDraft['answers'] = new Map();

    this.fields.forEach(({ property, field }, id) => {
      const value = { answer: this.answers.get(id) };

      if (field instanceof HTMLFieldSetElement) {
        value.answer = [...field.querySelectorAll<HTMLInputElement>('input:checked')].map((box) => box.value);
      } else if (field instanceof HTMLInputElement && field.type === 'checkbox') {
        value.answer = field.checked;
      } else if (!(field instanceof HTMLButtonElement)) {
        value.answer = field.value;
      }
      answers.set(id, {
        type: property.type,
        value: structuredClone(value.answer),
        targetDatabaseId: property.relation?.targetDatabaseId,
        targetDocumentId: property.relation?.targetDocumentId,
      });
    });

    return { viewId: this.options.view.id, source: structuredClone(this.options.source), answers };
  }

  restoreDraft(draft: FormDraft): void {
    if (this.destroying || draft.viewId !== this.options.view.id
      || draft.source?.databaseId !== this.options.source?.databaseId
      || draft.source?.documentId !== this.options.source?.documentId) return;
    draft.answers.forEach(({ type, value, targetDatabaseId, targetDocumentId }, id) => {
      const entry = this.fields.get(id);

      if (entry === undefined || entry.property.type !== type) return;
      const { property, field } = entry;

      if (type === 'relation' && (property.relation?.targetDatabaseId !== targetDatabaseId
        || property.relation?.targetDocumentId !== targetDocumentId)) return;
      if (field instanceof HTMLButtonElement) {
        if (value === undefined) this.answers.delete(id);
        else this.answers.set(id, structuredClone(value));
        this.paintProviderField(property, field);
      } else if (field instanceof HTMLFieldSetElement) {
        for (const box of field.querySelectorAll<HTMLInputElement>('input')) {
          box.checked = Array.isArray(value) && value.some((selected) => selected === box.value);
        }
      } else if (field instanceof HTMLInputElement && field.type === 'checkbox') {
        field.checked = value === true;
      } else if (typeof value === 'string') {
        field.value = value;
      }
    });
  }

  destroy(): void {
    this.destroying = true;
    this.panel?.close();
    this.panel = null;
    this.editor?.cancel();
    this.editor = null;
  }

  createView(): HTMLDivElement {
    const root = document.createElement('div');

    root.setAttribute('data-blok-database-form', '');
    root.setAttribute('data-blok-keyboard-owner', '');
    this.root = root;
    this.fill(root);

    return root;
  }

  private fill(root: HTMLDivElement): void {
    const { view, i18n } = this.options;

    this.editor?.cancel();
    this.editor = null;
    root.replaceChildren();
    this.fields.clear();
    this.answers.clear();
    if (view.form?.closed === true) {
      // Detached fields keep draft transfer's schema checks while closed.
      this.questions();
      const closed = document.createElement('p');

      closed.setAttribute('data-blok-database-form-closed', '');
      closed.textContent = i18n.t('tools.database.formClosed');
      root.appendChild(closed);

      return;
    }
    if (this.submitted) {
      root.appendChild(this.confirmation());

      return;
    }

    const form = document.createElement('form');

    form.noValidate = true;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submit();
    });
    this.questions().forEach((question) => form.appendChild(question));
    if (!this.options.readOnly && this.options.addQuestion !== undefined) {
      const add = panelRow({
        label: i18n.t('tools.database.formAddQuestion'),
        testId: 'database-form-add-question',
        onClick: () => this.addQuestion(add),
      });

      form.appendChild(add);
    }

    const submit = document.createElement('button');

    submit.type = 'submit';
    submit.setAttribute('data-blok-database-form-submit', '');
    submit.textContent = view.form?.submitLabel ?? i18n.t('tools.database.formSubmit');
    form.appendChild(submit);
    root.appendChild(form);
  }

  private confirmation(): HTMLElement {
    const done = document.createElement('div');
    const text = document.createElement('p');
    const again = document.createElement('button');

    done.setAttribute('data-blok-database-form-done', '');
    text.setAttribute('data-blok-database-form-confirmation', '');
    text.setAttribute('role', 'status');
    text.textContent = this.options.view.form?.confirmation ?? this.options.i18n.t('tools.database.formSubmitted');
    again.type = 'button';
    again.setAttribute('data-blok-database-form-again', '');
    again.textContent = this.options.i18n.t('tools.database.formSubmitAnother');
    again.addEventListener('click', () => this.setSubmitted(false));
    done.append(text, again);

    return done;
  }

  private setSubmitted(submitted: boolean): void {
    this.submitted = submitted;
    this.options.onSubmittedChange?.(submitted);
    if (this.root !== null) this.fill(this.root);
  }

  appendRow(_container: HTMLElement, _row: DatabaseRow): void {}

  removeRow(_wrapper: HTMLElement, _rowId: string): void {}

  updateRowTitle(_wrapper: HTMLElement, _rowId: string, _title: string): void {}

  private questions(): HTMLElement[] {
    const { view, schema } = this.options;

    return resolveViewProperties(view, schema)
      .filter((entry) => entry.visible)
      .flatMap((entry) => {
        const property = schema.find((p) => p.id === entry.id);

        if (property === undefined || isReadOnlyType(property.type) || !ASKABLE.includes(property.type)) return [];

        const setting = withPropertySetting(view, schema, property.id, {}).find((stored) => stored.id === property.id) ?? entry;

        return [this.question(property, setting)];
      });
  }

  private question(property: PropertyDefinition, setting: ViewPropertySetting): HTMLElement {
    const { i18n } = this.options;
    const wrapper = document.createElement('div');
    const id = `blok-form-${this.options.view.id}-${property.id}`.replace(/[^A-Za-z0-9_-]/g, '_');
    const label = document.createElement('label');
    const field = this.field(property, id, setting);
    const required = setting.required === true;

    wrapper.setAttribute('data-blok-database-form-question', property.id);
    label.setAttribute('data-blok-database-form-label', '');
    label.htmlFor = id;
    label.textContent = setting.questionName ?? property.name;
    if (required) {
      const mark = document.createElement('span');

      mark.setAttribute('data-blok-database-form-required-mark', '');
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = ' *';
      label.appendChild(mark);
    }
    if (!this.options.readOnly && this.options.setQuestionSetting !== undefined) {
      const header = document.createElement('div');
      const menu = document.createElement('button');

      header.setAttribute('data-blok-database-form-question-header', '');
      menu.type = 'button';
      menu.setAttribute('data-blok-database-form-question-menu', '');
      menu.setAttribute('data-blok-testid', 'database-form-question-menu');
      menu.setAttribute('aria-label', i18n.t('tools.database.tableMoreActions'));
      menu.innerHTML = IconDotsHorizontal;
      menu.addEventListener('click', () => this.openQuestionMenu(property, menu));
      header.append(label, menu);
      wrapper.appendChild(header);
    } else {
      wrapper.appendChild(label);
    }
    if (setting.description !== undefined && setting.description !== '') {
      const help = document.createElement('p');

      help.id = `${id}-help`;
      help.setAttribute('data-blok-database-form-description', '');
      help.textContent = setting.description;
      field.setAttribute('aria-describedby', help.id);
      wrapper.appendChild(help);
    }
    if (field instanceof HTMLFieldSetElement || field instanceof HTMLButtonElement) {
      if (required) field.setAttribute('aria-required', 'true');
    } else {
      field.required = required;
    }
    wrapper.appendChild(field);

    if (!this.options.readOnly && this.options.setRequired !== undefined) {
      const toggle = document.createElement('label');
      const box = document.createElement('input');
      const setRequired = this.options.setRequired;

      toggle.setAttribute('data-blok-database-form-required-toggle', '');
      box.type = 'checkbox';
      box.checked = required;
      box.setAttribute('data-blok-database-form-required', property.id);
      box.addEventListener('change', () => setRequired(property.id, box.checked));
      toggle.append(box, document.createTextNode(i18n.t('tools.database.formRequiredToggle')));
      wrapper.appendChild(toggle);
    }

    const maxSelections = property.type === 'multiSelect' || property.type === 'person' || property.type === 'relation'
      ? setting.maxSelections
      : undefined;

    this.fields.set(property.id, { property, field, required, maxSelections });

    return wrapper;
  }

  private field(property: PropertyDefinition, id: string, setting: ViewPropertySetting): Field {
    const options = [...(property.config?.options ?? [])].sort((a, b) => (a.position < b.position ? -1 : 1));

    if (property.type === 'person' || property.type === 'files' || property.type === 'relation') {
      return this.providerField(property, id, setting);
    }
    if (property.type === 'select' || property.type === 'status') {
      const select = document.createElement('select');
      const none = document.createElement('option');

      none.value = '';
      select.appendChild(none);
      options.forEach((option) => {
        const el = document.createElement('option');

        el.value = option.id;
        el.textContent = option.label;
        select.appendChild(el);
      });
      select.id = id;

      return select;
    }
    if (property.type === 'multiSelect') {
      const set = document.createElement('fieldset');

      set.id = id;
      options.forEach((option) => {
        const choice = document.createElement('label');
        const box = document.createElement('input');

        box.type = 'checkbox';
        box.value = option.id;
        box.addEventListener('change', () => {
          if (box.checked && setting.maxSelections !== undefined && set.querySelectorAll('input:checked').length > setting.maxSelections) {
            box.checked = false;
          }
        });
        choice.append(box, document.createTextNode(option.label));
        set.appendChild(choice);
      });

      return set;
    }
    const field = (property.type === 'text' || property.type === 'richText') && setting.longAnswer !== false
      ? document.createElement('textarea')
      : document.createElement('input');

    if (field instanceof HTMLInputElement) field.type = INPUT_TYPES[property.type] ?? 'text';
    field.id = id;

    return field;
  }

  private paintProviderField(property: PropertyDefinition, field: HTMLButtonElement): void {
    const value = this.answers.get(property.id);

    if (value === undefined) {
      field.replaceChildren(this.options.i18n.t('tools.database.formChooseAnswer'));

      return;
    }
    const context = { ...this.options.cellContext, i18n: this.options.i18n, readOnly: false, openRelated: undefined };
    const shown = renderCellValue(property, value, context);

    shown.querySelectorAll('a').forEach((link) => link.replaceWith(link.textContent ?? ''));
    field.replaceChildren(shown);
  }

  private providerField(property: PropertyDefinition, id: string, setting: ViewPropertySetting): HTMLButtonElement {
    const field = document.createElement('button');
    const context = { ...this.options.cellContext, i18n: this.options.i18n, readOnly: false, openRelated: undefined };
    const paint = (): void => this.paintProviderField(property, field);

    field.type = 'button';
    field.id = id;
    field.setAttribute('data-blok-database-form-provider-answer', '');
    field.setAttribute('aria-label', setting.questionName ?? property.name);
    field.addEventListener('click', () => {
      if (this.destroying) return;
      this.building = true;
      this.editor?.close();
      this.editor = openCellEditor(property, this.answers.get(property.id), field, {
        ...context,
        maxSelections: setting.maxSelections,
        onCommit: (value) => {
          if (this.destroying) return;
          if (value === null || (Array.isArray(value) && value.length === 0)) this.answers.delete(property.id);
          else this.answers.set(property.id, value);
          paint();
        },
        onClose: () => {
          this.editor = null;
          if (!this.destroying) this.options.onInteractionEnd?.();
        },
      });
      this.building = false;
    });
    paint();

    return field;
  }

  private addQuestion(anchor: HTMLElement): void {
    if (this.destroying) return;
    this.building = true;
    const property = this.options.addQuestion?.();

    if (property === undefined || property === null) {
      this.building = false;
      this.options.onInteractionEnd?.();

      return;
    }
    this.options.schema = [...this.options.schema, property];
    const wrapper = this.question(property, { id: property.id, visible: true });

    anchor.before(wrapper);
    const menu = wrapper.querySelector<HTMLButtonElement>('[data-blok-testid="database-form-question-menu"]');

    if (menu !== null) this.openQuestionMenu(property, menu);
    this.building = false;
  }

  private openQuestionMenu(initial: PropertyDefinition, anchor: HTMLElement): void {
    if (this.destroying) return;
    this.building = true;
    this.panel?.close();
    const state: { property: PropertyDefinition; setting: ViewPropertySetting } = {
      property: initial,
      setting: withPropertySetting(this.options.view, this.options.schema, initial.id, {})
        .find((entry) => entry.id === initial.id) ?? { id: initial.id, visible: true },
    };
    const { i18n } = this.options;
    const change = (patch: ViewPropertyPatch): void => {
      state.setting = { ...state.setting, ...patch };
      this.options.setQuestionSetting?.(state.property.id, patch);
    };
    const panel = new DatabasePanel({
      anchor,
      testId: 'database-form-question-settings',
      width: 290,
      backLabel: i18n.t('tools.database.peekBack'),
      onClose: () => {
        this.panel = null;
        if (!this.destroying) this.options.onInteractionEnd?.();
      },
      root: {
        build: () => {
          const name = panelInput({
            value: state.setting.questionName ?? state.property.name,
            placeholder: '',
            label: i18n.t('tools.database.formQuestionName'),
            testId: 'database-form-question-name',
            onInput: (value) => {
              if (value.trim() === '') return;
              if (state.setting.questionName === undefined) {
                this.options.renameProperty?.(state.property.id, value);
                state.property = { ...state.property, name: value.trim() };
              } else {
                change({ questionName: value });
              }
            },
          });
          const description = panelInput({
            value: state.setting.description ?? '',
            placeholder: i18n.t('tools.database.propertyDescriptionPlaceholder'),
            label: i18n.t('tools.database.formQuestionDescription'),
            testId: 'database-form-question-description',
            onInput: (value) => change({ description: value }),
          });
          const rows: HTMLElement[] = [
            name,
            panelSwitch({
              label: i18n.t('tools.database.formSyncPropertyName'),
              testId: 'database-form-question-sync-name',
              checked: state.setting.questionName === undefined,
              onToggle: (checked) => {
                change({ questionName: checked ? undefined : state.property.name });
                panel.refresh();
              },
            }),
            description,
            panelSwitch({
              label: i18n.t('tools.database.formRequiredToggle'),
              testId: 'database-form-question-required',
              checked: state.setting.required === true,
              onToggle: (required) => change({ required }),
            }),
            panelRow({
              label: i18n.t('tools.database.changeType'),
              value: i18n.t(propertyTypeMeta(state.property.type).labelKey),
              testId: 'database-form-question-type',
              disabled: state.property.type === 'title',
              opensPage: true,
              onClick: () => panel.push({
                title: i18n.t('tools.database.changeType'),
                build: () => addablePropertyTypes(this.options.hasPeople === true)
                  .filter((type) => ASKABLE.includes(type))
                  .map((type) => panelRow({
                    label: i18n.t(propertyTypeMeta(type).labelKey),
                    testId: `database-form-question-type-${type}`,
                    icon: propertyTypeMeta(type).icon,
                    checked: type === state.property.type,
                    onClick: () => {
                      this.options.changePropertyType?.(state.property.id, type);
                      state.property = { ...state.property, type };
                      panel.back();
                    },
                  })),
              }),
            }),
          ];

          if (state.property.type === 'text' || state.property.type === 'richText') {
            rows.push(panelSwitch({
              label: i18n.t('tools.database.formLongAnswer'),
              testId: 'database-form-question-long-answer',
              checked: state.setting.longAnswer !== false,
              onToggle: (longAnswer) => change({ longAnswer }),
            }));
          }
          if (state.property.type === 'multiSelect' || state.property.type === 'person' || state.property.type === 'relation') {
            const maximum = panelInput({
              value: state.setting.maxSelections === undefined ? '' : String(state.setting.maxSelections),
              placeholder: i18n.t('tools.database.relationLimitNone'),
              label: i18n.t('tools.database.formMaxSelections'),
              testId: 'database-form-question-max-selections',
              onInput: (value) => {
                const count = Number(value);

                if (value === '') change({ maxSelections: undefined });
                else if (Number.isInteger(count) && count > 0) change({ maxSelections: count });
              },
            });

            maximum.type = 'number';
            maximum.min = '1';
            maximum.step = '1';
            rows.push(maximum);
          }
          rows.push(
            panelRow({
              label: i18n.t('blockSettings.duplicate'),
              testId: 'database-form-duplicate-question',
              disabled: state.property.type === 'title',
              onClick: () => {
                const copy = this.options.duplicateProperty?.(state.property.id);

                if (copy !== undefined && copy !== null) {
                  const { id: _id, ...settings } = state.setting;

                  this.options.setQuestionSetting?.(copy.id, settings);
                }
                panel.close();
              },
            }),
            panelRow({
              label: i18n.t('blockSettings.delete'),
              testId: 'database-form-delete-question',
              danger: true,
              disabled: state.property.type === 'title',
              onClick: () => {
                this.options.deleteProperty?.(state.property.id);
                panel.close();
              },
            }),
          );

          return rows;
        },
      },
    });

    this.panel = panel;
    panel.open();
    this.building = false;
  }

  private answer(property: PropertyDefinition, field: Field): PropertyValue | undefined {
    if (field instanceof HTMLButtonElement) return this.answers.get(property.id);
    if (field instanceof HTMLFieldSetElement) {
      const picked = [...field.querySelectorAll<HTMLInputElement>('input:checked')].map((box) => box.value);

      return picked.length > 0 ? picked : undefined;
    }
    if (field instanceof HTMLInputElement && field.type === 'checkbox') return field.checked ? true : undefined;
    const text = field.value.trim();

    if (text === '') return undefined;
    if (property.type === 'number') {
      const n = Number(text);

      return Number.isFinite(n) ? n : undefined;
    }

    return property.type === 'place' ? { address: text } : text;
  }

  private submit(): void {
    if (this.destroying || this.options.view.form?.closed === true) return;
    const answers = [...this.fields].map(([propertyId, { property, field, required, maxSelections }]) => {
      const value = this.answer(property, field);
      const invalid = (required && value === undefined)
        || (property.type === 'email' && value !== undefined && field instanceof HTMLInputElement && field.validity.typeMismatch)
        || (property.type === 'relation' && property.relation?.limit === 1 && Array.isArray(value) && value.length > 1)
        || (maxSelections !== undefined && Array.isArray(value) && value.length > maxSelections);

      field.closest('[data-blok-database-form-question]')?.toggleAttribute('data-invalid', invalid);
      field.setAttribute('aria-invalid', String(invalid));

      return { propertyId, field, value, invalid };
    });
    const firstInvalid = answers.find((answer) => answer.invalid);

    if (firstInvalid !== undefined) {
      firstInvalid.field.focus();

      return;
    }
    this.options.onSubmit(Object.fromEntries(answers.flatMap(({ propertyId, value }) => (value === undefined ? [] : [[propertyId, value]]))));
    this.setSubmitted(true);
  }
}
