import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DatabaseFormView } from '../../../../src/tools/database/database-form-view';
import type { DatabaseFormViewOptions } from '../../../../src/tools/database/database-form-view';
import { IconChevronUpDown } from '../../../../src/components/icons';
import type { DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

/** An icon string as the DOM serializes it once it is set as innerHTML. */
const markup = (svg: string): string => Object.assign(document.createElement('span'), { innerHTML: svg }).innerHTML;

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'email', name: 'Email', type: 'email', position: 'a1' },
  { id: 'size', name: 'Team size', type: 'number', position: 'a2' },
  { id: 'agree', name: 'Agree', type: 'checkbox', position: 'a3' },
  {
    id: 'pick', name: 'Pick', type: 'select', position: 'a4', config: {
      options: [{ id: 'o1', label: 'One', position: 'a0' }, { id: 'o2', label: 'Two', position: 'a1' }],
    },
  },
  { id: 'made', name: 'Created', type: 'createdTime', position: 'a5' },
  { id: 'hidden', name: 'Hidden', type: 'text', position: 'a6' },
];

const view = (extra: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id: 'form',
  name: 'Form',
  type: 'form',
  position: 'a0',
  sorts: [],
  filters: [],
  visibleProperties: [],
  properties: [
    { id: 'email', visible: true, required: true, description: 'Work address' },
    { id: 'title', visible: true },
    { id: 'hidden', visible: false },
  ],
  ...extra,
});

const mount = (overrides: Partial<DatabaseFormViewOptions> = {}): { root: HTMLElement; submit: ReturnType<typeof vi.fn>; options: DatabaseFormViewOptions } => {
  const submit = vi.fn();
  const options: DatabaseFormViewOptions = {
    i18n: { t: (key: string) => key },
    view: view(),
    schema,
    readOnly: false,
    onSubmit: submit,
    ...overrides,
  };
  const root = new DatabaseFormView(options).createView();

  document.body.appendChild(root);

  return { root, submit, options };
};

const question = (root: HTMLElement, id: string): HTMLElement | null => root.querySelector(`[data-blok-database-form-question="${id}"]`);
const field = <T extends HTMLElement>(root: HTMLElement, id: string): T => {
  const el = question(root, id)?.querySelector<T>('input:not([data-blok-database-form-question-name]), textarea, select');

  if (el === null || el === undefined) throw new Error(`no field for ${id}`);

  return el;
};
const submitForm = (root: HTMLElement): void => {
  root.querySelector<HTMLButtonElement>('[data-blok-database-form-submit]')?.click();
};

