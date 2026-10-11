import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DatabaseFormView } from '../../../../src/tools/database/database-form-view';
import type { DatabaseFormViewOptions } from '../../../../src/tools/database/database-form-view';
import type { DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

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
  const el = question(root, id)?.querySelector<T>('input, textarea, select');

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

  it('in edit mode, the Required toggle writes the view property setting', () => {
    const setRequired = vi.fn();
    const { root } = mount({ setRequired });

    root.querySelector<HTMLInputElement>('[data-blok-database-form-required="title"]')?.click();

    expect(setRequired).toHaveBeenCalledWith('title', true);
  });

  it('read-only shows no Required toggles', () => {
    const { root } = mount({ readOnly: true, setRequired: vi.fn() });

    expect(root.querySelector('[data-blok-database-form-required]')).toBeNull();
  });
});
