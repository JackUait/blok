import { findAllByRole, findByRole, fireEvent, within } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { DatabaseTool } from '../../../../src/tools/database';
import { languageName } from '../../../../src/tools/database/database-autofill-setup';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { Paragraph } from '../../../../src/tools/paragraph';
import ku from '../../../../src/components/i18n/locales/ku.json';
import type { AutofillSettings, DatabaseAutofillRequest, DatabaseConfig, DatabaseData } from '../../../../src/tools/database/types';
import type { Blok as PublicBlok, OutputBlockData } from '../../../../types';

let instance: Blok | undefined;
let editor: PublicBlok | undefined;
let holder: HTMLDivElement | undefined;

const autofill = vi.fn((_request: DatabaseAutofillRequest): Promise<undefined> => Promise.resolve(undefined));

const mount = async (withRow = false, textAutofill?: AutofillSettings, locale = 'en'): Promise<void> => {
  const database: DatabaseData = {
    title: 'Basic setup',
    schema: [
      { id: 'name', name: 'Name', type: 'title', position: 'a0' },
      { id: 'status', name: 'Status', type: 'status', position: 'a1' },
      { id: 'text', name: 'Text', type: 'text', position: 'a2', ...(textAutofill === undefined ? {} : { autofill: textAutofill }) },
    ],
    views: [{
      id: 'table', name: 'Table', type: 'table', position: 'a0',
      sorts: [], filters: [], visibleProperties: ['status', 'text'],
    }],
    activeViewId: 'table',
  };
  const blocks: OutputBlockData[] = [{
    id: 'db', type: 'database', data: database, content: withRow ? ['row'] : [],
  }];

  if (withRow) {
    blocks.push({
      id: 'row', type: 'database-row', parent: 'db',
      data: { position: 'a0', properties: { name: 'Keep this name', text: 'Keep this text' } },
    });
  }

  const config = { ai: { autofill } } satisfies DatabaseConfig;

  instance = new Blok({
    holder, dataModel: 'hierarchical', i18n: { locale },
    tools: {
      paragraph: Paragraph,
      database: { class: DatabaseTool, config },
      'database-row': DatabaseRowTool,
    },
    data: { blocks },
    onReady: (ready) => { editor = ready; },
  });
  await instance.isReady;
  if (holder === undefined) throw new Error('Missing editor holder');
  await findByRole(holder, 'columnheader', { name: 'Text' });
};

const savedBlocks = async (): Promise<OutputBlockData[]> => {
  if (editor === undefined) throw new Error('Missing ready editor');

  return (await editor.save()).blocks;
};

const openTextMenu = async (): Promise<void> => {
  if (holder === undefined) throw new Error('Missing editor holder');
  fireEvent.click(await findByRole(holder, 'columnheader', { name: 'Text' }));
};

const openBasic = async (): Promise<HTMLElement> => {
  await openTextMenu();
  fireEvent.click(await findByRole(document.body, 'menuitem', { name: /^AI Autofill(?:\s|$)/ }));
  fireEvent.click(await findByRole(document.body, 'menuitem', { name: /^Basic(?:\s|$)/ }));

  return findByRole(document.body, 'dialog');
};

const instructions = (dialog: HTMLElement): string => {
  const field = within(dialog).getByRole('textbox', { name: 'Instructions' });

  return (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
    ? field.value
    : field.textContent ?? '').trim();
};

const chooseParagraph = async (dialog: HTMLElement): Promise<HTMLElement> => {
  fireEvent.click(within(dialog).getByRole('button', { name: 'Summarize' }));
  fireEvent.click(await findByRole(document.body, 'menuitem', { name: 'Paragraph' }));

  return findByRole(document.body, 'dialog');
};

const openSaved = async (): Promise<HTMLElement> => {
  await openTextMenu();
  fireEvent.click(await findByRole(document.body, 'menuitem', { name: 'Autofill Text' }));

  return findByRole(document.body, 'dialog');
};

const savedAutofill = async (): Promise<AutofillSettings | undefined> => {
  const database = (await savedBlocks()).find((block) => block.id === 'db')?.data as DatabaseData | undefined;

  return database?.schema.find((property) => property.id === 'text')?.autofill;
};

const discard = async (dialog: HTMLElement): Promise<HTMLElement> => {
  fireEvent.click(within(dialog).getByRole('button', { name: 'Discard changes' }));
  const confirmation = await findByRole(document.body, 'dialog', { name: /discard.*changes/i });

  fireEvent.click(within(confirmation).getByRole('button', { name: 'Discard changes' }));
  await vi.waitFor(() => expect(confirmation).not.toBeInTheDocument());

  return findByRole(document.body, 'dialog');
};