describe('DatabaseFormView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('asks one question per visible, writable property, in the view\'s order, and owns its keyboard', () => {
    const { root } = mount();
    const ids = [...root.querySelectorAll('[data-blok-database-form-question]')].map((el) => el.getAttribute('data-blok-database-form-question'));

    expect(ids).toEqual(['email', 'title', 'size', 'agree', 'pick']);
    expect(root.hasAttribute('data-blok-keyboard-owner')).toBe(true);
    expect(question(root, 'email')?.textContent).toContain('Work address');
    expect(field<HTMLInputElement>(root, 'email').required).toBe(true);
  });

  it('refuses a submit with a required question left empty and marks it', () => {
    const { root, submit } = mount();

    submitForm(root);

    expect(submit).not.toHaveBeenCalled();
    expect(question(root, 'email')?.hasAttribute('data-invalid')).toBe(true);
    expect(field<HTMLInputElement>(root, 'email').getAttribute('aria-invalid')).toBe('true');
  });

  it('submits the answers by property id, typed as each property stores them, then confirms', () => {
    const { root, submit } = mount({ view: view({ form: { confirmation: 'Thanks!' } }) });

    field<HTMLInputElement>(root, 'email').value = 'a@b.co';
    field<HTMLInputElement>(root, 'title').value = 'Ada';
    field<HTMLInputElement>(root, 'size').value = '12';
    field<HTMLInputElement>(root, 'agree').checked = true;
    field<HTMLSelectElement>(root, 'pick').value = 'o2';
    submitForm(root);

    expect(submit).toHaveBeenCalledWith({ email: 'a@b.co', title: 'Ada', size: 12, agree: true, pick: 'o2' });
    expect(root.querySelector('[data-blok-database-form-confirmation]')?.textContent).toBe('Thanks!');
  });

  it('"Submit another response" brings the questions back, empty', () => {
    const onSubmittedChange = vi.fn();
    const { root } = mount({ view: view({ properties: [{ id: 'title', visible: true }] }), onSubmittedChange });

    field<HTMLInputElement>(root, 'title').value = 'Ada';
    submitForm(root);
    expect(onSubmittedChange).toHaveBeenLastCalledWith(true);
    root.querySelector<HTMLButtonElement>('[data-blok-database-form-again]')?.click();

    expect(onSubmittedChange).toHaveBeenLastCalledWith(false);
    expect(field<HTMLInputElement>(root, 'title').value).toBe('');
  });

  it('a redraw after a submit keeps the confirmation', () => {
    const { root } = mount({ submitted: true });

    expect(root.querySelector('[data-blok-database-form-confirmation]')).not.toBeNull();
    expect(root.querySelector('[data-blok-database-form-submit]')).toBeNull();
  });

  it('leaves out questions left empty', () => {
    const { root, submit } = mount({ view: view({ properties: [{ id: 'title', visible: true }] }) });

    field<HTMLInputElement>(root, 'title').value = 'Ada';
    submitForm(root);

    expect(submit).toHaveBeenCalledWith({ title: 'Ada' });
  });

  it('a closed form shows that and takes no answers', () => {
    const { root } = mount({ view: view({ form: { closed: true } }) });

    expect(root.querySelector('[data-blok-database-form-closed]')).not.toBeNull();
    expect(root.querySelector('[data-blok-database-form-submit]')).toBeNull();
  });

  // notion-motion.md Round 31 §1: the builder has no Submit; only the preview does.
  it('the builder draws no Submit, and Enter in its lone answer makes no response', () => {
    const { root, submit } = mount({
      view: view({ properties: [{ id: 'title', visible: true }] }),
      share: { settings: () => ({}), update: vi.fn(), copyLink: vi.fn() },
    });

    expect(root.querySelector('[data-blok-database-form-submit]')).toBeNull();
    field<HTMLInputElement>(root, 'title').value = 'Ada';
    root.querySelector('form')?.requestSubmit();

    expect(submit).not.toHaveBeenCalled();
    expect(root.querySelector('[data-blok-database-form-confirmation]')).toBeNull();
  });

  it('in edit mode, the Required toggle writes the view property setting', () => {
    const setRequired = vi.fn();
    const { root } = mount({ setRequired });

    root.querySelector<HTMLInputElement>('[data-blok-database-form-required="title"]')?.click();

    expect(setRequired).toHaveBeenCalledWith('title', true);
  });

  describe('question options', () => {
    const tags: PropertyDefinition = {
      id: 'tags', name: 'Tags', type: 'multiSelect', position: 'a7', config: {
        options: [{ id: 't1', label: 'Red', position: 'a0' }, { id: 't2', label: 'Blue', position: 'a1' }],
      },
    };
    const notes: PropertyDefinition = { id: 'notes', name: 'Notes', type: 'text', position: 'a8' };
    const ask = (properties: DatabaseViewConfig['properties'], readOnly = false): ReturnType<typeof mount> => mount({
      schema: [...schema, tags, notes],
      view: view({ properties }),
      readOnly,
      i18n: { t: (key: string, vars?: Record<string, string | number>) => (vars === undefined ? key : `${key}:${JSON.stringify(vars)}`) },
    });
    const helper = (root: HTMLElement, id: string): string | null | undefined =>
      question(root, id)?.querySelector('[data-blok-database-form-selection-limit]')?.textContent;

    it('a text answer is one line until Long answer is on', () => {
      const short = ask([{ id: 'notes', visible: true }]).root;

      expect(question(short, 'notes')?.querySelector('textarea')).toBeNull();
      expect(question(short, 'notes')?.querySelector('input[type="text"]')).not.toBeNull();
      document.body.innerHTML = '';
      const long = ask([{ id: 'notes', visible: true, longAnswer: true }]).root;

      expect(question(long, 'notes')?.querySelector('textarea')).not.toBeNull();
    });

    it('a select question shown as a list takes one radio pick and submits the option id', () => {
      const { root, submit } = ask([{ id: 'pick', visible: true, showOptionsAs: 'list' }]);
      const radios = [...(question(root, 'pick')?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? [])];

      expect(question(root, 'pick')?.querySelector('select')).toBeNull();
      expect(radios.map((radio) => radio.value)).toEqual(['o1', 'o2']);
      radios[0].click();
      radios[1].click();
      submitForm(root);

      expect(submit).toHaveBeenCalledWith({ pick: 'o2' });
    });

    it('a select question is a dropdown by default', () => {
      const { root } = ask([{ id: 'pick', visible: true }]);

      expect(question(root, 'pick')?.querySelector('select')).not.toBeNull();
    });

    it('a multiple choice question is a checkbox list by default and says respondents can pick any number', () => {
      const { root } = ask([{ id: 'tags', visible: true }]);

      expect(helper(root, 'tags')).toBe('tools.database.formSelectionUnlimited');
      expect(question(root, 'tags')?.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    });

    it('a multiple choice question with a limit says so, links the hint and blocks extra picks', () => {
      const { root, submit } = ask([{ id: 'tags', visible: true, maxSelections: 1, description: 'Pick a color' }]);
      const boxes = [...(question(root, 'tags')?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? [])];
      const set = question(root, 'tags')?.querySelector('fieldset');
      const hint = question(root, 'tags')?.querySelector('[data-blok-database-form-selection-limit]');

      expect(helper(root, 'tags')).toBe('tools.database.formSelectionLimit:{"count":1}');
      expect(set?.getAttribute('aria-describedby')?.split(' ')).toContain(hint?.id);
      expect(set?.getAttribute('aria-describedby')?.split(' ')).toHaveLength(2);
      boxes[0].click();
      boxes[1].click();
      submitForm(root);

      expect(submit).toHaveBeenCalledWith({ tags: ['t1'] });
    });

    it('read-only still shows the selection limit', () => {
      const { root } = ask([{ id: 'tags', visible: true, maxSelections: 2 }], true);

      expect(helper(root, 'tags')).toBe('tools.database.formSelectionLimit:{"count":2}');
    });

    it('a multiple choice dropdown opens the option picker without option editing and stops at the limit', () => {
      const { root, submit } = ask([{ id: 'tags', visible: true, showOptionsAs: 'dropdown', maxSelections: 1 }]);
      const answer = question(root, 'tags')?.querySelector<HTMLButtonElement>('button[data-blok-database-form-provider-answer]');

      expect(question(root, 'tags')?.querySelector('fieldset')).toBeNull();
      expect(answer).not.toBeNull();
      answer?.click();
      expect(document.querySelector('[data-blok-database-select-editor="multiSelect"]')).not.toBeNull();
      expect(document.querySelector('[data-blok-database-select-option-menu]')).toBeNull();
      document.querySelector<HTMLElement>('[data-blok-database-select-option="t1"]')?.click();
      document.querySelector<HTMLElement>('[data-blok-database-select-option="t2"]')?.click();
      submitForm(root);

      expect(submit).toHaveBeenCalledWith({ tags: ['t1'] });
    });

    // research/12 §4 (87-dropdown-selected.png): a Dropdown question's box ends in an up/down chevron.
    it('a multiple choice dropdown ends in an up/down chevron that survives a pick', () => {
      const { root } = ask([{ id: 'tags', visible: true, showOptionsAs: 'dropdown' }]);
      const answer = question(root, 'tags')?.querySelector<HTMLButtonElement>('button[data-blok-database-form-provider-answer]');
      const chevron = (): string | undefined => answer?.querySelector('[data-blok-database-form-dropdown-chevron]')?.innerHTML;

      expect(answer?.hasAttribute('data-blok-database-form-dropdown')).toBe(true);
      expect(chevron()).toBe(markup(IconChevronUpDown));
      answer?.click();
      document.querySelector<HTMLElement>('[data-blok-database-select-option="t1"]')?.click();
      expect(chevron()).toBe(markup(IconChevronUpDown));
    });

    it('a person, file or list answer has no up/down chevron', () => {
      const { root } = ask([{ id: 'tags', visible: true }]);

      expect(root.querySelector('[data-blok-database-form-dropdown-chevron]')).toBeNull();
    });
  });

  it('read-only shows no Required toggles', () => {
    const { root } = mount({ readOnly: true, setRequired: vi.fn() });

    expect(root.querySelector('[data-blok-database-form-required]')).toBeNull();
  });
});

