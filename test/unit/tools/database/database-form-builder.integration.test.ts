import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { DatabaseConfig, DatabaseData, PropertyDefinition } from '../../../../src/tools/database/types';
import type { Blok as PublicBlok, OutputBlockData, OutputData } from '../../../../types';

let editor: PublicBlok | undefined;
let holder: HTMLDivElement | undefined;
let database: DatabaseTool | undefined;

const q = <T extends Element = HTMLElement>(selector: string): T | null =>
  document.querySelector<T>(selector);

const requireElement = <T extends Element = HTMLElement>(selector: string): T => {
  const element = q<T>(selector);

  if (element === null) throw new Error(`Missing ${selector}`);

  return element;
};

const byTestId = (id: string): string => `[data-blok-testid="${id}"]`;
const question = (id: string): string => `[data-blok-database-form-question="${id}"]`;
const dismiss = (): void => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
};

const save = async (): Promise<OutputData> => {
  if (editor === undefined) throw new Error('Missing editor');

  return editor.save();
};

const blocksFor = (properties: PropertyDefinition[]): OutputBlockData[] => [{
  id: 'db', type: 'database', content: ['first', 'second'],
  data: {
    schema: [{ id: 'title', name: 'Name', type: 'title', position: 'a0' }, ...properties],
    views: [{
      id: 'form', name: 'Form', type: 'form', position: 'a0', sorts: [], filters: [],
      visibleProperties: properties.map((property) => property.id),
      properties: [{ id: 'title', visible: true }, ...properties.map((property) => ({ id: property.id, visible: true }))],
    }],
    activeViewId: 'form',
  } satisfies DatabaseData,
}, ...['first', 'second'].map((id, index): OutputBlockData => ({
  id, type: 'database-row', parent: 'db',
  data: { position: `a${index}`, properties: { title: id, notes: `Existing ${id}` } },
}))];

const mount = async (blocks: OutputBlockData[], readOnly = false, forms?: DatabaseConfig['forms']): Promise<void> => {
  editor?.destroy();
  holder?.replaceChildren();
  database = undefined;
  const config: DatabaseConfig = {
    people: { list: async () => [{ id: 'ada', name: 'Ada' }, { id: 'grace', name: 'Grace' }] },
    ...(forms === undefined ? {} : { forms }),
  };

  class ConfiguredDatabase extends DatabaseTool {
    constructor(options: ConstructorParameters<typeof DatabaseTool>[0]) {
      super({ ...options, config });
      database = this;
    }
  }

  editor = new Blok({
    holder, readOnly, dataModel: 'hierarchical',
    tools: { database: ConfiguredDatabase, 'database-row': DatabaseRowTool },
    data: { blocks },
  }) as unknown as PublicBlok;
  await editor.isReady;
  await vi.waitFor(() => expect(q('[data-blok-database-form]')).not.toBeNull());
};

const openQuestionMenu = (id: string): void => {
  const menu = q(`${question(id)} ${byTestId('database-form-question-menu')}`);

  expect(menu).not.toBeNull();
  if (menu === null) throw new Error('Missing question menu');
  menu.click();
};

