import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DatabaseFormView } from '../../../../src/tools/database/database-form-view';
import type { DatabaseFormViewOptions } from '../../../../src/tools/database/database-form-view';
import { IconChevronUpDown } from '../../../../src/components/icons';
import type { DatabaseViewConfig, FormSettings, PropertyDefinition } from '../../../../src/tools/database/types';
import { PopoverDesktop } from '../../../../src/components/utils/popover/popover-desktop';

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
    question(root, 'pick')?.querySelector<HTMLInputElement>('input[value="o2"]')?.click();
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

  // notion-motion.md Round 32 §4: Required lives only in Question options; the card has no checkbox.
  it('in edit mode, a card has no Required checkbox', () => {
    const { root } = mount({ setQuestionSetting: vi.fn() });

    expect(root.querySelector('[data-blok-database-form-required]')).toBeNull();
    expect(root.querySelector('[data-blok-database-form-required-toggle]')).toBeNull();
  });

  // Round 31 §1, Round 32 §4: the builder's answer box reads "Respondent's answer".
  it('the builder\'s answer boxes show the respondent placeholder; a respondent\'s do not', () => {
    const builder = mount({ setQuestionSetting: vi.fn(), share: { settings: () => ({}), update: vi.fn(), copyLink: vi.fn() } }).root;

    expect(field<HTMLInputElement>(builder, 'title').placeholder).toBe('tools.database.formAnswerPlaceholder');
    expect(field<HTMLInputElement>(builder, 'email').placeholder).toBe('tools.database.formAnswerPlaceholder');
    document.body.innerHTML = '';
    const respondent = mount().root;

    expect(field<HTMLInputElement>(respondent, 'title').placeholder).toBe('');
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

    // notion-motion.md Round 32 §4: Notion's Select question defaults to List view (radio rows).
    it('a select question is a radio list by default', () => {
      const { root } = ask([{ id: 'pick', visible: true }]);

      expect(question(root, 'pick')?.querySelector('select')).toBeNull();
      expect(question(root, 'pick')?.querySelectorAll('input[type="radio"]')).toHaveLength(2);
    });

    it('a select question shown as a dropdown is a select', () => {
      const { root } = ask([{ id: 'pick', visible: true, showOptionsAs: 'dropdown' }]);

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

  // The chip shows on hover only (Round 32 §4); it stays while its menu is open, which the CSS reads from aria-expanded.
  it('marks the ••• chip expanded while its Question options are open', () => {
    const { root } = mount({ setQuestionSetting: vi.fn(), openLinkedProperty: vi.fn() });
    const chip = question(root, 'email')?.querySelector<HTMLButtonElement>('[data-blok-testid="database-form-question-menu"]');

    expect(chip?.getAttribute('aria-expanded')).toBe('false');
    chip?.click();
    expect(chip?.getAttribute('aria-expanded')).toBe('true');
    document.querySelector<HTMLElement>('[data-blok-testid="database-form-question-linked-property"]')?.click();
    expect(document.querySelector('[data-blok-testid="database-form-question-settings"]')).toBeNull();
    expect(chip?.getAttribute('aria-expanded')).toBe('false');
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

  const flyout = (): HTMLElement | null => document.querySelector('[data-blok-testid="database-form-question-move-menu"]');
  const flyoutRows = (): Array<string | null> =>
    [...(flyout()?.querySelectorAll('[data-blok-database-panel-row]') ?? [])].map((el) => el.getAttribute('data-blok-testid'));

  // notion-motion.md Round 32 §1 (r32-a-movequestion-*): a 280-wide flyout beside Question options, which stays open.
  // The first question lists Move down and Move to bottom of group; a middle one all four; the last mirrors the first.
  it('Move question opens a flyout with only the moves the question can make', () => {
    // Questions in order: email, title, size, agree, pick.
    open('email', { moveQuestion: vi.fn() });
    row('database-form-question-move')?.click();
    expect(flyout()?.style.width).toBe('280px');
    expect(panel()).not.toBeNull();
    expect(flyoutRows()).toEqual(['database-form-question-move-down', 'database-form-question-move-bottom']);

    document.body.innerHTML = '';
    open('size', { moveQuestion: vi.fn() });
    row('database-form-question-move')?.click();
    expect(flyoutRows()).toEqual([
      'database-form-question-move-up',
      'database-form-question-move-down',
      'database-form-question-move-top',
      'database-form-question-move-bottom',
    ]);

    document.body.innerHTML = '';
    open('pick', { moveQuestion: vi.fn() });
    row('database-form-question-move')?.click();
    expect(flyoutRows()).toEqual(['database-form-question-move-up', 'database-form-question-move-top']);
  });

  // notion-motion.md Round 33 §1 (r33-form-move-w1000.raw): with no room left of the panel, the flyout
  // opens on its right, its left edge on the row's right (panel right − 4), centred on the row.
  const openBesideCard = (viewport: number, card: DOMRect): HTMLElement | null => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(viewport);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(717);
    vi.spyOn(PopoverDesktop.prototype, 'size', 'get').mockReturnValue({ width: 290, height: 355 });
    const { root } = mount({ setQuestionSetting: vi.fn() });
    const wrapper = question(root, 'size');

    if (wrapper === null) throw new Error('no question');
    wrapper.getBoundingClientRect = () => card;
    wrapper.querySelector<HTMLButtonElement>('[data-blok-testid="database-form-question-menu"]')?.click();

    return panel()?.closest<HTMLElement>('[data-blok-popover]') ?? null;
  };

  // notion-motion.md Round 31 §1 and r33-form-move-mid.raw: at 1512 the panel sits 24 right of the card, top level with it.
  it('Question options opens 24 right of the card when the window has room there', () => {
    const box = openBesideCard(1512, new DOMRect(585, 225, 600, 140));

    expect(parseFloat(box?.style.left ?? '')).toBeCloseTo(1209);
    expect(parseFloat(box?.style.top ?? '')).toBeCloseTo(225);
  });

  // r33-form-move-w1000.raw: at 1000 the panel opens 24 left of the card (92–382 against a card at 406).
  it('Question options opens 24 left of the card when its right has no room', () => {
    const box = openBesideCard(1000, new DOMRect(406, 224.8, 458, 140));

    expect(parseFloat(box?.style.left ?? '')).toBeCloseTo(92);
    expect(parseFloat(box?.style.top ?? '')).toBeCloseTo(224.8);
  });

  const openSelectTypeBeside = (viewport: number, add: DOMRect): HTMLElement | null => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(viewport);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(717);
    vi.spyOn(PopoverDesktop.prototype, 'size', 'get').mockReturnValue({ width: 290, height: 502 });
    const { root } = mount({ setQuestionSetting: vi.fn(), addQuestion: vi.fn() });
    const button = root.querySelector<HTMLElement>('[data-blok-testid="database-form-add-question"]');
    const rect = HTMLElement.prototype.getBoundingClientRect;

    if (button === null) throw new Error('no Add question');
    // The round "+" is 32 wide: the panel goes beside the column-wide slot it opens.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-blok-database-form-slot') ? add : rect.call(this);
    });
    button.click();

    return document.querySelector('[data-blok-testid="database-form-select-type"]')?.closest<HTMLElement>('[data-blok-popover]') ?? null;
  };

  // notion-motion.md Round 31 §1: at 1512 Select type is a side panel at x 1209, 24 right of the 600 column at 585.
  it('Select type opens 24 right of the column when the window has room there', () => {
    const box = openSelectTypeBeside(1512, new DOMRect(585, 160, 600, 28));

    expect(parseFloat(box?.style.left ?? '')).toBeCloseTo(1209);
    expect(parseFloat(box?.style.top ?? '')).toBeCloseTo(160);
  });

  // notion-motion.md Round 44 §1 (r44-q1.raw): at 1000 it sits at x 92, 24 left of the 458 column at 406.
  it('Select type opens 24 left of the column when its right has no room', () => {
    const box = openSelectTypeBeside(1000, new DOMRect(406, 160, 458, 28));

    expect(parseFloat(box?.style.left ?? '')).toBeCloseTo(92);
  });

  it('Move question opens on the panel\'s right when its left has no room', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1000);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(717);
    vi.spyOn(PopoverDesktop.prototype, 'size', 'get').mockReturnValue({ width: 280, height: 123 });
    open('size', { moveQuestion: vi.fn() });
    const move = row('database-form-question-move');

    if (move === null) throw new Error('no Move question row');
    move.getBoundingClientRect = () => new DOMRect(96, 459.8, 282, 28);
    move.click();
    const box = flyout()?.closest<HTMLElement>('[data-blok-popover]');

    expect(parseFloat(box?.style.left ?? '')).toBeCloseTo(378);
    expect(parseFloat(box?.style.top ?? '')).toBeCloseTo(412.3);
  });

  it('each move puts the question where its row says and closes both menus', () => {
    const moveQuestion = vi.fn();
    const pick = (testId: string): void => {
      document.body.innerHTML = '';
      open('title', { moveQuestion });
      row('database-form-question-move')?.click();
      row(testId)?.click();
    };

    pick('database-form-question-move-up');
    expect(moveQuestion).toHaveBeenLastCalledWith('title', 'email');
    expect(panel()).toBeNull();
    expect(flyout()).toBeNull();
    pick('database-form-question-move-down');
    expect(moveQuestion).toHaveBeenLastCalledWith('title', 'agree');
    pick('database-form-question-move-top');
    expect(moveQuestion).toHaveBeenLastCalledWith('title', 'email');
    pick('database-form-question-move-bottom');
    expect(moveQuestion).toHaveBeenLastCalledWith('title', null);
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

  // notion-motion.md Round 52 §3: the new card's name takes focus, whole name selected; Question options stays open.
  it('a new question takes focus in its name with the whole name selected', () => {
    const addQuestion = vi.fn((): PropertyDefinition => notes);
    const { root } = mount({ setQuestionSetting: vi.fn(), addQuestion });

    root.querySelector<HTMLElement>('[data-blok-testid="database-form-add-question"]')?.click();
    document.querySelector<HTMLElement>('[data-blok-testid="database-form-new-text"]')?.click();
    const name = question(root, 'notes')?.querySelector<HTMLInputElement>('[data-blok-database-form-question-name]');

    expect(name).toHaveFocus();
    expect([name?.selectionStart, name?.selectionEnd]).toEqual([0, 'Notes'.length]);
    // Still open: its ⋯ goes back to false only when the panel closes.
    expect(question(root, 'notes')?.querySelector('[data-blok-testid="database-form-question-menu"]')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('the end row still adds a question last', () => {
    const addQuestion = vi.fn((): PropertyDefinition => notes);
    const { root } = mount({ setQuestionSetting: vi.fn(), addQuestion });

    root.querySelector<HTMLElement>('[data-blok-testid="database-form-add-question"]')?.click();
    document.querySelector<HTMLElement>('[data-blok-testid="database-form-new-text"]')?.click();

    expect(addQuestion).toHaveBeenCalledWith('text', undefined);
    expect(ids(root).at(-1)).toBe('notes');
  });

  // notion-motion.md Round 52 §3: a round "+" under the cards, named by its hint; Select type opens a slot above it.
  it('the end "+" is an icon button named Add question that opens a slot above it, gone on Escape', () => {
    const { root } = mount({ setQuestionSetting: vi.fn(), addQuestion: vi.fn() });
    const add = root.querySelector<HTMLButtonElement>('[data-blok-testid="database-form-add-question"]');

    expect(add?.getAttribute('aria-label')).toBe('tools.database.formAddQuestion');
    expect(add?.textContent?.trim()).toBe('');
    expect(add?.querySelector('svg')).not.toBeNull();
    add?.click();

    expect(root.querySelector('[data-blok-database-form-slot]')?.nextElementSibling).toBe(add);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(root.querySelector('[data-blok-database-form-slot]')).toBeNull();
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

  // notion-motion.md Round 31 §1, Round 32 §4: a "Form icon" and "Form cover" row above the title.
  it('the builder has a Form icon and Form cover row above the title', () => {
    const { root } = builder();
    const row = root.querySelector('[data-blok-database-form-header] > [data-blok-database-form-header-row]');

    expect(row).not.toBeNull();
    expect(row?.nextElementSibling?.hasAttribute('data-blok-database-form-header-title')).toBe(true);
    expect(row?.querySelector('[data-blok-page-add-icon] > span')?.textContent).toBe('tools.database.formIcon');
    expect(row?.querySelector('[data-blok-page-add-cover] > span')?.textContent).toBe('tools.database.formCover');
  });

  it('Form cover saves a gallery cover in the form settings and draws it above the header', () => {
    const settings: FormSettings = {};
    const update = vi.fn((patch: Partial<FormSettings>) => Object.assign(settings, patch));
    const { root } = mount({ view: view({ form: settings }), share: { settings: () => settings, update, copyLink: vi.fn() } });

    root.querySelector<HTMLButtonElement>('[data-blok-page-add-cover]')?.click();

    expect(update).toHaveBeenLastCalledWith({ cover: { type: 'gallery', id: expect.any(String) } });
    expect(root.querySelector('[data-blok-database-form-header] > [data-blok-page-cover]')).not.toBeNull();
    expect(root.querySelector<HTMLButtonElement>('[data-blok-page-add-cover]')?.hidden).toBe(true);
  });

  it('a saved icon shows in place of Form icon', () => {
    const { root } = builder({ icon: { type: 'emoji', value: '🎉' } });

    expect(root.querySelector('[data-blok-database-form-header-row] [data-blok-page-icon]')?.textContent).toBe('🎉');
    expect(root.querySelector('[data-blok-page-add-icon]')).toBeNull();
  });

  it('draws nothing for a malformed saved icon or cover', () => {
    const { root } = builder({ icon: 'x', cover: { type: 'gallery' } } as unknown as DatabaseViewConfig['form']);

    expect(root.querySelector('[data-blok-page-icon]')).toBeNull();
    expect(root.querySelector('[data-blok-page-add-icon]')).not.toBeNull();
    expect(root.querySelector('[data-blok-page-cover]')).toBeNull();
  });

  it('a respondent sees the saved icon and cover, with no buttons', () => {
    const { root } = mount({ view: view({ form: { icon: { type: 'emoji', value: '🎉' }, cover: { type: 'gallery', id: 'blue' } } }) });

    expect(root.querySelector('[data-blok-page-icon]')?.textContent).toBe('🎉');
    expect(root.querySelector<HTMLButtonElement>('[data-blok-page-icon]')?.disabled).toBe(true);
    expect(root.querySelector('[data-blok-page-cover]')).not.toBeNull();
    expect(root.querySelector('[data-blok-page-add-icon], [data-blok-page-add-cover]:not([hidden])')).toBeNull();
  });

  it('a respondent reads the title as a heading and the description under it; none when unset', () => {
    const { root } = mount({ view: view({ form: { title: 'Signup', description: 'Tell us' } }) });

    expect(root.querySelector('h1[data-blok-database-form-header-title]')?.textContent).toBe('Signup');
    expect(root.querySelector('p[data-blok-database-form-header-description]')?.textContent).toBe('Tell us');
    document.body.innerHTML = '';
    expect(mount().root.querySelector('[data-blok-database-form-header]')).toBeNull();
  });
});

// notion-motion.md Round 52 §3: drag a card by its blank area; faint drop lines show in every gap
// that would move it, none next to the card itself.
describe('DatabaseFormView drag to reorder questions', () => {
  const CARD_TOP = 100;
  const CARD_HEIGHT = 140;
  const PITCH = 164;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.dispatchEvent(new PointerEvent('pointercancel'));
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const ids = (root: HTMLElement): string[] =>
    [...root.querySelectorAll('[data-blok-database-form-question]')].map((el) => el.getAttribute('data-blok-database-form-question') ?? '');
  const setup = (): { root: HTMLElement; moveQuestion: ReturnType<typeof vi.fn> } => {
    const moveQuestion = vi.fn();
    const { root } = mount({ setQuestionSetting: vi.fn(), moveQuestion });

    ids(root).forEach((id, index) => {
      const card = question(root, id);

      if (card !== null) card.getBoundingClientRect = () => new DOMRect(585, CARD_TOP + index * PITCH, 600, CARD_HEIGHT);
    });

    return { root, moveQuestion };
  };
  const press = (target: Element, y: number): void => {
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 700, clientY: y }));
  };
  const moveTo = (y: number): void => {
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 700, clientY: y }));
  };
  const release = (y: number): void => {
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 700, clientY: y }));
  };
  const zones = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-blok-database-form-drop-zone]')];

  it('drops a card in the gap under the pointer and moves the question there', () => {
    const { root, moveQuestion } = setup();
    const agree = question(root, 'agree');

    expect(ids(root)).toEqual(['email', 'title', 'size', 'agree', 'pick']);
    if (agree === null) throw new Error('no card');
    press(agree, 600);
    moveTo(250);
    release(250);

    expect(moveQuestion).toHaveBeenCalledWith('agree', 'title');
  });

  it('a drop past the last card makes the question last', () => {
    const { root, moveQuestion } = setup();
    const title = question(root, 'title');

    if (title === null) throw new Error('no card');
    press(title, 300);
    moveTo(900);
    release(900);

    expect(moveQuestion).toHaveBeenCalledWith('title', null);
  });

  it('shows a faint line centred in every gap, none beside the dragged card, and marks the target', () => {
    const { root } = setup();
    const agree = question(root, 'agree');

    if (agree === null) throw new Error('no card');
    press(agree, 600);
    moveTo(250);
    const shown = zones().filter((zone) => !zone.hasAttribute('data-adjacent'));

    expect(zones()).toHaveLength(6);
    expect(zones().filter((zone) => zone.hasAttribute('data-adjacent'))).toHaveLength(2);
    expect(shown).toHaveLength(4);
    // The gap between email (bottom 240) and title (top 264) centres at 252.
    const target = zones().find((zone) => zone.hasAttribute('data-target'));

    expect(target?.style.top).toBe('250px');
    expect(target?.style.left).toBe('585px');
    expect(target?.style.width).toBe('600px');
    expect(target?.style.height).toBe('4px');
    expect(zones().filter((zone) => zone.hasAttribute('data-target'))).toHaveLength(1);
  });

  // The lines mount on <body>, outside the editor's tokens: they carry the form's resolved ones.
  it('the lines take the form\'s resolved line colour and pill radius', () => {
    const { root } = setup();
    const agree = question(root, 'agree');

    if (agree === null) throw new Error('no card');
    root.style.setProperty('--blok-database-drop-line', 'rgb(1, 2, 3)');
    root.style.setProperty('--blok-radius-pill', '9999px');
    press(agree, 600);
    moveTo(250);

    expect(zones()[0]?.style.backgroundColor).toBe('rgb(1, 2, 3)');
    expect(zones()[0]?.style.borderRadius).toBe('9999px');
  });

  it('a drop beside the card itself moves nothing', () => {
    const { root, moveQuestion } = setup();
    const agree = question(root, 'agree');

    if (agree === null) throw new Error('no card');
    press(agree, 600);
    moveTo(560);
    release(560);

    expect(moveQuestion).not.toHaveBeenCalled();
    expect(zones()).toHaveLength(0);
  });

  // notion-motion.md Round 53 (b): a copy of the card at 0.18 follows the pointer with the grab offset.
  it('moves a faint copy of the card with the pointer and drops it on release', () => {
    const { root } = setup();
    const agree = question(root, 'agree');
    const name = agree?.querySelector<HTMLInputElement>('[data-blok-database-form-question-name]');

    if (agree === null || name === null || name === undefined) throw new Error('no card');
    name.value = 'Renamed';
    press(agree, 600);
    moveTo(250);
    const ghost = document.querySelector<HTMLElement>('[data-blok-database-ghost]');
    const copy = ghost?.querySelector<HTMLElement>('[data-blok-database-form-question]');

    expect(ghost?.style.position).toBe('fixed');
    expect(ghost?.style.opacity).toBe('0.18');
    expect(ghost?.style.pointerEvents).toBe('none');
    expect(ghost?.style.left).toBe('585px');
    // Pressed 8 below the card's top (592).
    expect(ghost?.style.top).toBe('242px');
    expect(ghost?.style.width).toBe('600px');
    expect(ghost?.style.height).toBe(`${CARD_HEIGHT}px`);
    expect(ghost?.getAttribute('aria-hidden')).toBe('true');
    expect(root.contains(ghost ?? null)).toBe(false);
    expect(copy?.hasAttribute('data-blok-database-drag-source')).toBe(false);
    expect(copy?.querySelector<HTMLInputElement>('[data-blok-database-form-question-name]')?.value).toBe('Renamed');

    moveTo(300);
    expect(ghost?.style.top).toBe('292px');
    release(300);
    expect(document.querySelector('[data-blok-database-ghost]')).toBeNull();
  });

  it('Escape removes the copy', () => {
    const { root } = setup();
    const agree = question(root, 'agree');

    if (agree === null) throw new Error('no card');
    press(agree, 600);
    moveTo(250);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(document.querySelector('[data-blok-database-ghost]')).toBeNull();
  });

  it('Escape cancels the drag: no move, no lines', () => {
    const { root, moveQuestion } = setup();
    const agree = question(root, 'agree');

    if (agree === null) throw new Error('no card');
    press(agree, 600);
    moveTo(250);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    release(250);

    expect(moveQuestion).not.toHaveBeenCalled();
    expect(zones()).toHaveLength(0);
  });

  it('a press in the name or the answer box does not drag', () => {
    const { root, moveQuestion } = setup();
    const name = question(root, 'agree')?.querySelector('[data-blok-database-form-question-name]');

    if (name === null || name === undefined) throw new Error('no name');
    press(name, 600);
    moveTo(250);
    release(250);

    expect(moveQuestion).not.toHaveBeenCalled();
    expect(zones()).toHaveLength(0);
  });

  it('a respondent cannot drag', () => {
    const moveQuestion = vi.fn();
    const { root } = mount({ moveQuestion });
    const card = question(root, 'title');

    if (card === null) throw new Error('no card');
    press(card, 300);
    moveTo(900);
    release(900);

    expect(moveQuestion).not.toHaveBeenCalled();
  });
});