// research/14 §3: the question name field refuses a taken name the way the property menu does.
describe('DatabaseFormView question rename to a taken name', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const open = (): { input: HTMLInputElement; renameProperty: ReturnType<typeof vi.fn>; setQuestionSetting: ReturnType<typeof vi.fn>; type: (value: string) => void } => {
    const renameProperty = vi.fn();
    const setQuestionSetting = vi.fn();
    const { root } = mount({
      i18n: { t: (key: string, params?: Record<string, string | number>) => `${key}:${String(params?.name ?? '')}` },
      setQuestionSetting,
      renameProperty,
      isNameTaken: (propertyId: string, name: string) => propertyId === 'email' && name === 'Team size',
    });

    // notion-motion.md Round 31 §1: the name is edited in the card.
    const input = question(root, 'email')?.querySelector<HTMLInputElement>('[data-blok-testid="database-form-question-name"]') ?? null;

    if (input === null) throw new Error('no question name input');
    const type = (value: string): void => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };

    return { input, renameProperty, setQuestionSetting, type };
  };
  const error = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-database-form-question-name-error]');

  it('shows "A property named <name> already exists" under the field, keeps the typed text and does not rename', () => {
    const { input, renameProperty, type } = open();

    type('Team size');

    expect(error()?.hidden).toBe(false);
    expect(error()?.textContent).toBe('tools.database.propertyNameTaken:Team size');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(error()?.id);
    expect(input.value).toBe('Team size');
    expect(renameProperty).not.toHaveBeenCalled();
  });

  it('clears the error once the name is free and renames on change, not per key', () => {
    const { input, renameProperty, type } = open();

    type('Team size');
    type('Team');

    expect(error()?.hidden).toBe(true);
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(input.hasAttribute('aria-describedby')).toBe(false);
    expect(renameProperty).not.toHaveBeenCalled();
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(renameProperty).toHaveBeenCalledWith('email', 'Team');
  });

  it('Enter on a taken name does not rename; on a free name it renames and leaves the field', () => {
    const { input, renameProperty, type } = open();
    const enter = (): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });

      input.dispatchEvent(event);

      return event;
    };

    input.focus();
    type('Team size');
    expect(enter().defaultPrevented).toBe(true);
    expect(renameProperty).not.toHaveBeenCalled();
    expect(input).toHaveFocus();
    type('Team');
    enter();
    expect(renameProperty).toHaveBeenCalledTimes(1);
    expect(renameProperty).toHaveBeenCalledWith('email', 'Team');
    expect(input).not.toHaveFocus();
  });
});

