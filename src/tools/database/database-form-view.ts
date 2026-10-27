import { IconChevronUpDown, IconDotsHorizontal, IconLock } from '../../components/icons';
import { formatBytes } from '../../components/utils/format-bytes';
import type { I18n } from '../../../types';
import { safeImageSrc } from '../../components/utils/sanitize-url';
import { DEFAULT_MAX_SIZE } from '../file/constants';
import { openCellEditor, renderCellValue } from './cells';
import type { CellContext, CellEditorHandle } from './cells';
import { accessLine, openFormShare } from './database-form-share';
import type { FormShareHost } from './database-form-share';
import { nameTakenError } from './database-name-taken-error';
import { DatabasePanel, panelInput, panelLabel, panelRow, panelSwitch } from './database-panel';
import { propertyTypeMeta } from './database-property-types';
import type { DatabaseViewRenderer } from './database-view-renderer';
import { isReadOnlyType } from './property-values';
import { FORM_ASKABLE, formAnswerProblem, formQuestions } from '../../shared/database/form-questions';
import type { DatabasePerson, DatabaseRow, DatabaseSourceRef, DatabaseViewConfig, FormSettings, PropertyDefinition, PropertyType, PropertyValue, SelectOption, ViewPropertySetting } from './types';
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
  /** A new property of this type, asked as the last question. */
  addQuestion?: (type: PropertyType) => PropertyDefinition | null;
  /** Makes an existing property the last question. */
  showQuestion?: (propertyId: string) => void;
  renameProperty?: (propertyId: string, name: string) => void;
  /** Another property of this database already has `name`. Such a rename is refused (research/14 §3). */
  isNameTaken?: (propertyId: string, name: string) => boolean;
  changePropertyType?: (propertyId: string, type: PropertyType) => void;
  duplicateProperty?: (propertyId: string) => PropertyDefinition | null;
  deleteProperty?: (propertyId: string) => void;
  cellContext?: Partial<CellContext>;
  hasPeople?: boolean;
  onInteractionEnd?: () => void;
  submitted?: boolean;
  onSubmittedChange?: (submitted: boolean) => void;
  /** Who a respondent answers as, read when the form draws. Absent: no "Submitting response as" chip. */
  respondent?: () => DatabasePerson | undefined;
  /** The thank-you screen's "View my response" and "Email me a copy", read when it draws. Absent ones are not offered. */
  responseActions?: () => { view?: () => void; email?: () => void };
  /** The Share panel and the builder's access line. Only for someone who may edit the form. */
  share?: {
    /** Absent without `config.forms`: only closing the form is offered. */
    host?: FormShareHost;
    /** The saved settings, read live: the panel stays open across writes. */
    settings: () => FormSettings;
    update: (patch: Partial<FormSettings>) => void;
    copyLink: (link: string) => void;
  };
}


/** A property "Create N questions" counts and turns into a question. */
export const isAutoQuestion = (property: PropertyDefinition): boolean =>
  property.type !== 'title' && FORM_ASKABLE.includes(property.type) && !isReadOnlyType(property.type);

/** "New question" in Notion's "Select type" and "Question type" (research/19 §3b). Select, status and relation are absent. */
const NEW_QUESTION_TYPES: readonly PropertyType[] = [
  'text', 'multiSelect', 'date', 'person', 'files', 'number', 'checkbox', 'email', 'url', 'phone', 'place',
];

const PICKS_MANY: readonly PropertyType[] = ['multiSelect', 'person', 'relation'];

const INPUT_TYPES: Partial<Record<PropertyType, string>> = {
  url: 'url', email: 'email', phone: 'tel', number: 'number', date: 'date', checkbox: 'checkbox',
};

/** Notion's "Max selection" presets (research/12 §4); any other count goes in the custom field. */
const MAX_SELECTION_PRESETS = [1, 2, 3, 4, 5, 10] as const;