const edit = (id: string, value: string): void => {
  const input = requireElement<HTMLInputElement>(byTestId(id));

  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const submit = (): void => {
  requireElement<HTMLInputElement>('[id="blok-form-form-title"]').value = 'Response';
  requireElement<HTMLButtonElement>('[data-blok-database-form-submit]').click();
};

const setSwitch = (id: string, checked: boolean): void => {
  const control = requireElement<HTMLButtonElement>(byTestId(id));

  if ((control.getAttribute('aria-checked') === 'true') !== checked) control.click();
  expect(q(byTestId(id))?.getAttribute('aria-checked')).toBe(String(checked));
};

const notes: PropertyDefinition = { id: 'notes', name: 'Notes', type: 'text', position: 'a1' };
const tags: PropertyDefinition = { id: 'tags', name: 'Tags', type: 'multiSelect', position: 'a1', config: {
  options: [{ id: 'one', label: 'One', position: 'a0' }, { id: 'two', label: 'Two', position: 'a1' }],
} };
const formSetting = (output: OutputData, id: string): unknown =>
  (output.blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined)?.views[0]?.properties?.find((entry) => entry.id === id);

describe('local form question builder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    dismiss();
    editor?.destroy();
    editor = undefined;
    database = undefined;
    holder?.remove();
    holder = undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('syncs a question rename by default, but a detached question label survives property renames and reloads', async () => {
    await mount(blocksFor([notes]));
    openQuestionMenu('notes');
    edit('database-form-question-name', 'Project details');
    dismiss();
    const synced = await save();

    expect(synced.blocks.find((block) => block.id === 'db')?.data.schema).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'notes', name: 'Project details' }),
    ]));
    await mount(synced.blocks);
    openQuestionMenu('notes');
    setSwitch('database-form-question-sync-name', false);
    edit('database-form-question-name', 'What should we know?');
    dismiss();
    const detached = await save();

    expect(detached.blocks.find((block) => block.id === 'db')?.data.schema).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'notes', name: 'Project details' }),
    ]));
    await mount(detached.blocks);
    if (database === undefined) throw new Error('Missing database');
    database.renameProperty('notes', 'Internal notes');
    await vi.waitFor(() => expect(q(`${question('notes')} [data-blok-database-form-label]`)?.textContent).toBe('What should we know?'));
    const renamed = await save();

    await mount(renamed.blocks, true);
    expect(q(`${question('notes')} [data-blok-database-form-label]`)?.textContent).toBe('What should we know?');
    expect(q(byTestId('database-form-question-menu'))).toBeNull();
  });

  // research/14 §3: a taken name is refused with the property menu's error; the real name stays.
  it('shows the taken-name error for another property\'s name and keeps the property name', async () => {
    await mount(blocksFor([notes, tags]));
    openQuestionMenu('notes');
    edit('database-form-question-name', 'Tags');
    const input = requireElement<HTMLInputElement>(byTestId('database-form-question-name'));
    const error = requireElement('[data-blok-database-form-question-name-error]');

    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe('A property named Tags already exists in this database.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.value).toBe('Tags');
    setSwitch('database-form-question-sync-name', false);
    dismiss();
    const saved = await save();

    expect(saved.blocks.find((block) => block.id === 'db')?.data.schema).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'notes', name: 'Notes' }),
    ]));
    expect(formSetting(saved, 'notes')).toHaveProperty('questionName', 'Notes');
  });

  // Typing "Status" over "Owner" one key at a time must not leave the property named "Statu".
  it('a taken name typed key by key keeps the old name; a free one is saved whole', async () => {
    const owner: PropertyDefinition = { id: 'owner', name: 'Owner', type: 'text', position: 'a1' };
    const status: PropertyDefinition = { id: 'status', name: 'Status', type: 'text', position: 'a2' };
    const typeKeys = (word: string): void => {
      for (let end = 1; end <= word.length; end += 1) edit('database-form-question-name', word.slice(0, end));
    };
    const nameOf = (output: OutputData): string | undefined =>
      (output.blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined)?.schema.find((property) => property.id === 'owner')?.name;

    await mount(blocksFor([owner, status]));
    openQuestionMenu('owner');
    typeKeys('Status');
    expect(requireElement('[data-blok-database-form-question-name-error]').hidden).toBe(false);
    dismiss();
    expect(nameOf(await save())).toBe('Owner');

    openQuestionMenu('owner');
    typeKeys('Statusx');
    dismiss();
    expect(nameOf(await save())).toBe('Statusx');
  });

  it('removes the detached question label when name sync is turned back on', async () => {
    await mount(blocksFor([notes]));
    openQuestionMenu('notes');
    setSwitch('database-form-question-sync-name', false);
    edit('database-form-question-name', 'Detached question');
    dismiss();
    const detached = await save();
    const detachedDefinition = detached.blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;
    const detachedSetting = detachedDefinition?.views.find((view) => view.id === 'form')?.properties?.find((entry) => entry.id === 'notes');

    await mount(detached.blocks);
    openQuestionMenu('notes');
    setSwitch('database-form-question-sync-name', true);
    dismiss();
    const saved = await save();
    const definition = saved.blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;
    const setting = definition?.views.find((view) => view.id === 'form')?.properties?.find((entry) => entry.id === 'notes');

    expect(setting).not.toHaveProperty('questionName');
    expect(setting).toBeDefined();
    expect(detachedSetting).toHaveProperty('questionName', 'Detached question');
    await mount(saved.blocks, true);
    expect(q(`${question('notes')} [data-blok-database-form-label]`)?.textContent).toBe('Notes');
    expect(definition?.schema.find((property) => property.id === 'notes')?.name).toBe('Notes');
  });

  it('closes a question menu on a public read-only transition and rejects its stale input', async () => {
    await mount(blocksFor([notes]));
    openQuestionMenu('notes');
    const name = requireElement<HTMLInputElement>(byTestId('database-form-question-name'));

    if (editor === undefined) throw new Error('Missing editor');
    await editor.readOnly.set(true);

    expect(q(byTestId('database-form-question-settings'))).toBeNull();
    expect(q(byTestId('database-form-question-menu'))).toBeNull();
    name.value = 'Stale rename';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await editor.readOnly.set(false);
    const saved = await save();
    const definition = saved.blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;

    expect(definition?.schema.find((property) => property.id === 'notes')?.name).toBe('Notes');
  });

  it('closes a native person picker on a public read-only transition and does not reopen its old answer button', async () => {
    await mount(blocksFor([{ id: 'people', name: 'People', type: 'person', position: 'a1' }]));
    const answer = requireElement<HTMLButtonElement>('[id="blok-form-form-people"]');

    answer.click();
    await vi.waitFor(() => expect(q('[data-blok-database-person-editor]')).not.toBeNull());
    if (editor === undefined) throw new Error('Missing editor');
    await editor.readOnly.set(true);

    expect(q('[data-blok-database-person-editor]')).toBeNull();
    answer.click();
    expect(q('[data-blok-database-person-editor]')).toBeNull();
  });

  it.each(['view', 'type'] as const)('rejects stale form settings after a public active-%s replacement', async (replacement) => {
    await mount(blocksFor([notes]));
    openQuestionMenu('notes');
    const help = requireElement<HTMLInputElement>(byTestId('database-form-question-description'));
    const original = (await save()).blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;

    if (editor === undefined || original === undefined) throw new Error('Missing database');
    const other = {
      id: 'other', name: 'Other', type: 'form' as const, position: 'a1',
      sorts: [], filters: [], visibleProperties: ['notes'],
      properties: [{ id: 'title', visible: true }, { id: 'notes', visible: true, description: 'Keep other help' }],
    };
    const views = replacement === 'view'
      ? [...original.views, other]
      : original.views.map((view) => ({ ...view, type: 'table' as const, properties: other.properties }));

    await editor.blocks.update('db', {
      ...original, views, activeViewId: replacement === 'view' ? 'other' : 'form',
    });
    help.value = 'Stale help';
    help.dispatchEvent(new Event('input', { bubbles: true }));
    const saved = await save();
    const definition = saved.blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;
    const active = definition?.views.find((view) => view.id === definition.activeViewId);

    expect(active?.properties?.find((setting) => setting.id === 'notes')?.description).toBe('Keep other help');
    expect(q(byTestId('database-form-question-settings'))).toBeNull();
  });

  it('keeps a selected person answer through a same-view public schema redraw while its native picker is open', async () => {
    await mount(blocksFor([
      notes,
      { id: 'people', name: 'People', type: 'person', position: 'a2' },
    ]));
    requireElement<HTMLButtonElement>('[id="blok-form-form-people"]').click();
    await vi.waitFor(() => expect(q('[data-blok-database-person-option="ada"]')).not.toBeNull());
    requireElement('[data-blok-database-person-option="ada"]').click();
    const original = (await save()).blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;

    if (editor === undefined || original === undefined) throw new Error('Missing database');
    await editor.blocks.update('db', {
      ...original,
      schema: original.schema.map((property) => property.id === 'notes' ? { ...property, name: 'Details' } : property),
    });
    dismiss();
    const label = q(`${question('notes')} [data-blok-database-form-label]`)?.textContent;

    submit();
    const saved = await save();
    const response = saved.blocks.find((block) => block.type === 'database-row' && block.id !== 'first' && block.id !== 'second');

    const properties = response?.data.properties;
    const isProperties = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null && !Array.isArray(value);

    if (!isProperties(properties)) throw new Error('Missing response properties');
    expect(properties.people).toEqual([{ id: 'ada' }]);
    expect(label).toBe('Details');
    expect(response?.parent).toBe('db');
  });

  it('rejects a relation narrowed to one page without discarding its two selected answers', async () => {
    const onSubmit = vi.fn();

    await mount(blocksFor([{
      id: 'related', name: 'Related', type: 'relation', position: 'a1',
      relation: { targetDatabaseId: 'db' },
    }]), false, { onSubmit });
    requireElement<HTMLButtonElement>('[id="blok-form-form-related"]').click();
    requireElement('[data-blok-database-relation-option="first"]').click();
    requireElement('[data-blok-database-relation-option="second"]').click();
    const selected = (await save()).blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;

    if (editor === undefined || selected === undefined) throw new Error('Missing selected form');
    await editor.blocks.update('db', {
      ...selected,
      schema: selected.schema.map((property) => property.id === 'related'
        ? { ...property, relation: { targetDatabaseId: 'db', limit: 1 } }
        : property),
    });
    dismiss();
    submit();
    const saved = await save();

    expect(saved.blocks.filter((block) => block.type === 'database-row' && block.id !== 'first' && block.id !== 'second')).toEqual([]);
    expect(onSubmit).not.toHaveBeenCalled();
    const answer = requireElement<HTMLButtonElement>('[id="blok-form-form-related"]');

    expect(answer.getAttribute('aria-invalid')).toBe('true');
    expect(q('[data-blok-database-form-done]')).toBeNull();
    answer.click();
    expect(requireElement('[data-blok-database-relation-option="first"]').getAttribute('aria-selected')).toBe('true');
    expect(requireElement('[data-blok-database-relation-option="second"]').getAttribute('aria-selected')).toBe('true');
  });

  it('rejects a stale submit when the same form closes while its native picker is open', async () => {
    const onSubmit = vi.fn();

    await mount(blocksFor([{ id: 'people', name: 'People', type: 'person', position: 'a1' }]), false, { onSubmit });
    requireElement<HTMLInputElement>('[id="blok-form-form-title"]').value = 'Response';
    const staleSubmit = requireElement<HTMLButtonElement>('[data-blok-database-form-submit]');

    requireElement<HTMLButtonElement>('[id="blok-form-form-people"]').click();
    await vi.waitFor(() => expect(q('[data-blok-database-person-option="ada"]')).not.toBeNull());
    requireElement('[data-blok-database-person-option="ada"]').click();
    const original = (await save()).blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;

    if (editor === undefined || original === undefined) throw new Error('Missing database');
    await editor.blocks.update('db', {
      ...original,
      views: original.views.map((view) => view.id === 'form'
        ? { ...view, form: { ...view.form, closed: true } }
        : view),
    });
    staleSubmit.click();
    const saved = await save();

    expect(saved.blocks.filter((block) => block.type === 'database-row' && block.id !== 'first' && block.id !== 'second')).toEqual([]);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(q('[data-blok-database-person-editor]')).toBeNull();
    expect(q('[data-blok-database-form-closed]')).not.toBeNull();
    expect(q('[data-blok-database-form-submit]')).toBeNull();
    expect(q('[data-blok-database-form-done]')).toBeNull();
    expect(saved.blocks.find((block) => block.id === 'db')?.content).toEqual(['first', 'second']);
    const closed = saved.blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;

    if (closed === undefined) throw new Error('Missing closed database');
    await editor.blocks.update('db', {
      ...closed,
      views: closed.views.map((view) => view.id === 'form'
        ? { ...view, form: { ...view.form, closed: false } }
        : view),
    });
    expect(requireElement<HTMLInputElement>('[id="blok-form-form-title"]').value).toBe('Response');
    requireElement<HTMLButtonElement>('[id="blok-form-form-people"]').click();
    await vi.waitFor(() => expect(q('[data-blok-database-person-chip="ada"]')).not.toBeNull());
    expect(q('[data-blok-database-person-option="ada"]')).toBeNull();
    expect(requireElement('[data-blok-database-person-option="grace"]').getAttribute('aria-selected')).toBe('false');
    dismiss();
    staleSubmit.click();
    const reopened = await save();

    expect(reopened.blocks.filter((block) => block.type === 'database-row' && block.id !== 'first' && block.id !== 'second')).toEqual([]);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each(['source', 'lock'] as const)('closes a builder on a same-form public %s permission replacement', async (replacement) => {
    await mount(blocksFor([notes]));
    openQuestionMenu('notes');
    const name = requireElement<HTMLInputElement>(byTestId('database-form-question-name'));
    const original = (await save()).blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;

    if (editor === undefined || original === undefined) throw new Error('Missing database');
    const next: DatabaseData = replacement === 'source'
      ? { ...original, source: { databaseId: 'remote-db', documentId: 'remote-document' } }
      : {
        ...original,
        schema: original.schema.map((property) => property.type === 'title'
          ? { ...property, databaseLocked: true }
          : property),
      };

    await editor.blocks.update('db', next);

    expect(q(byTestId('database-form-question-settings'))).toBeNull();
    expect(q(byTestId('database-form-question-menu'))).toBeNull();
    name.value = 'Stale rename';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    const saved = await save();
    const definition = saved.blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;

    expect(definition?.schema.find((property) => property.id === 'notes')?.name).toBe('Notes');
    expect(definition?.activeViewId).toBe('form');
  });

  it('closes a native picker when the same form becomes a cross-document read-only source', async () => {
    await mount(blocksFor([{ id: 'people', name: 'People', type: 'person', position: 'a1' }]));
    const answer = requireElement<HTMLButtonElement>('[id="blok-form-form-people"]');

    answer.click();
    await vi.waitFor(() => expect(q('[data-blok-database-person-editor]')).not.toBeNull());
    const original = (await save()).blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;

    if (editor === undefined || original === undefined) throw new Error('Missing database');
    await editor.blocks.update('db', {
      ...original, source: { databaseId: 'remote-db', documentId: 'remote-document' },
    });

    expect(q('[data-blok-database-person-editor]')).toBeNull();
    answer.click();
    expect(q('[data-blok-database-person-editor]')).toBeNull();
    expect(q(byTestId('database-form-question-menu'))).toBeNull();
  });

  it('edits per-question help and switches a text answer between long and short across reloads', async () => {
    await mount(blocksFor([notes]));
    openQuestionMenu('notes');
    edit('database-form-question-description', 'Include the project goal');
    setSwitch('database-form-question-long-answer', true);
    dismiss();
    const longAnswer = await save();

    await mount(longAnswer.blocks, true);
    expect(q(`${question('notes')} textarea`)).not.toBeNull();
    expect(q(`${question('notes')} [data-blok-database-form-description]`)?.textContent).toBe('Include the project goal');
    await mount(longAnswer.blocks);
    openQuestionMenu('notes');
    setSwitch('database-form-question-long-answer', false);
    dismiss();
    const shortAnswer = await save();

    await mount(shortAnswer.blocks, true);
    expect(q(`${question('notes')} input[type="text"]`)).not.toBeNull();
    expect(q(`${question('notes')} textarea`)).toBeNull();
    expect(q(`${question('notes')} [data-blok-database-form-description]`)?.textContent).toBe('Include the project goal');
  });

  it('starts a new text question as a one-line answer', async () => {
    await mount(blocksFor([notes]));
    openQuestionMenu('notes');

    expect(q(byTestId('database-form-question-long-answer'))?.getAttribute('aria-checked')).toBe('false');
    dismiss();
    expect(q(`${question('notes')} textarea`)).toBeNull();
    expect(q(`${question('notes')} input[type="text"]`)).not.toBeNull();
  });

  it('shows a multiple choice question as a dropdown after reload and in read-only, and back as a list', async () => {
    await mount(blocksFor([tags]));
    openQuestionMenu('tags');
    const showAs = requireElement(byTestId('database-form-question-show-options-as'));

    expect(showAs.querySelector('[data-blok-database-panel-value]')?.textContent).toBe('List view');
    showAs.click();
    expect(q(byTestId('database-form-question-show-options-as-list'))?.getAttribute('aria-checked')).toBe('true');
    requireElement(byTestId('database-form-question-show-options-as-dropdown')).click();
    expect(q(`${byTestId('database-form-question-show-options-as')} [data-blok-database-panel-value]`)?.textContent).toBe('Dropdown');
    dismiss();
    const dropdown = await save();

    expect(formSetting(dropdown, 'tags')).toMatchObject({ showOptionsAs: 'dropdown' });
    await mount(dropdown.blocks, true);
    expect(q(`${question('tags')} button[data-blok-database-form-provider-answer]`)).not.toBeNull();
    expect(q(`${question('tags')} fieldset`)).toBeNull();
    await mount(dropdown.blocks);
    openQuestionMenu('tags');
    requireElement(byTestId('database-form-question-show-options-as')).click();
    requireElement(byTestId('database-form-question-show-options-as-list')).click();
    dismiss();
    const list = await save();

    expect(formSetting(list, 'tags')).toMatchObject({ showOptionsAs: 'list' });
    await mount(list.blocks, true);
    expect(q(`${question('tags')} fieldset input[type="checkbox"]`)).not.toBeNull();
  });

  it('picks a preset or custom selection limit, shows it under the question title, and goes back to unlimited', async () => {
    await mount(blocksFor([tags]));
    expect(q(`${question('tags')} [data-blok-database-form-selection-limit]`)?.textContent)
      .toBe('(Respondents can select as many as they like)');
    openQuestionMenu('tags');
    const row = requireElement(byTestId('database-form-question-max-selection'));

    expect(row.querySelector('[data-blok-database-panel-value]')?.textContent).toBe('Unlimited');
    row.click();
    expect([...document.querySelectorAll(`${byTestId('database-form-question-settings')} [role="menuitemradio"]`)]
      .map((choice) => choice.getAttribute('data-blok-testid'))).toEqual(['unlimited', '1', '2', '3', '4', '5', '10']
      .map((choice) => `database-form-question-max-selection-${choice}`));
    requireElement(byTestId('database-form-question-max-selection-1')).click();
    dismiss();
    const one = await save();

    expect(formSetting(one, 'tags')).toMatchObject({ maxSelections: 1 });
    await mount(one.blocks, true);
    expect(q(`${question('tags')} [data-blok-database-form-selection-limit]`)?.textContent).toBe('(Respondents can select up to 1)');
    await mount(one.blocks);
    openQuestionMenu('tags');
    requireElement(byTestId('database-form-question-max-selection')).click();
    edit('database-form-question-max-selections', '7');
    dismiss();
    const custom = await save();

    expect(formSetting(custom, 'tags')).toMatchObject({ maxSelections: 7 });
    await mount(custom.blocks);
    openQuestionMenu('tags');
    requireElement(byTestId('database-form-question-max-selection')).click();
    requireElement(byTestId('database-form-question-max-selection-unlimited')).click();
    dismiss();
    const unlimited = await save();

    expect(formSetting(unlimited, 'tags')).not.toHaveProperty('maxSelections');
  });

  it('changes the question type through the database property and submits the new value shape', async () => {
    await mount(blocksFor([notes]));
    openQuestionMenu('notes');
    requireElement(byTestId('database-form-question-type')).click();
    requireElement(byTestId('database-form-question-type-number')).click();
    dismiss();
    const changed = await save();

    expect(changed.blocks.find((block) => block.id === 'db')?.data.schema).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'notes', type: 'number' }),
    ]));
    await mount(changed.blocks);
    requireElement<HTMLInputElement>(`${question('notes')} input[type="number"]`).value = '12';
    submit();
    const saved = await save();
    const response = saved.blocks.find((block) => block.type === 'database-row' && block.id !== 'first' && block.id !== 'second');

    expect(response?.data.properties).toMatchObject({ title: 'Response', notes: 12 });
    expect(response?.parent).toBe('db');
  });

  it('adds a property-backed question without adding a response row', async () => {
    await mount(blocksFor([notes]));
    const add = q(byTestId('database-form-add-question'));

    expect(add).not.toBeNull();
    if (add === null) throw new Error('Missing add-question control');
    add.click();
    requireElement(byTestId('database-form-new-text')).click();
    edit('database-form-question-name', 'Project budget');
    requireElement(byTestId('database-form-question-type')).click();
    requireElement(byTestId('database-form-question-type-number')).click();
    dismiss();
    const added = [...document.querySelectorAll<HTMLElement>('[data-blok-database-form-question]')]
      .find((element) => element.querySelector('[data-blok-database-form-label]')?.textContent === 'Project budget');
    const id = added?.getAttribute('data-blok-database-form-question');
    const saved = await save();

    expect(saved.blocks.find((block) => block.id === 'db')?.data.schema).toEqual(expect.arrayContaining([
      expect.objectContaining({ id, name: 'Project budget', type: 'number' }),
    ]));
    expect(typeof id).toBe('string');
    expect(id).not.toBe('');
    expect(saved.blocks.filter((block) => block.type === 'database-row').map((block) => block.id)).toEqual(['first', 'second']);
    await mount(saved.blocks, true);
    expect(q(`${question(id ?? '')} input[type="number"]`)).not.toBeNull();
  });

  it('duplicates a question with a new property id and deletes the copy without losing original row values', async () => {
    await mount(blocksFor([notes]));
    openQuestionMenu('notes');
    edit('database-form-question-description', 'Keep this help');
    requireElement(byTestId('database-form-duplicate-question')).click();
    dismiss();
    const copy = [...document.querySelectorAll<HTMLElement>('[data-blok-database-form-question]')]
      .find((element) => element.getAttribute('data-blok-database-form-question') !== 'notes'
        && element.querySelector('[data-blok-database-form-description]')?.textContent === 'Keep this help');
    const id = copy?.getAttribute('data-blok-database-form-question');
    const duplicated = await save();

    expect(copy).toBeDefined();
    expect(typeof id).toBe('string');
    expect(duplicated.blocks.find((block) => block.id === 'db')?.data.schema).toEqual(expect.arrayContaining([
      expect.objectContaining({ id, type: 'text' }),
    ]));
    if (id === null || id === undefined) throw new Error('Missing duplicate question id');
    await mount(duplicated.blocks);
    openQuestionMenu(id);
    requireElement(byTestId('database-form-delete-question')).click();
    dismiss();
    const deleted = await save();

    await mount(deleted.blocks, true);
    expect(q(question(id))).toBeNull();
    expect(q(question('notes'))).not.toBeNull();
    expect(deleted.blocks.find((block) => block.id === 'first')?.data.properties).toMatchObject({ notes: 'Existing first' });
    expect(deleted.blocks.find((block) => block.id === 'second')?.data.properties).toMatchObject({ notes: 'Existing second' });
  });

  it.each([
    {
      property: { id: 'tags', name: 'Tags', type: 'multiSelect', position: 'a1', config: {
        options: [{ id: 'one', label: 'One', position: 'a0' }, { id: 'two', label: 'Two', position: 'a1' }],
      } } satisfies PropertyDefinition,
      first: '[data-blok-database-form-question="tags"] input[value="one"]',
      second: '[data-blok-database-form-question="tags"] input[value="two"]',
      allowedAnswers: [['one'], ['two']],
    },
    {
      property: { id: 'people', name: 'People', type: 'person', position: 'a1' } satisfies PropertyDefinition,
      first: '[data-blok-database-person-option="ada"]',
      second: '[data-blok-database-person-option="grace"]',
      allowedAnswers: [[{ id: 'ada' }], [{ id: 'grace' }]],
    },
    {
      property: { id: 'related', name: 'Related', type: 'relation', position: 'a1',
        relation: { targetDatabaseId: 'db' } } satisfies PropertyDefinition,
      first: '[data-blok-database-relation-option="first"]',
      second: '[data-blok-database-relation-option="second"]',
      allowedAnswers: [[{ id: 'first' }], [{ id: 'second' }]],
    },
  ])('keeps a one-selection limit for $property.type questions after reload', async ({ property, first, second, allowedAnswers }) => {
    await mount(blocksFor([property]));
    openQuestionMenu(property.id);
    requireElement(byTestId('database-form-question-max-selection')).click();
    edit('database-form-question-max-selections', '1');
    dismiss();
    const saved = await save();

    await mount(saved.blocks);
    openQuestionMenu(property.id);
    expect(q(`${byTestId('database-form-question-max-selection')} [data-blok-database-panel-value]`)?.textContent).toBe('1');
    requireElement(byTestId('database-form-question-max-selection')).click();
    expect(q<HTMLInputElement>(byTestId('database-form-question-max-selections'))?.value).toBe('1');
    dismiss();
    if (property.type !== 'multiSelect') {
      requireElement(`[id="blok-form-form-${property.id}"]`).click();
      await vi.waitFor(() => expect(q(first)).not.toBeNull());
    }
    requireElement(first).click();
    requireElement(second).click();

    dismiss();
    submit();
    const submitted = await save();
    const response = submitted.blocks.find((block) => block.type === 'database-row' && block.id !== 'first' && block.id !== 'second');
    const properties = response?.data.properties;
    const isProperties = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null && !Array.isArray(value);

    if (!isProperties(properties)) throw new Error('Missing response properties');
    expect(allowedAnswers).toContainEqual(properties[property.id]);
    expect(properties.title).toBe('Response');
    expect(response?.parent).toBe('db');
    expect(submitted.blocks.find((block) => block.id === 'db')?.content).toContain(response?.id);
    expect(submitted.blocks.filter((block) => block.type === 'database-row')).toHaveLength(3);
  });
});