// notion-motion.md Round 31 §1: the question name is a 24px 700 textbox in the card.
describe('DatabaseFormView in-card question name', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const nameOf = (root: HTMLElement, id: string): HTMLInputElement | null =>
    question(root, id)?.querySelector<HTMLInputElement>('[data-blok-testid="database-form-question-name"]') ?? null;

  it('the builder card holds a "Question name" textbox; the panel no longer does', () => {
    const { root } = mount({ setQuestionSetting: vi.fn(), renameProperty: vi.fn() });
    const name = nameOf(root, 'email');

    expect(name?.value).toBe('Email');
    expect(name?.getAttribute('value')).toBe('Email');
    expect(name?.placeholder).toBe('tools.database.formQuestionNamePlaceholder');
    expect(name?.getAttribute('aria-label')).toBe('tools.database.formQuestionName');
    expect(field<HTMLInputElement>(root, 'email').getAttribute('aria-label')).toBe('Email');
    question(root, 'email')?.querySelector<HTMLButtonElement>('[data-blok-testid="database-form-question-menu"]')?.click();
    expect(document.querySelector('[data-blok-testid="database-form-question-settings"] [data-blok-testid="database-form-question-name"]')).toBeNull();
  });

  it('a respondent sees the name as a label, not a textbox', () => {
    const { root } = mount({ readOnly: true });

    expect(nameOf(root, 'email')).toBeNull();
    expect(question(root, 'email')?.querySelector('label[data-blok-database-form-label]')?.textContent).toContain('Email');
  });

  it('with sync off, a change writes the question name, not the property', () => {
    const setQuestionSetting = vi.fn();
    const renameProperty = vi.fn();
    const { root } = mount({
      view: view({ properties: [{ id: 'email', visible: true, questionName: 'Your email' }] }),
      setQuestionSetting,
      renameProperty,
    });
    const name = nameOf(root, 'email');

    if (name === null) throw new Error('no name');
    expect(name.value).toBe('Your email');
    name.value = 'Work email';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    expect(setQuestionSetting).not.toHaveBeenCalled();
    name.dispatchEvent(new Event('change', { bubbles: true }));

    expect(setQuestionSetting).toHaveBeenCalledWith('email', { questionName: 'Work email' });
    expect(renameProperty).not.toHaveBeenCalled();
  });

  it('an emptied name goes back to the current one and writes nothing', () => {
    const renameProperty = vi.fn();
    const { root } = mount({ setQuestionSetting: vi.fn(), renameProperty });
    const name = nameOf(root, 'email');

    if (name === null) throw new Error('no name');
    name.value = '  ';
    name.dispatchEvent(new Event('change', { bubbles: true }));

    expect(renameProperty).not.toHaveBeenCalled();
    expect(name.value).toBe('Email');
  });

  it('keeps the view from redrawing while the name has focus, and ends the edit on leaving it', () => {
    const onInteractionEnd = vi.fn();
    const formView = new DatabaseFormView({
      i18n: { t: (key: string) => key }, view: view(), schema, readOnly: false, onSubmit: vi.fn(),
      setQuestionSetting: vi.fn(), renameProperty: vi.fn(), onInteractionEnd,
    });
    const root = formView.createView();

    document.body.appendChild(root);
    const name = nameOf(root, 'email');

    name?.focus();
    expect(formView.interacting).toBe(true);
    name?.blur();
    expect(formView.interacting).toBe(false);
    expect(onInteractionEnd).toHaveBeenCalled();
  });

  // A redraw on the way to the next control would drop that control: Tab, or a click on ⋯ or "+".
  it('moving focus on to another control of the form does not end the edit yet', () => {
    const onInteractionEnd = vi.fn();
    const formView = new DatabaseFormView({
      i18n: { t: (key: string) => key }, view: view(), schema, readOnly: false, onSubmit: vi.fn(),
      setQuestionSetting: vi.fn(), renameProperty: vi.fn(), onInteractionEnd,
      share: { settings: () => ({}), update: vi.fn(), copyLink: vi.fn() },
    });
    const root = formView.createView();

    document.body.appendChild(root);
    const title = root.querySelector<HTMLInputElement>('[data-blok-database-form-header-title]');
    const description = root.querySelector<HTMLInputElement>('[data-blok-database-form-header-description]');
    const menu = question(root, 'email')?.querySelector<HTMLButtonElement>('[data-blok-testid="database-form-question-menu"]');

    title?.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: description }));
    nameOf(root, 'email')?.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: menu }));
    expect(onInteractionEnd).not.toHaveBeenCalled();
    description?.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    expect(onInteractionEnd).toHaveBeenCalledTimes(1);
  });
});