// notion-motion.md Round 75 §2 "Form answers, non-text": the builder edits options in place,
// draws a date as a picker field and a checkbox as a row. A respondent keeps the answer controls.
describe('DatabaseFormView builder answers', () => {
  const tags: PropertyDefinition = {
    id: 'tags', name: 'Tags', type: 'multiSelect', position: 'a7', config: {
      options: [{ id: 't1', label: 'Red', position: 'a0' }, { id: 't2', label: 'Blue', position: 'a1' }],
    },
  };
  const due: PropertyDefinition = { id: 'due', name: 'Due', type: 'date', position: 'a8' };
  const properties = ['pick', 'tags', 'due', 'agree'].map((id) => ({ id, visible: true }));
  const build = (changeOptions = vi.fn()): { root: HTMLElement; changeOptions: ReturnType<typeof vi.fn> } => ({
    root: mount({ schema: [...schema, tags, due], view: view({ properties }), setQuestionSetting: vi.fn(), changeOptions }).root,
    changeOptions,
  });
  const names = (root: HTMLElement, id: string): HTMLInputElement[] =>
    [...(question(root, id)?.querySelectorAll<HTMLInputElement>('[data-blok-database-form-option-name]') ?? [])];
  const addOption = (root: HTMLElement, id: string): HTMLButtonElement | null | undefined =>
    question(root, id)?.querySelector<HTMLButtonElement>('[data-blok-database-form-add-option]');
  const type = (input: HTMLInputElement, value: string): void => {
    Object.assign(input, { value });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('a select question lists each option as an editable row with a radio, then Add option', () => {
    const { root } = build();
    const rows = [...(question(root, 'pick')?.querySelectorAll('[data-blok-database-form-option]') ?? [])];

    expect(names(root, 'pick').map((input) => input.value)).toEqual(['One', 'Two']);
    expect(rows.map((row) => row.querySelector('input[type="radio"]') !== null)).toEqual([true, true]);
    expect(addOption(root, 'pick')?.textContent?.trim()).toBe('tools.database.formAddOption');
  });

  it('a multiple choice question lists each option with a checkbox, then Add option', () => {
    const { root } = build();
    const rows = [...(question(root, 'tags')?.querySelectorAll('[data-blok-database-form-option]') ?? [])];

    expect(names(root, 'tags').map((input) => input.value)).toEqual(['Red', 'Blue']);
    expect(rows.map((row) => row.querySelector('input[type="checkbox"]') !== null)).toEqual([true, true]);
    expect(addOption(root, 'tags')).not.toBeNull();
  });

  it('renaming an option in the builder changes the property options, keeping the others', () => {
    const { root, changeOptions } = build();

    type(names(root, 'pick')[0], ' Uno ');

    expect(changeOptions).toHaveBeenCalledTimes(1);
    expect(changeOptions).toHaveBeenCalledWith('pick', [
      { id: 'o1', label: 'Uno', position: 'a0' },
      { id: 'o2', label: 'Two', position: 'a1' },
    ]);
  });

  it('an empty or taken option name is refused and the old name comes back', () => {
    const { root, changeOptions } = build();
    const [first] = names(root, 'pick');

    type(first, '  ');
    expect(first.value).toBe('One');
    type(first, 'two');
    expect(first.value).toBe('One');
    expect(changeOptions).not.toHaveBeenCalled();
  });

  it('Add option opens an empty focused row whose name adds an option after the last', () => {
    const { root, changeOptions } = build();

    addOption(root, 'tags')?.click();
    const fresh = names(root, 'tags').at(-1);

    expect(names(root, 'tags')).toHaveLength(3);
    expect(fresh?.value).toBe('');
    expect(fresh).toHaveFocus();
    if (fresh !== undefined) type(fresh, 'Green');

    expect(changeOptions).toHaveBeenCalledTimes(1);
    const [propertyId, next] = changeOptions.mock.calls[0] as [string, Array<{ id: string; label: string; position: string }>];

    expect(propertyId).toBe('tags');
    expect(next.map((option) => option.label)).toEqual(['Red', 'Blue', 'Green']);
    expect(next[2].id).not.toBe('');
    expect(next[2].position > 'a1').toBe(true);
  });

  it('a new option renamed before the redraw is renamed, not added twice', () => {
    const { root, changeOptions } = build();

    addOption(root, 'tags')?.click();
    const fresh = names(root, 'tags').at(-1);

    if (fresh !== undefined) {
      type(fresh, 'Green');
      type(fresh, 'Teal');
    }

    expect(changeOptions).toHaveBeenCalledTimes(2);
    const last = changeOptions.mock.calls[1][1] as Array<{ label: string }>;

    expect(last.map((option) => option.label)).toEqual(['Red', 'Blue', 'Teal']);
  });

  it('a new option row left empty adds nothing', () => {
    const { root, changeOptions } = build();

    addOption(root, 'tags')?.click();
    const fresh = names(root, 'tags').at(-1);

    expect(names(root, 'tags')).toHaveLength(3);
    if (fresh !== undefined) type(fresh, '');

    expect(changeOptions).not.toHaveBeenCalled();
  });

  it('a date question is a picker field with a calendar glyph that opens the date picker', () => {
    const { root } = build();
    const answer = question(root, 'due')?.querySelector<HTMLButtonElement>('button[data-blok-database-form-provider-answer]');

    expect(question(root, 'due')?.querySelector('input[type="date"]')).toBeNull();
    expect(answer?.querySelector('[data-blok-database-form-date-glyph] svg')).not.toBeNull();
    answer?.click();

    expect(document.querySelector('[data-blok-database-date-editor]')).not.toBeNull();
  });

  it('a checkbox question is a row holding the checkbox', () => {
    const { root } = build();
    const row = question(root, 'agree')?.querySelector('[data-blok-database-form-checkbox-row]');

    expect(row?.querySelector('input[type="checkbox"]')).toBeInstanceOf(HTMLInputElement);
  });

  it('a respondent keeps the plain choices, the native date and no option editing', () => {
    const root = mount({ schema: [...schema, tags, due], view: view({ properties }) }).root;

    expect(root.querySelector('[data-blok-database-form-option-name]')).toBeNull();
    expect(root.querySelector('[data-blok-database-form-add-option]')).toBeNull();
    expect(question(root, 'due')?.querySelector('input[type="date"]')).not.toBeNull();
    expect(question(root, 'pick')?.querySelectorAll('input[type="radio"]')).toHaveLength(2);
    expect(root.querySelector('[data-blok-database-form-checkbox-label]')).toBeNull();
  });

  const confirmAction = (name: 'confirm' | 'cancel'): HTMLButtonElement | null =>
    document.querySelector<HTMLButtonElement>(`[data-blok-database-confirm-action="${name}"]`);

  // notion-motion.md Round 76 §3 "Option row hover", Round 77 §4 "Delete option": Notion asks first.
  it('Delete option asks first, then removes the option from the property options and its row', async () => {
    const { root, changeOptions } = build();
    const remove = question(root, 'pick')?.querySelector<HTMLButtonElement>('[data-blok-database-form-option-delete]');

    expect(remove?.getAttribute('aria-label')).toBe('tools.database.formDeleteOption');
    remove?.click();

    expect(changeOptions).not.toHaveBeenCalled();
    expect(names(root, 'pick')).toHaveLength(2);
    expect(document.querySelector('[data-blok-database-confirm-title]')?.textContent).toBe('tools.database.optionDeleteConfirm');
    expect(confirmAction('confirm')?.textContent).toBe('tools.database.optionDelete');
    expect(confirmAction('confirm')?.hasAttribute('data-destructive')).toBe(true);
    expect(confirmAction('confirm')).toHaveFocus();
    expect(confirmAction('cancel')?.textContent).toBe('tools.database.optionDeleteCancel');
    confirmAction('confirm')?.click();

    await vi.waitFor(() => expect(changeOptions).toHaveBeenCalledWith('pick', [{ id: 'o2', label: 'Two', position: 'a1' }]));
    expect(names(root, 'pick').map((input) => input.value)).toEqual(['Two']);
  });

  it('Cancel in the Delete option prompt keeps the option', async () => {
    const { root, changeOptions } = build();

    question(root, 'pick')?.querySelector<HTMLButtonElement>('[data-blok-database-form-option-delete]')?.click();
    confirmAction('cancel')?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(changeOptions).not.toHaveBeenCalled();
    expect(names(root, 'pick').map((input) => input.value)).toEqual(['One', 'Two']);
  });

  it('Delete option on an unnamed new row removes the row and sends nothing', () => {
    const { root, changeOptions } = build();

    addOption(root, 'tags')?.click();
    const rows = question(root, 'tags')?.querySelectorAll<HTMLElement>('[data-blok-database-form-option]');

    rows?.[rows.length - 1]?.querySelector<HTMLButtonElement>('[data-blok-database-form-option-delete]')?.click();

    expect(names(root, 'tags')).toHaveLength(2);
    expect(changeOptions).not.toHaveBeenCalled();
  });

  it('dragging an option by its handle moves it through the property options', () => {
    const { root, changeOptions } = build();
    const rows = [...(question(root, 'pick')?.querySelectorAll<HTMLElement>('[data-blok-database-form-option]') ?? [])];

    rows.forEach((row, index) => vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, index * 32, 592, 32)));
    const handle = rows[1]?.querySelector('[data-blok-database-form-option-handle]');

    expect(handle?.getAttribute('aria-label')).toBe('blockSettings.dragToMove');
    handle?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: 48, button: 0 }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: 5 }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientY: 5 }));

    expect(changeOptions).toHaveBeenCalledTimes(1);
    const [propertyId, next] = changeOptions.mock.calls[0] as [string, Array<{ id: string; position: string }>];

    expect(propertyId).toBe('pick');
    expect((next.find((option) => option.id === 'o2')?.position ?? 'z') < 'a0').toBe(true);
  });

  // notion-motion.md Round 76 §3 "Checkbox label": a textarea after the box, saved with the question, not the property.
  it('a checkbox question has a label field saved with the question', () => {
    const setQuestionSetting = vi.fn();
    const withLabel = properties.map((entry) => (entry.id === 'agree' ? { ...entry, checkboxLabel: 'I agree' } : entry));
    const { root } = mount({ schema: [...schema, tags, due], view: view({ properties: withLabel }), setQuestionSetting, changeOptions: vi.fn() });
    const label = question(root, 'agree')?.querySelector<HTMLTextAreaElement>('[data-blok-database-form-checkbox-row] textarea[data-blok-database-form-checkbox-label]');

    expect(label?.placeholder).toBe('tools.database.formCheckboxLabelPlaceholder');
    expect(label?.value).toBe('I agree');
    if (label === null || label === undefined) throw new Error('no label');
    label.value = ' Yes ';
    label.dispatchEvent(new Event('change', { bubbles: true }));
    expect(setQuestionSetting).toHaveBeenLastCalledWith('agree', { checkboxLabel: 'Yes' });
    label.value = '';
    label.dispatchEvent(new Event('change', { bubbles: true }));
    expect(setQuestionSetting).toHaveBeenLastCalledWith('agree', { checkboxLabel: undefined });
  });

  it('keeps the builder from redrawing while the checkbox label is being typed', () => {
    const view_ = new DatabaseFormView({
      i18n: { t: (key: string) => key }, view: view({ properties }), schema: [...schema, tags, due], readOnly: false,
      onSubmit: vi.fn(), setQuestionSetting: vi.fn(), changeOptions: vi.fn(),
    });
    const root = view_.createView();

    document.body.appendChild(root);
    root.querySelector<HTMLTextAreaElement>('[data-blok-database-form-checkbox-label]')?.focus();

    expect(view_.interacting).toBe(true);
  });

  // notion-motion.md Round 76 §3 "Dropdown mode": a hint field, then editable rows with no mark, then Add option.
  it('a select question shown as a dropdown keeps editable option rows under a hint field', () => {
    const dropdown = properties.map((entry) => (entry.id === 'pick' ? { ...entry, showOptionsAs: 'dropdown' as const } : entry));
    const { root } = mount({ schema: [...schema, tags, due], view: view({ properties: dropdown }), setQuestionSetting: vi.fn(), changeOptions: vi.fn() });
    const set = question(root, 'pick')?.querySelector('[data-blok-database-form-options]');
    const hint = set?.firstElementChild;

    expect(question(root, 'pick')?.querySelector('select')).toBeNull();
    expect(hint?.hasAttribute('data-blok-database-form-dropdown-hint')).toBe(true);
    expect(hint?.firstChild?.textContent).toBe('tools.database.formDropdownHint');
    expect(hint?.querySelector('[data-blok-database-form-dropdown-chevron] svg')).not.toBeNull();
    expect(names(root, 'pick').map((input) => input.value)).toEqual(['One', 'Two']);
    expect(set?.querySelector('input:is([type="radio"], [type="checkbox"])')).toBeNull();
    expect(set?.querySelector('[data-blok-database-form-add-option]')).not.toBeNull();
  });

  // notion-motion.md Round 77 §4 "Builder checkbox": disabled, a click changes nothing.
  it('the builder checkbox cannot be checked', () => {
    const { root } = build();
    const box = question(root, 'agree')?.querySelector<HTMLInputElement>('[data-blok-database-form-checkbox-row] input[type="checkbox"]');

    expect(box?.disabled).toBe(true);
    box?.click();
    expect(box?.checked).toBe(false);
  });

  // notion-motion.md Round 77 §4 "Enter in the checkbox label": the value and the focus stay.
  it('Enter in the checkbox label adds no line and keeps the focus', () => {
    const { root } = build();
    const label = question(root, 'agree')?.querySelector<HTMLTextAreaElement>('[data-blok-database-form-checkbox-label]');

    if (label === null || label === undefined) throw new Error('no label');
    label.focus();
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });

    label.dispatchEvent(enter);

    expect(enter.defaultPrevented).toBe(true);
    expect(label).toHaveFocus();
  });

  // notion-motion.md Round 78 §3 "End in the builder's checkbox label": value, caret and page scroll stay.
  // macOS End in a one-line textarea scrolls the page to its end instead.
  describe('End in the checkbox label', () => {
    const pressEnd = (userAgent: string): { label: HTMLTextAreaElement; end: KeyboardEvent } => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
      const { root } = build();
      const label = question(root, 'agree')?.querySelector<HTMLTextAreaElement>('[data-blok-database-form-checkbox-label]');

      if (label === null || label === undefined) throw new Error('no label');
      label.value = 'r78 lbl';
      label.focus();
      const end = new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true });

      label.dispatchEvent(end);

      return { label, end };
    };

    it('on macOS does not scroll the page', () => {
      const { label, end } = pressEnd('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');

      expect(end.defaultPrevented).toBe(true);
      expect(label).toHaveFocus();
      expect(label.value).toBe('r78 lbl');
    });

    it('off macOS is left to the browser, which moves the caret', () => {
      const { end } = pressEnd('Mozilla/5.0 (X11; Linux x86_64)');

      expect(end.defaultPrevented).toBe(false);
    });
  });

  // notion-motion.md Round 77 §4 "Respondents": the label shows as text beside the box.
  it('a respondent sees the checkbox label beside the box, naming it', () => {
    const withLabel = properties.map((entry) => (entry.id === 'agree' ? { ...entry, checkboxLabel: 'I agree' } : entry));
    const root = mount({ schema: [...schema, tags, due], view: view({ properties: withLabel }) }).root;
    const box = question(root, 'agree')?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    const text = question(root, 'agree')?.querySelector('[data-blok-database-form-checkbox-text]');

    expect(text?.textContent).toBe('I agree');
    expect(text?.previousElementSibling).toBe(box);
    // The label wraps its box: the builder behind a Preview reuses the box's id.
    expect(text?.parentElement).toBeInstanceOf(HTMLLabelElement);
    expect(text?.parentElement?.hasAttribute('data-blok-database-form-checkbox-answer')).toBe(true);
    expect(box?.disabled).toBe(false);
    text?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(box?.checked).toBe(true);
  });

  it('a respondent sees no checkbox label text when the question has none', () => {
    const root = mount({ schema: [...schema, tags, due], view: view({ properties }) }).root;

    expect(question(root, 'agree')?.querySelector('[data-blok-database-form-checkbox-text]')).toBeNull();
  });

  // notion-motion.md Round 77 §4 "Multi-select, dropdown": editable rows with no mark under the hint, then Add option.
  it('a multiple choice question shown as a dropdown keeps editable option rows under a hint field', () => {
    const dropdown = properties.map((entry) => (entry.id === 'tags' ? { ...entry, showOptionsAs: 'dropdown' as const } : entry));
    const { root } = mount({ schema: [...schema, tags, due], view: view({ properties: dropdown }), setQuestionSetting: vi.fn(), changeOptions: vi.fn() });
    const set = question(root, 'tags')?.querySelector('[data-blok-database-form-options]');

    expect(question(root, 'tags')?.querySelector('[data-blok-database-form-provider-answer]')).toBeNull();
    expect(set?.firstElementChild?.hasAttribute('data-blok-database-form-dropdown-hint')).toBe(true);
    expect(names(root, 'tags').map((input) => input.value)).toEqual(['Red', 'Blue']);
    expect(set?.querySelector('input:is([type="radio"], [type="checkbox"])')).toBeNull();
    expect(set?.querySelector('[data-blok-database-form-add-option]')).not.toBeNull();
  });

  // notion-motion.md Round 76 §3 "Date answer": the builder's empty date reads "Respondent's answer".
  it('an empty date question reads the respondent\'s answer placeholder', () => {
    const { root } = build();
    const answer = question(root, 'due')?.querySelector('button[data-blok-database-form-date]');

    expect(answer?.firstChild?.textContent).toBe('tools.database.formAnswerPlaceholder');
  });
});
