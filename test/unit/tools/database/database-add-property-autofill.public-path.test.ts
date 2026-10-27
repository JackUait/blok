import { findByRole, fireEvent, within } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { DatabaseAutofillRequest, DatabaseConfig, DatabaseData } from '../../../../src/tools/database/types';
import type { Blok as PublicBlok } from '../../../../types';

let instance: Blok | undefined;
let editor: PublicBlok | undefined;
let holder: HTMLDivElement | undefined;

const autofill = vi.fn((_request: DatabaseAutofillRequest): Promise<undefined> => Promise.resolve(undefined));

const mount = async (withAutofill: boolean): Promise<void> => {
  const config = (withAutofill ? { ai: { autofill } } : {}) satisfies DatabaseConfig;

  const database: DatabaseData = {
    title: 'Add property',
    schema: [{ id: 'name', name: 'Name', type: 'title', position: 'a0' }],
    views: [{ id: 'table', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
    activeViewId: 'table',
  };

  instance = new Blok({
    holder, dataModel: 'hierarchical', i18n: { locale: 'en' },
    tools: {
      paragraph: Paragraph,
      database: { class: DatabaseTool, config },
      'database-row': DatabaseRowTool,
    },
    data: { blocks: [{ id: 'db', type: 'database', data: database, content: [] }] },
    onReady: (ready) => { editor = ready; },
  });
  await instance.isReady;
  if (holder === undefined) throw new Error('Missing editor holder');
  await findByRole(holder, 'columnheader', { name: 'Name' });
};

const openAddProperty = (): HTMLElement => {
  const plus = holder?.querySelector<HTMLElement>('[data-blok-database-table-add-property]');

  if (plus === null || plus === undefined) throw new Error('Missing add-property button');
  fireEvent.click(plus);
  const menu = document.querySelector<HTMLElement>('[data-blok-database-property-type-popover]');

  if (menu === null) throw new Error('Missing add-property menu');

  return menu;
};

const savedSchema = async (): Promise<DatabaseData['schema']> => {
  if (editor === undefined) throw new Error('Missing ready editor');
  const block = (await editor.save()).blocks.find((saved) => saved.id === 'db');

  return (block?.data as DatabaseData).schema;
};

describe('AI Autofill in the add-property menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    instance?.destroy();
    instance = undefined;
    editor = undefined;
    holder?.remove();
    holder = undefined;
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('is left out when the host has no AI Autofill', async () => {
    await mount(false);
    const menu = openAddProperty();

    expect(within(menu).queryByText('AI Autofill')).toBeNull();
    expect(menu.querySelector('[data-blok-database-property-autofill-option]')).toBeNull();
  });

  it('lists Summarize and Translate, each tagged Basic, above the types', async () => {
    await mount(true);
    const menu = openAddProperty();
    const options = [...menu.querySelectorAll('[data-blok-database-property-autofill-option]')];

    expect(options.map((option) => option.getAttribute('data-blok-database-property-autofill-option'))).toEqual(['summary', 'translate']);
    expect(options.map((option) => option.textContent?.trim())).toEqual(['SummarizeBasic', 'TranslateBasic']);
    const firstType = menu.querySelector('[data-blok-database-property-type-option]');

    expect(firstType !== null && (options[1].compareDocumentPosition(firstType) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
  });

  it('Summarize adds a Text property and opens its setup with the summary prompt', async () => {
    await mount(true);
    const menu = openAddProperty();

    fireEvent.click(menu.querySelector('[data-blok-database-property-autofill-option="summary"]') as HTMLElement);
    const dialog = await findByRole(document.body, 'dialog');

    expect((await savedSchema()).map((p) => [p.name, p.type])).toEqual([['Name', 'title'], ['Text', 'text']]);
    expect(within(dialog).getByText('Autofill Text')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Instructions' })).toHaveValue('Summarize this page in one paragraph.');
    expect(document.querySelector('[data-blok-database-property-type-popover]')).toBeNull();
    // A draft only: Save writes the setting.
    expect((await savedSchema()).find((p) => p.name === 'Text')?.autofill).toBeUndefined();
    expect(autofill).not.toHaveBeenCalled();
  });

  it('Translate keeps the typed name and opens the setup with the translate prompt', async () => {
    await mount(true);
    const menu = openAddProperty();
    const field = menu.querySelector<HTMLInputElement>('[data-blok-database-property-name-input]');

    if (field === null) throw new Error('Missing name field');
    field.value = 'French';
    fireEvent.click(menu.querySelector('[data-blok-database-property-autofill-option="translate"]') as HTMLElement);
    const dialog = await findByRole(document.body, 'dialog');

    expect((await savedSchema()).map((p) => [p.name, p.type])).toEqual([['Name', 'title'], ['French', 'text']]);
    expect(within(dialog).getByRole('textbox', { name: 'Instructions' })).toHaveValue('Translate this page into English.');
  });

  // research/08, research/12 §1, notion-spec-2 §17.9: the table's "+" is its own surface, a two-column grid under "Select type".
  it('opens the table header "+" as the two-column type grid', async () => {
    await mount(false);
    const menu = openAddProperty();

    expect(menu.getAttribute('data-blok-database-property-type-layout')).toBe('grid');
  });
});