describe('DatabaseFormView question chip name', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('names the ••• chip "Edit question", as Notion does (research/21 form)', () => {
    const { root } = mount({ setQuestionSetting: vi.fn() });
    const chip = question(root, 'email')?.querySelector<HTMLButtonElement>('[data-blok-testid="database-form-question-menu"]');

    expect(chip?.getAttribute('aria-label')).toBe('tools.database.formEditQuestion');
  });
});

// notion-motion.md Round 31 §1 (r31-form-qmenu.raw): Question options rows and their order.
describe('DatabaseFormView question options rows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const open = (id: string, overrides: Partial<DatabaseFormViewOptions> = {}): DatabaseFormViewOptions => {
    const { root, options } = mount({ setQuestionSetting: vi.fn(), ...overrides });

    question(root, id)?.querySelector<HTMLButtonElement>('[data-blok-testid="database-form-question-menu"]')?.click();

    return options;
  };
  const panel = (): HTMLElement | null => document.querySelector('[data-blok-testid="database-form-question-settings"]');
  const row = (testId: string): HTMLButtonElement | null => document.querySelector(`[data-blok-testid="${testId}"]`);
  const labels = (): string[] => [...(panel()?.querySelectorAll('[data-blok-database-panel-label]') ?? [])].map((el) => el.textContent ?? '');

  it('is headed "Question options" and lists Notion\'s rows in Notion\'s order', () => {
    open('size', { openLinkedProperty: vi.fn(), moveQuestion: vi.fn() });

    expect(panel()?.textContent).toContain('tools.database.formQuestionOptions');
    expect(labels()).toEqual([
      'tools.database.formRequiredToggle',
      'tools.database.formQuestionType',
      'tools.database.formViewLinkedProperty',
      'tools.database.formSyncPropertyName',
      'tools.database.formMoveQuestion',
      'tools.database.formDuplicateQuestion',
      'tools.database.formDeleteQuestion',
    ]);
  });

  it('View linked property closes the panel and opens the property\'s own menu', () => {
    const openLinkedProperty = vi.fn();

    open('size', { openLinkedProperty });
    row('database-form-question-linked-property')?.click();

    expect(openLinkedProperty).toHaveBeenCalledWith('size', expect.any(HTMLElement));
    expect(panel()).toBeNull();
  });

  it('Move question moves it up or down among the questions, and not past either end', () => {
    const moveQuestion = vi.fn();

    // Questions in order: email, title, size, agree, pick.
    open('title', { moveQuestion });
    row('database-form-question-move')?.click();
    expect(row('database-form-question-move-up')?.disabled).toBe(false);
    row('database-form-question-move-up')?.click();
    expect(moveQuestion).toHaveBeenLastCalledWith('title', 'email');
    expect(panel()).toBeNull();

    document.body.innerHTML = '';
    open('title', { moveQuestion });
    row('database-form-question-move')?.click();
    row('database-form-question-move-down')?.click();
    expect(moveQuestion).toHaveBeenLastCalledWith('title', 'agree');

    document.body.innerHTML = '';
    open('email', { moveQuestion });
    row('database-form-question-move')?.click();
    expect(row('database-form-question-move-up')?.disabled).toBe(true);

    document.body.innerHTML = '';
    open('pick', { moveQuestion });
    row('database-form-question-move')?.click();
    expect(row('database-form-question-move-down')?.disabled).toBe(true);
  });

  it('moving the second-to-last question down puts it last', () => {
    const moveQuestion = vi.fn();

    open('agree', { moveQuestion });
    row('database-form-question-move')?.click();
    row('database-form-question-move-down')?.click();

    expect(moveQuestion).toHaveBeenCalledWith('agree', null);
  });
});