const turnOnUpdate = async (dialog: HTMLElement): Promise<void> => {
  fireEvent.click(within(dialog).getByRole('button', { name: 'On page update None' }));
  const choice = await findByRole(document.body, 'menuitemcheckbox', { name: 'Any properties' });

  fireEvent.click(choice);
  await vi.waitFor(() => expect(within(dialog).getByRole('button', { name: 'On page update Any properties' })).toBeInTheDocument());
};

const typeInstruction = (dialog: HTMLElement, text: string): void => {
  fireEvent.input(within(dialog).getByRole('textbox', { name: 'Instructions' }), { target: { value: text } });
};

describe('Basic AI setup actions', () => {
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

  it('Generate fills every row with the draft and saves nothing', async () => {
    await mount(true);
    const before = await savedBlocks();
    const filled = await chooseParagraph(await openBasic());

    await vi.waitFor(() => expect(instructions(filled)).not.toBe(''));
    fireEvent.click(within(filled).getByRole('button', { name: 'Generate' }));

    expect(autofill).toHaveBeenCalledTimes(1);
    expect(autofill.mock.calls[0]?.[0]).toMatchObject({ databaseId: 'db', rowId: 'row', propertyId: 'text', settings: { mode: 'summary', instruction: instructions(filled) } });
    expect(await savedBlocks()).toEqual(before);
  });

  it('Save writes property.autofill, then Run AI Autofill now fills every row with it', async () => {
    await mount(true);
    const filled = await chooseParagraph(await openBasic());

    await vi.waitFor(() => expect(instructions(filled)).not.toBe(''));
    const instruction = instructions(filled);

    fireEvent.click(within(filled).getByRole('button', { name: 'Save changes' }));
    const database = (await savedBlocks()).find((block) => block.id === 'db')?.data as DatabaseData | undefined;

    expect(database?.schema.find((property) => property.id === 'text')?.autofill).toEqual({ mode: 'summary', instruction });
    expect(autofill).not.toHaveBeenCalled();
    expect(within(filled).getByRole('button', { name: 'Save changes' })).toBeDisabled();
    fireEvent.click(within(filled).getByRole('button', { name: 'Run AI Autofill now' }));
    expect(autofill).toHaveBeenCalledTimes(1);
    expect(autofill.mock.calls[0]?.[0]).toMatchObject({ rowId: 'row', propertyId: 'text', settings: { mode: 'summary', instruction } });
  });

  it('Discard after Translate restores the saved settings exactly, with no language left behind', async () => {
    await mount(true, { mode: 'summary', instruction: 'Sum it up' });
    const dialog = await openSaved();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Translate' }));
    const reset = await discard(dialog);

    expect(within(reset).getByRole('button', { name: 'Discard changes' })).toBeDisabled();
    expect(instructions(reset)).toBe('Sum it up');
    expect(within(reset).getByRole('button', { name: 'Run AI Autofill now' })).toBeEnabled();
    await turnOnUpdate(reset);
    fireEvent.click(within(reset).getByRole('button', { name: 'Save changes' }));
    expect(await savedAutofill()).toEqual({ mode: 'summary', instruction: 'Sum it up', onEdit: true });
  });

  it('Discard after Translate with nothing saved forgets the draft, so the menu says AI Autofill again', async () => {
    await mount();
    const dialog = await openBasic();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Translate' }));
    const reset = await discard(dialog);

    fireEvent.click(within(reset).getByRole('button', { name: 'Close' }));
    await vi.waitFor(() => expect(reset).not.toBeInTheDocument());
    await openTextMenu();
    expect(await findByRole(document.body, 'menuitem', { name: /^AI Autofill(?:\s|$)/ })).toBeInTheDocument();
  });

  it('an instruction rewritten after Translate saves as a custom instruction', async () => {
    await mount();
    const dialog = await openBasic();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Translate' }));
    typeInstruction(dialog, 'Extract the due date');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    expect(await savedAutofill()).toEqual({ mode: 'custom', instruction: 'Extract the due date' });
  });

  it('saved translate settings with no instruction can run, and a trigger change saves', async () => {
    await mount(true, { mode: 'translate', language: 'fr' });
    const dialog = await openSaved();

    expect(within(dialog).getByRole('button', { name: 'Run AI Autofill now' })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run AI Autofill now' }));
    expect(autofill.mock.calls[0]?.[0].settings).toEqual({ mode: 'translate', language: 'fr' });
    await turnOnUpdate(dialog);
    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await savedAutofill()).toEqual({ mode: 'translate', language: 'fr', onEdit: true });
  });

  it('On page creation offers None and Any page creation, as Notion does', async () => {
    await mount(true, { mode: 'summary', instruction: 'Sum it up' });
    const dialog = await openSaved();

    fireEvent.click(within(dialog).getByRole('button', { name: 'On page creation None' }));
    const items = await findAllByRole(document.body, 'menuitemcheckbox');

    expect(items.map((item) => item.textContent?.trim())).toEqual(['None', 'Any page creation']);
    fireEvent.click(items[1]);
    await vi.waitFor(() => expect(within(dialog).getByRole('button', { name: 'On page creation Any page creation' })).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await savedAutofill()).toEqual({ mode: 'summary', instruction: 'Sum it up', onCreate: true });
  });

  it('On page update: Only specific properties saves the chosen properties', async () => {
    await mount(true, { mode: 'summary', instruction: 'Sum it up' });
    const dialog = await openSaved();

    fireEvent.click(within(dialog).getByRole('button', { name: 'On page update None' }));
    const items = await findAllByRole(document.body, 'menuitemcheckbox');

    expect(items.map((item) => item.textContent?.trim())).toEqual(['None', 'Any properties', 'Only specific properties']);
    fireEvent.click(items[2]);
    const status = await findByRole(document.body, 'menuitemcheckbox', { name: 'Status' });

    // The autofill property itself is not a trigger: its own answer would fire it again.
    expect(within(document.body).queryByRole('menuitemcheckbox', { name: 'Text' })).toBeNull();
    fireEvent.click(status);
    await vi.waitFor(() => expect(within(dialog).getByRole('button', { name: 'On page update Only specific properties' })).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await savedAutofill()).toEqual({ mode: 'summary', instruction: 'Sum it up', onEdit: true, onEditProperties: ['status'] });
  });

  it('More… > Delete AI Autofill removes the setting and closes the setup', async () => {
    await mount(true, { mode: 'summary', instruction: 'Sum it up', onCreate: true });
    const dialog = await openSaved();

    fireEvent.click(within(dialog).getByRole('button', { name: 'More…' }));
    fireEvent.click(await findByRole(document.body, 'menuitem', { name: 'Delete AI Autofill' }));

    await vi.waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(await savedAutofill()).toBeUndefined();
    await openTextMenu();
    expect(await findByRole(document.body, 'menuitem', { name: /^AI Autofill(?:\s|$)/ })).toBeInTheDocument();
  });

  it('a draft does not survive a type change', async () => {
    await mount();
    const dialog = await chooseParagraph(await openBasic());

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await vi.waitFor(() => expect(dialog).not.toBeInTheDocument());
    await openTextMenu();
    fireEvent.click(await findByRole(document.body, 'menuitem', { name: /^Change type(?:\s|$)/ }));
    fireEvent.click(await findByRole(document.body, 'menuitem', { name: 'Number' }));
    if (holder === undefined) throw new Error('Missing editor holder');
    await vi.waitFor(() => expect(within(document.body).queryAllByRole('menuitem')).toHaveLength(0));
    fireEvent.click(await findByRole(holder, 'columnheader', { name: 'Text' }));

    expect(await findByRole(document.body, 'menuitem', { name: /^AI Autofill(?:\s|$)/ })).toBeInTheDocument();
  });

  it('names the Translate language in the UI locale', () => {
    expect(languageName('fr', 'de')).toBe('Französisch');
  });

  it('Translate in the ku (Sorani) UI targets ckb, not Kurmanji', async () => {
    await mount(false, undefined, 'ku');
    await openTextMenu();
    fireEvent.click(await findByRole(document.body, 'menuitem', { name: ku['tools.database.aiAutofill'] }));
    fireEvent.click(await findByRole(document.body, 'menuitem', { name: ku['tools.database.aiAutofillBasic'] }));
    const dialog = await findByRole(document.body, 'dialog');

    fireEvent.click(within(dialog).getByRole('button', { name: ku['tools.database.aiAutofillTranslate'] }));
    expect(within(dialog).getByRole('textbox', { name: ku['tools.database.aiAutofillInstructions'] })).toHaveValue(
      ku['tools.database.aiAutofillTranslatePrompt'].replace('{language}', new Intl.DisplayNames(['ckb'], { type: 'language' }).of('ckb') ?? '')
    );
    const field = within(dialog).getByRole('textbox', { name: ku['tools.database.aiAutofillInstructions'] });

    expect(field instanceof HTMLTextAreaElement ? field.value : '').not.toContain('kurmancî');
    fireEvent.click(within(dialog).getByRole('button', { name: ku['tools.database.aiAutofillSave'] }));
    expect((await savedAutofill())?.language).toBe('ckb');
  });

  it('a read-only editor never opens the header menu, so no setup', async () => {
    await mount(true);
    await editor?.readOnly.toggle(true);
    await openTextMenu();

    expect(within(document.body).queryAllByRole('menuitem')).toHaveLength(0);
  });
});

// Last: a stale dismiss layer from a failing run would leak into later tests.
describe('Basic AI setup teardown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    holder?.remove();
    holder = undefined;
    editor = undefined;
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('destroying the editor while the Discard confirm is open closes it, and no Escape is swallowed', async () => {
    await mount();
    const dialog = await chooseParagraph(await openBasic());

    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard changes' }));
    await findByRole(document.body, 'dialog', { name: /discard.*changes/i });
    instance?.destroy();
    instance = undefined;
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });

    document.body.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
  });
});