/** Multi-select defaults to a list (measured). Select keeps a dropdown: Notion's choice there is unmeasured. */
const showOptionsAs = (property: PropertyDefinition, setting: ViewPropertySetting): 'list' | 'dropdown' =>
  setting.showOptionsAs ?? (property.type === 'multiSelect' ? 'list' : 'dropdown');

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
        value.answer = this.answer(property, field) ?? [];
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
        const chosen = Array.isArray(value) ? value : [value];

        for (const box of field.querySelectorAll<HTMLInputElement>('input')) {
          box.checked = chosen.some((selected) => selected === box.value);
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
    const builder = this.options.share !== undefined && !this.options.readOnly;

    if (builder) root.appendChild(this.accessBar());
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

    // research/23 §6: above the questions, for the respondent only; the builder does not change.
    if (!builder && view.form?.anonymous === true) root.appendChild(this.anonymousPill());
    // Read-only submits make no row, so no Created by would name this person.
    const respondent = builder || this.options.readOnly || view.form?.anonymous === true ? undefined : this.options.respondent?.();

    // research/36 §13: with anonymous off, the respondent is named before submitting.
    if (respondent !== undefined) root.appendChild(this.respondentChip(respondent));
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
        onClick: () => this.openSelectType(add),
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

  /** "🔒 Only members at <workspace> can fill out this form." + "Change" (research/19 §3d). */
  private accessBar(): HTMLElement {
    const bar = document.createElement('div');
    const icon = document.createElement('span');
    const text = document.createElement('span');
    const change = document.createElement('button');

    bar.setAttribute('data-blok-database-form-access', '');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = IconLock;
    text.textContent = accessLine(this.options.i18n, this.options.view.form, this.options.share?.host?.workspaceName);
    change.type = 'button';
    change.setAttribute('data-blok-testid', 'database-form-access-change');
    change.textContent = this.options.i18n.t('tools.database.formShareChange');
    change.addEventListener('click', () => this.openShare(change));
    bar.append(icon, text, change);

    return bar;
  }

  private anonymousPill(): HTMLElement {
    const pill = document.createElement('p');

    pill.setAttribute('data-blok-database-form-anonymous', '');
    pill.textContent = this.options.i18n.t('tools.database.formAnonymousPill');

    return pill;
  }

  /** "Submitting response as [avatar] <name>", the avatar where the sentence names the person. */
  private respondentChip(person: DatabasePerson): HTMLElement {
    const chip = document.createElement('p');
    const [before, after = ''] = this.options.i18n.t('tools.database.formRespondentPill', { name: '\u0000' }).split('\u0000');
    const avatarUrl = person.avatarUrl === undefined ? null : safeImageSrc(person.avatarUrl);
    const avatar = document.createElement(avatarUrl === null ? 'span' : 'img');

    chip.setAttribute('data-blok-database-form-respondent', '');
    if (avatar instanceof HTMLImageElement && avatarUrl !== null) {
      avatar.src = avatarUrl;
      avatar.alt = '';
      avatar.setAttribute('data-blok-database-person-avatar', '');
    } else {
      // Drawn by CSS from the attribute, as a person chip's initial.
      avatar.setAttribute('data-blok-database-person-initial', [...person.name][0] ?? '');
      avatar.setAttribute('aria-hidden', 'true');
    }
    // Flex drops the spaces at the avatar's sides; the gap draws them.
    chip.append(before, avatar, `${person.name}${after}`);

    return chip;
  }

  /** Opens the Share panel; the toolbar's "Share form" and the access line's "Change" both land here. */
  openShare(anchor: HTMLElement): void {
    const share = this.options.share;

    if (this.destroying || share === undefined || this.options.readOnly) return;
    this.building = true;
    this.panel?.close();
    const panel = openFormShare({
      anchor,
      i18n: this.options.i18n,
      settings: share.settings,
      ...(share.host === undefined ? {} : { host: share.host }),
      update: share.update,
      copyLink: share.copyLink,
      onClose: () => {
        if (this.panel === panel) this.panel = null;
        if (!this.destroying) this.options.onInteractionEnd?.();
      },
    });

    this.panel = panel;
    panel.open();
    this.building = false;
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
    done.append(text);
    const actions = this.options.responseActions?.() ?? {};
    const buttons = [
      actions.view === undefined ? null : this.responseButton('view', 'database-form-view-response', 'tools.database.formViewResponse', actions.view),
      actions.email === undefined ? null : this.responseButton('email', 'database-form-email-copy', 'tools.database.formEmailCopy', actions.email),
    ].filter((button): button is HTMLButtonElement => button !== null);

    if (buttons.length > 0) {
      const row = document.createElement('div');

      row.setAttribute('data-blok-database-form-response-actions', '');
      row.append(...buttons);
      done.append(row);
    }
    done.append(again);

    return done;
  }

  private responseButton(kind: 'view' | 'email', testId: string, key: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');

    button.type = 'button';
    button.setAttribute('data-blok-database-form-response-action', kind);
    button.setAttribute('data-blok-testid', testId);
    button.textContent = this.options.i18n.t(key);
    button.addEventListener('click', onClick);

    return button;
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
    return formQuestions(this.options.view, this.options.schema).map(({ property, setting }) => this.question(property, setting));
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
      menu.setAttribute('aria-label', i18n.t('tools.database.formEditQuestion'));
      menu.innerHTML = IconDotsHorizontal;
      menu.addEventListener('click', () => this.openQuestionMenu(property, menu));
      header.append(label, menu);
      wrapper.appendChild(header);
    } else {
      wrapper.appendChild(label);
    }
    const hints: string[] = [];

    if (PICKS_MANY.includes(property.type)) {
      const limit = document.createElement('p');

      limit.id = `${id}-limit`;
      limit.setAttribute('data-blok-database-form-selection-limit', '');
      limit.textContent = setting.maxSelections === undefined
        ? i18n.t('tools.database.formSelectionUnlimited')
        : i18n.t('tools.database.formSelectionLimit', { count: setting.maxSelections });
      hints.push(limit.id);
      wrapper.appendChild(limit);
    }
    if (property.type === 'files' && this.options.cellContext?.uploadFile !== undefined) {
      const limit = document.createElement('p');

      limit.id = `${id}-file-limit`;
      limit.setAttribute('data-blok-database-form-file-limit', '');
      limit.textContent = i18n.t('tools.database.formFileSizeLimit', { size: formatBytes(DEFAULT_MAX_SIZE) });
      hints.push(limit.id);
      wrapper.appendChild(limit);
    }
    if (setting.description !== undefined && setting.description !== '') {
      const help = document.createElement('p');

      help.id = `${id}-help`;
      help.setAttribute('data-blok-database-form-description', '');
      help.textContent = setting.description;
      hints.push(help.id);
      wrapper.appendChild(help);
    }
    if (hints.length > 0) field.setAttribute('aria-describedby', hints.join(' '));
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

    const maxSelections = PICKS_MANY.includes(property.type) ? setting.maxSelections : undefined;

    this.fields.set(property.id, { property, field, required, maxSelections });

    return wrapper;
  }

  private field(property: PropertyDefinition, id: string, setting: ViewPropertySetting): Field {
    const options = [...(property.config?.options ?? [])].sort((a, b) => (a.position < b.position ? -1 : 1));

    if (property.type === 'person' || property.type === 'files' || property.type === 'relation') {
      return this.providerField(property, id, setting);
    }
    if (property.type === 'select' && showOptionsAs(property, setting) === 'list') {
      return this.choiceList(options, id, 'radio');
    }
    if (property.type === 'multiSelect' && showOptionsAs(property, setting) === 'dropdown') {
      return this.providerField(property, id, setting);
    }
    if (property.type === 'select') {
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
      return this.choiceList(options, id, 'checkbox', setting.maxSelections);
    }
    const field = (property.type === 'text' || property.type === 'richText') && setting.longAnswer === true
      ? document.createElement('textarea')
      : document.createElement('input');

    if (field instanceof HTMLInputElement) field.type = INPUT_TYPES[property.type] ?? 'text';
    field.id = id;

    return field;
  }

  /** Notion names both select types "Multiple choice" as questions. */
  private typeLabel(type: PropertyType): string {
    return this.options.i18n.t(type === 'select' || type === 'multiSelect'
      ? 'tools.database.formTypeMultipleChoice'
      : propertyTypeMeta(type).labelKey);
  }

  private choiceList(options: SelectOption[], id: string, kind: 'radio' | 'checkbox', maxSelections?: number): HTMLFieldSetElement {
    const set = document.createElement('fieldset');

    set.id = id;
    options.forEach((option) => {
      const choice = document.createElement('label');
      const box = document.createElement('input');

      box.type = kind;
      box.name = id;
      box.value = option.id;
      box.addEventListener('change', () => {
        if (box.checked && maxSelections !== undefined && set.querySelectorAll('input:checked').length > maxSelections) {
          box.checked = false;
        }
      });
      choice.append(box, document.createTextNode(option.label));
      set.appendChild(choice);
    });

    return set;
  }

  private paintProviderField(property: PropertyDefinition, field: HTMLButtonElement): void {
    const value = this.answers.get(property.id);
    // Only a Dropdown multiple choice reaches a provider field as multiSelect.
    const chevron = property.type === 'multiSelect' ? [this.dropdownChevron()] : [];

    if (value === undefined) {
      field.replaceChildren(this.options.i18n.t('tools.database.formChooseAnswer'), ...chevron);

      return;
    }
    const context = { ...this.options.cellContext, i18n: this.options.i18n, readOnly: false, openRelated: undefined };
    const shown = renderCellValue(property, value, context);

    shown.querySelectorAll('a').forEach((link) => link.replaceWith(link.textContent ?? ''));
    field.replaceChildren(shown, ...chevron);
  }

  /** research/12 §4: Notion's Dropdown question box ends in an up/down chevron. */
  private dropdownChevron(): HTMLSpanElement {
    const chevron = document.createElement('span');

    chevron.setAttribute('data-blok-database-form-dropdown-chevron', '');
    chevron.setAttribute('aria-hidden', 'true');
    chevron.innerHTML = IconChevronUpDown;

    return chevron;
  }

  private providerField(property: PropertyDefinition, id: string, setting: ViewPropertySetting): HTMLButtonElement {
    const field = document.createElement('button');
    const context = { ...this.options.cellContext, i18n: this.options.i18n, readOnly: false, openRelated: undefined };
    const paint = (): void => this.paintProviderField(property, field);

    field.type = 'button';
    field.id = id;
    field.setAttribute('data-blok-database-form-provider-answer', '');
    if (property.type === 'multiSelect') field.setAttribute('data-blok-database-form-dropdown', '');
    field.setAttribute('aria-label', setting.questionName ?? property.name);
    field.addEventListener('click', () => {
      if (this.destroying) return;
      this.building = true;
      this.editor?.close();
      this.editor = openCellEditor(property, this.answers.get(property.id), field, {
        ...context,
        ...(property.type === 'files' && context.uploadFile !== undefined ? { uploadFile: this.cappedUpload(field, context.uploadFile) } : {}),
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

  /**
   * The database upload path has no size cap of its own, so the form keeps
   * the file tool's default; a larger file shows the file tool's message.
   */
  private cappedUpload(field: HTMLElement, upload: NonNullable<CellContext['uploadFile']>): NonNullable<CellContext['uploadFile']> {
    return (file) => {
      const wrapper = field.closest('[data-blok-database-form-question]');

      wrapper?.querySelector('[data-blok-database-form-file-error]')?.remove();
      if (file.size <= DEFAULT_MAX_SIZE) return upload(file);
      const error = document.createElement('p');

      error.setAttribute('data-blok-database-form-file-error', '');
      error.setAttribute('role', 'alert');
      error.textContent = this.options.i18n.t('tools.file.errorFileTooLarge')
        .replace(/\{size\}/g, formatBytes(file.size))
        .replace(/\{max\}/g, formatBytes(DEFAULT_MAX_SIZE));
      field.after(error);

      return Promise.reject(new Error('FILE_TOO_LARGE'));
    };
  }

  /** Notion's "Select type" (research/19 §3b): existing properties that are not questions yet, then new question types. */
  private openSelectType(anchor: HTMLElement): void {
    if (this.destroying) return;
    this.building = true;
    this.panel?.close();
    const { i18n, view, schema } = this.options;
    const asked = new Set(resolveViewProperties(view, schema).filter((entry) => entry.visible).map((entry) => entry.id));
    const panel = new DatabasePanel({
      anchor,
      testId: 'database-form-select-type',
      width: 290,
      backLabel: i18n.t('tools.database.peekBack'),
      onClose: () => {
        if (this.panel === panel) this.panel = null;
        if (!this.destroying) this.options.onInteractionEnd?.();
      },
      root: {
        title: i18n.t('tools.database.formSelectType'),
        build: () => {
          const existing = this.options.showQuestion === undefined
            ? []
            : this.options.schema.filter((property) => isAutoQuestion(property) && !asked.has(property.id));
          const rows: HTMLElement[] = existing.length === 0 ? [] : [
            panelLabel(i18n.t('tools.database.formExistingProperties')),
            ...existing.map((property) => panelRow({
              label: property.name,
              description: i18n.t(propertyTypeMeta(property.type).labelKey),
              icon: propertyTypeMeta(property.type).icon,
              testId: `database-form-existing-${property.id}`,
              onClick: () => {
                panel.close();
                this.options.showQuestion?.(property.id);
              },
            })),
          ];

          return [
            ...rows,
            panelLabel(i18n.t('tools.database.formNewQuestion')),
            ...NEW_QUESTION_TYPES.filter((type) => type !== 'person' || this.options.hasPeople === true).map((type) => panelRow({
              label: this.typeLabel(type),
              icon: propertyTypeMeta(type).icon,
              testId: `database-form-new-${type}`,
              onClick: () => {
                panel.close();
                this.addQuestion(anchor, type);
              },
            })),
          ];
        },
      },
    });

    this.panel = panel;
    panel.open();
    this.building = false;
  }

  private addQuestion(anchor: HTMLElement, type: PropertyType): void {
    if (this.destroying) return;
    this.building = true;
    const property = this.options.addQuestion?.(type);

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
    const state: { property: PropertyDefinition; setting: ViewPropertySetting; typedName?: string } = {
      property: initial,
      setting: withPropertySetting(this.options.view, this.options.schema, initial.id, {})
        .find((entry) => entry.id === initial.id) ?? { id: initial.id, visible: true },
    };
    const { i18n } = this.options;
    const change = (patch: ViewPropertyPatch): void => {
      state.setting = { ...state.setting, ...patch };
      this.options.setQuestionSetting?.(state.property.id, patch);
    };
    // Like the property menu: the rename lands on change, Enter or close, never per key,
    // so a refused last key cannot leave a half-typed name (research/14 §3).
    const commitName = (): void => {
      const name = state.typedName?.trim();

      state.typedName = undefined;
      if (name === undefined || name === '' || name === state.property.name || state.setting.questionName !== undefined) return;
      if (this.options.isNameTaken?.(state.property.id, name) === true) return;
      this.options.renameProperty?.(state.property.id, name);
      state.property = { ...state.property, name };
    };
    const panel = new DatabasePanel({
      anchor,
      testId: 'database-form-question-settings',
      width: 290,
      backLabel: i18n.t('tools.database.peekBack'),
      onClose: () => {
        this.panel = null;
        if (this.destroying) return;
        commitName();
        this.options.onInteractionEnd?.();
      },
      root: {
        build: () => {
          const name = panelInput({
            value: state.setting.questionName ?? state.property.name,
            placeholder: '',
            label: i18n.t('tools.database.formQuestionName'),
            testId: 'database-form-question-name',
            onInput: (value) => {
              if (state.setting.questionName !== undefined) {
                if (value.trim() !== '') change({ questionName: value });

                return;
              }
              const typed = value.trim();

              state.typedName = value;
              takenError.show(typed !== state.property.name && this.options.isNameTaken?.(state.property.id, typed) === true ? typed : null);
            },
          });
          const takenError = nameTakenError(name, 'data-blok-database-form-question-name-error', i18n);

          name.addEventListener('change', commitName);
          name.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' || event.isComposing) return;
            event.preventDefault();
            if (!takenError.element.hidden) return;
            commitName();
            panel.close();
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
            takenError.element,
            panelSwitch({
              label: i18n.t('tools.database.formSyncPropertyName'),
              testId: 'database-form-question-sync-name',
              checked: state.setting.questionName === undefined,
              onToggle: (checked) => {
                commitName();
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
              value: this.typeLabel(state.property.type),
              testId: 'database-form-question-type',
              disabled: state.property.type === 'title',
              opensPage: true,
              onClick: () => {
                commitName();
                panel.push({
                  title: i18n.t('tools.database.changeType'),
                  build: () => NEW_QUESTION_TYPES
                    .filter((type) => type !== 'person' || this.options.hasPeople === true)
                    .map((type) => panelRow({
                      label: this.typeLabel(type),
                      testId: `database-form-question-type-${type}`,
                      icon: propertyTypeMeta(type).icon,
                      checked: this.typeLabel(type) === this.typeLabel(state.property.type),
                      onClick: () => {
                        // A Select already reads "Multiple choice": the checked row must not convert it.
                        if (this.typeLabel(type) !== this.typeLabel(state.property.type)) {
                          this.options.changePropertyType?.(state.property.id, type);
                          state.property = { ...state.property, type };
                        }
                        panel.back();
                      },
                    })),
                });
              },
            }),
          ];

          if (state.property.type === 'text' || state.property.type === 'richText') {
            rows.push(panelSwitch({
              label: i18n.t('tools.database.formLongAnswer'),
              testId: 'database-form-question-long-answer',
              checked: state.setting.longAnswer === true,
              onToggle: (longAnswer) => change({ longAnswer }),
            }));
          }
          if (state.property.type === 'select' || state.property.type === 'multiSelect') {
            const shown = showOptionsAs(state.property, state.setting);
            const label = (choice: 'list' | 'dropdown'): string =>
              i18n.t(choice === 'list' ? 'tools.database.formShowOptionsList' : 'tools.database.formShowOptionsDropdown');

            rows.push(panelRow({
              label: i18n.t('tools.database.formShowOptionsAs'),
              value: label(shown),
              testId: 'database-form-question-show-options-as',
              opensPage: true,
              onClick: () => panel.push({
                title: i18n.t('tools.database.formShowOptionsAs'),
                build: () => (['list', 'dropdown'] as const).map((choice) => panelRow({
                  label: label(choice),
                  testId: `database-form-question-show-options-as-${choice}`,
                  checked: choice === showOptionsAs(state.property, state.setting),
                  onClick: () => {
                    change({ showOptionsAs: choice });
                    panel.back();
                  },
                })),
              }),
            }));
          }
          if (PICKS_MANY.includes(state.property.type)) {
            const unlimited = i18n.t('tools.database.formSelectionUnlimitedChoice');

            rows.push(panelRow({
              label: i18n.t('tools.database.formMaxSelections'),
              value: state.setting.maxSelections === undefined ? unlimited : String(state.setting.maxSelections),
              testId: 'database-form-question-max-selection',
              opensPage: true,
              onClick: () => panel.push({
                title: i18n.t('tools.database.formMaxSelections'),
                build: () => {
                  const custom = panelInput({
                    value: state.setting.maxSelections === undefined ? '' : String(state.setting.maxSelections),
                    placeholder: i18n.t('tools.database.formSelectionCustom'),
                    label: i18n.t('tools.database.formSelectionCustom'),
                    testId: 'database-form-question-max-selections',
                    onInput: (value) => {
                      const count = Number(value);

                      if (value === '') change({ maxSelections: undefined });
                      else if (Number.isInteger(count) && count > 0) change({ maxSelections: count });
                    },
                  });

                  custom.type = 'number';
                  custom.min = '1';
                  custom.step = '1';

                  return [
                    ...[undefined, ...MAX_SELECTION_PRESETS].map((count) => panelRow({
                      label: count === undefined ? unlimited : String(count),
                      testId: `database-form-question-max-selection-${count ?? 'unlimited'}`,
                      checked: state.setting.maxSelections === count,
                      onClick: () => {
                        change({ maxSelections: count });
                        panel.back();
                      },
                    })),
                    custom,
                  ];
                },
              }),
            }));
          }
          // Notion offers no "Duplicate question" on a relation (research/19 §3b).
          if (state.property.type !== 'relation') {
            rows.push(panelRow({
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
            }));
          }
          rows.push(
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

      if (picked.length === 0) return undefined;

      return property.type === 'multiSelect' ? picked : picked[0];
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
      // The same checks an agent's database.submitForm runs, plus the browser's own email check.
      const invalid = formAnswerProblem({ property, setting: { id: propertyId, required, maxSelections } }, value) !== undefined
        || (property.type === 'email' && value !== undefined && field instanceof HTMLInputElement && field.validity.typeMismatch);

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