// notion-motion.md Round 31 §1: "+" in the gap between cards adds a question there.
describe('DatabaseFormView add question between cards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const ids = (root: HTMLElement): Array<string | null> =>
    [...root.querySelectorAll('[data-blok-database-form-question]')].map((el) => el.getAttribute('data-blok-database-form-question'));
  const insertAbove = (root: HTMLElement, id: string): HTMLButtonElement | null =>
    question(root, id)?.querySelector<HTMLButtonElement>('[data-blok-testid="database-form-insert-question"]') ?? null;
  const notes: PropertyDefinition = { id: 'notes', name: 'Notes', type: 'text', position: 'a9' };

  it('draws a "+" in every gap between cards, none above the first', () => {
    const { root } = mount({ setQuestionSetting: vi.fn(), addQuestion: vi.fn() });

    expect(insertAbove(root, 'email')).toBeNull();
    expect(insertAbove(root, 'title')?.getAttribute('aria-label')).toBe('tools.database.formAddQuestion');
    expect(insertAbove(root, 'pick')).not.toBeNull();
  });

  it('a click opens a slot and Select type there; Escape removes the slot', () => {
    const { root } = mount({ setQuestionSetting: vi.fn(), addQuestion: vi.fn() });

    insertAbove(root, 'size')?.click();
    const slot = root.querySelector('[data-blok-database-form-slot]');

    expect(slot?.nextElementSibling).toBe(question(root, 'size'));
    expect(document.querySelector('[data-blok-testid="database-form-select-type"]')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(document.querySelector('[data-blok-testid="database-form-select-type"]')).toBeNull();
    expect(root.querySelector('[data-blok-database-form-slot]')).toBeNull();
  });

  it('a picked type becomes a question in that gap', () => {
    const addQuestion = vi.fn((): PropertyDefinition => notes);
    const { root } = mount({ setQuestionSetting: vi.fn(), addQuestion });

    insertAbove(root, 'size')?.click();
    document.querySelector<HTMLElement>('[data-blok-testid="database-form-new-text"]')?.click();

    expect(addQuestion).toHaveBeenCalledWith('text', 'size');
    expect(ids(root)).toEqual(['email', 'title', 'notes', 'size', 'agree', 'pick']);
    expect(root.querySelector('[data-blok-database-form-slot]')).toBeNull();
  });

  it('the end row still adds a question last', () => {
    const addQuestion = vi.fn((): PropertyDefinition => notes);
    const { root } = mount({ setQuestionSetting: vi.fn(), addQuestion });

    root.querySelector<HTMLElement>('[data-blok-testid="database-form-add-question"]')?.click();
    document.querySelector<HTMLElement>('[data-blok-testid="database-form-new-text"]')?.click();

    expect(addQuestion).toHaveBeenCalledWith('text', undefined);
    expect(ids(root).at(-1)).toBe('notes');
  });

  // Round 31 §1: Select type rows are 44 tall with a framed 32px icon.
  it('marks Select type\'s new question rows for their framed-icon look', () => {
    const { root } = mount({ setQuestionSetting: vi.fn(), addQuestion: vi.fn() });

    root.querySelector<HTMLElement>('[data-blok-testid="database-form-add-question"]')?.click();

    expect(document.querySelector('[data-blok-testid="database-form-new-text"]')?.hasAttribute('data-blok-database-form-type-row')).toBe(true);
  });
});

// notion-motion.md Round 31 §1: the form header, a 40px "Form title" and "Description (optional)".
describe('DatabaseFormView header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const builder = (form: DatabaseViewConfig['form'] = {}): { root: HTMLElement; update: ReturnType<typeof vi.fn> } => {
    const update = vi.fn();
    const { root } = mount({ view: view({ form }), share: { settings: () => form ?? {}, update, copyLink: vi.fn() } });

    return { root, update };
  };
  const box = (root: HTMLElement, part: 'title' | 'description'): HTMLInputElement | HTMLTextAreaElement | null =>
    root.querySelector(`[data-blok-database-form-header-${part}]`);
  const type = (field: HTMLInputElement | HTMLTextAreaElement | null, value: string): void => {
    if (field === null) throw new Error('no field');
    Object.assign(field, { value });
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };

  it('the builder starts with the title and description boxes, above the access line', () => {
    const { root } = builder({ title: 'Signup', description: 'Tell us about you' });

    expect(box(root, 'title')?.value).toBe('Signup');
    // The saved text is in the markup too, so a snapshot of the page shows it.
    expect(box(root, 'title')?.getAttribute('value')).toBe('Signup');
    expect(box(root, 'title')?.placeholder).toBe('tools.database.formTitlePlaceholder');
    expect(box(root, 'description')?.value).toBe('Tell us about you');
    expect(box(root, 'description')?.placeholder).toBe('tools.database.formDescriptionPlaceholder');
    expect(root.firstElementChild?.hasAttribute('data-blok-database-form-header')).toBe(true);
    expect(root.firstElementChild?.nextElementSibling?.hasAttribute('data-blok-database-form-access')).toBe(true);
  });

  it('a change saves the title or description in the form settings; an empty one removes it', () => {
    const { root, update } = builder({ title: 'Signup' });

    type(box(root, 'title'), ' Event signup ');
    expect(update).toHaveBeenLastCalledWith({ title: 'Event signup' });
    type(box(root, 'description'), 'Bring a friend');
    expect(update).toHaveBeenLastCalledWith({ description: 'Bring a friend' });
    type(box(root, 'title'), '  ');
    expect(update).toHaveBeenLastCalledWith({ title: undefined });
  });

  it('a respondent reads the title as a heading and the description under it; none when unset', () => {
    const { root } = mount({ view: view({ form: { title: 'Signup', description: 'Tell us' } }) });

    expect(root.querySelector('h1[data-blok-database-form-header-title]')?.textContent).toBe('Signup');
    expect(root.querySelector('p[data-blok-database-form-header-description]')?.textContent).toBe('Tell us');
    document.body.innerHTML = '';
    expect(mount().root.querySelector('[data-blok-database-form-header]')).toBeNull();
  });
});
