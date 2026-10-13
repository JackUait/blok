import { findByRole, fireEvent, within } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { AutofillSettings, DatabaseAutofillRequest, DatabaseConfig, DatabaseData, PropertyValue } from '../../../../src/tools/database/types';
import type { Blok as PublicBlok, OutputBlockData } from '../../../../types';

let instance: Blok | undefined;
let editor: PublicBlok | undefined;
let holder: HTMLDivElement | undefined;

/** Each call waits until the test answers it. */
const answers: Array<(value: PropertyValue | null) => void> = [];
const autofill = vi.fn((_request: DatabaseAutofillRequest): Promise<PropertyValue | null> => new Promise((resolve) => {
  answers.push(resolve);
}));

const mount = async (options: { text?: string; settings?: AutofillSettings | null; ai?: boolean; locked?: boolean } = {}): Promise<void> => {
  const settings = options.settings === undefined ? { mode: 'summary' as const } : options.settings;
  const database: DatabaseData = {
    title: 'Cells',
    schema: [
      { id: 'name', name: 'Name', type: 'title', position: 'a0', ...(options.locked === true ? { databaseLocked: true } : {}) },
      { id: 'text', name: 'Text', type: 'text', position: 'a1', ...(settings === null ? {} : { autofill: settings }) },
      { id: 'notes', name: 'Notes', type: 'text', position: 'a2' },
    ],
    views: [{
      id: 'table', name: 'Table', type: 'table', position: 'a0',
      sorts: [], filters: [], visibleProperties: ['text', 'notes'],
    }],
    activeViewId: 'table',
  };
  const blocks: OutputBlockData[] = [
    { id: 'db', type: 'database', data: database, content: ['row'] },
    {
      id: 'row', type: 'database-row', parent: 'db',
      data: { position: 'a0', properties: { name: 'Alpha', ...(options.text === undefined ? {} : { text: options.text }) } },
    },
  ];
  const config = (options.ai === false ? {} : { ai: { autofill } }) satisfies DatabaseConfig;

  instance = new Blok({
    holder, dataModel: 'hierarchical', i18n: { locale: 'en' },
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
  await findByRole(holder, 'columnheader', { name: /Text/ });
};

const cell = (propertyId: string): HTMLElement => {
  const found = holder?.querySelector<HTMLElement>(`[data-row-id="row"] [role="gridcell"][data-property-id="${propertyId}"]`);

  if (found === null || found === undefined) throw new Error(`Missing ${propertyId} cell`);

  return found;
};

/** Read again each time: an answer may redraw the table. */
const autofillButton = (): HTMLElement | null => within(cell('text')).queryByRole('button', { name: 'Autofill' });

const sparkle = (): HTMLElement | null => (holder === undefined ? null : within(holder).queryByRole('button', { name: 'Autofill Text' }));

const savedText = async (): Promise<PropertyValue | undefined> => {
  if (editor === undefined) throw new Error('Missing ready editor');
  const row = (await editor.save()).blocks.find((block) => block.id === 'row');

  return (row?.data as { properties?: Record<string, PropertyValue> } | undefined)?.properties?.text;
};

/** Lets the history record a change: a timer, then frames. */
const quiet = async (): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => {
      requestAnimationFrame(() => resolve(undefined));
    });
  }
};

const answer = async (value: PropertyValue | null): Promise<void> => {
  answers.shift()?.(value);
  await vi.waitFor(() => expect(within(cell('text')).queryByText('Thinking…')).toBeNull());
};

describe('AI Autofill cell button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    answers.length = 0;
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

  it('an empty autofill cell offers Autofill; a click shows Thinking… then the answer', async () => {
    await mount();

    expect(within(cell('notes')).queryByRole('button', { name: 'Autofill' })).toBeNull();
    const button = autofillButton();

    if (button !== null) fireEvent.click(button);

    expect(autofill).toHaveBeenCalledTimes(1);
    expect(autofill.mock.calls[0]?.[0]).toMatchObject({ databaseId: 'db', rowId: 'row', propertyId: 'text', settings: { mode: 'summary' } });
    await vi.waitFor(() => expect(within(cell('text')).getByText('Thinking…')).toBeInTheDocument());
    expect(autofillButton()).toBeNull();

    await answer('The page describes Alpha.');

    await vi.waitFor(() => expect(cell('text')).toHaveTextContent('The page describes Alpha.'));
    expect(await savedText()).toBe('The page describes Alpha.');
    expect(autofillButton()).not.toBeNull();
  });

  it('Mod+Enter on the selected autofill cell runs it from the keyboard', async () => {
    await mount({ text: 'Old summary' });
    /** Read again each time: closing an editor redraws the table. */
    const grid = (): HTMLElement => {
      if (holder === undefined) throw new Error('Missing editor holder');

      return within(holder).getByRole('grid');
    };

    fireEvent.click(cell('notes'));
    fireEvent.keyDown(await findByRole(document.body, 'textbox'), { key: 'Escape' });
    fireEvent.keyDown(grid(), { key: 'ArrowLeft' });

    expect(cell('text')).toHaveAttribute('aria-keyshortcuts', 'Meta+Enter Control+Enter');
    fireEvent.keyDown(grid(), { key: 'Enter', ctrlKey: true });

    expect(autofill).toHaveBeenCalledTimes(1);
    expect(autofill.mock.calls[0]?.[0]).toMatchObject({ rowId: 'row', propertyId: 'text' });
    expect(within(document.body).queryByRole('textbox')).toBeNull();
    await vi.waitFor(() => expect(within(cell('text')).getByText('Thinking…')).toBeInTheDocument());
    expect(cell('text')).not.toHaveAttribute('aria-keyshortcuts');
    await answer('New summary');
  });

  it('a filled cell is replaced at once, with no confirm', async () => {
    await mount({ text: 'Old summary' });
    const button = autofillButton();

    expect(button).not.toBeNull();
    if (button !== null) fireEvent.click(button);
    expect(within(document.body).queryByRole('dialog')).toBeNull();
    await answer('New summary');

    await vi.waitFor(() => expect(cell('text')).toHaveTextContent('New summary'));
    expect(await savedText()).toBe('New summary');
  });

  it('an answer with nothing to say ends Thinking… and keeps the old value', async () => {
    await mount({ text: 'Old summary' });
    const button = autofillButton();

    expect(button).not.toBeNull();
    if (button !== null) fireEvent.click(button);
    await answer(null);

    expect(cell('text')).toHaveTextContent('Old summary');
    expect(await savedText()).toBe('Old summary');
  });

  it('a value written while the host works wins over the late answer', async () => {
    await mount({ text: 'Old summary' });
    const button = autofillButton();

    expect(button).not.toBeNull();
    if (button !== null) fireEvent.click(button);
    const second = autofillButton();

    expect(second).toBeNull();
    // A peer or another tab could change the value: write it the way a host lever does.
    const block = editor?.blocks.getById('row');

    expect(block).not.toBeNull();
    block?.call('updateProperties', { text: 'Typed by a person' });
    block?.dispatchChange();
    await answer('Stale answer');

    expect(await savedText()).toBe('Typed by a person');
  });

  it('an answer that lands while another cell\'s editor is open shows the new value at once', async () => {
    await mount({ text: 'Old summary' });
    const button = autofillButton();

    expect(button).not.toBeNull();
    if (button !== null) fireEvent.click(button);
    expect(within(document.body).queryByRole('textbox')).toBeNull();
    fireEvent.click(cell('notes'));
    const field = await findByRole(document.body, 'textbox');

    await answer('New summary');

    expect(cell('text')).toHaveTextContent('New summary');
    // The open editor kept the table from redrawing: the repaint alone showed it.
    expect(field.isConnected).toBe(true);
  });

  it('deleting the one watched property sets the trigger to None, and one undo brings both back', async () => {
    await mount({ settings: { mode: 'summary', onEdit: true, onEditProperties: ['notes'] } });
    if (editor === undefined) throw new Error('Missing ready editor');
    const history = (editor as unknown as { history: { undo: () => void } }).history;
    const saved = async (): Promise<DatabaseData | undefined> =>
      (await editor?.save())?.blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;
    const textAutofill = async (): Promise<AutofillSettings | undefined> =>
      (await saved())?.schema.find((property) => property.id === 'text')?.autofill;

    await quiet();
    if (holder === undefined) throw new Error('Missing editor holder');
    fireEvent.click(await findByRole(holder, 'columnheader', { name: /Notes/ }));
    fireEvent.click(await findByRole(document.body, 'menuitem', { name: 'Delete property' }));
    fireEvent.click(await findByRole(document.body, 'menuitem', { name: 'Delete this property?' }));
    await quiet();
    await vi.waitFor(async () => expect((await saved())?.schema.some((property) => property.id === 'notes')).toBe(false));
    expect(await textAutofill()).toEqual({ mode: 'summary' });

    history.undo();
    await vi.waitFor(async () => expect((await saved())?.schema.some((property) => property.id === 'notes')).toBe(true));
    expect(await textAutofill()).toEqual({ mode: 'summary', onEdit: true, onEditProperties: ['notes'] });
  });

  it('the header sparkle sits beside the header button, not inside it', async () => {
    await mount();
    if (holder === undefined) throw new Error('Missing editor holder');
    const text = await findByRole(holder, 'columnheader', { name: /Text/ });

    const headerButton = within(text).getByRole('button', { name: 'Text' });

    expect(headerButton).not.toContainElement(sparkle());
    expect(text).toContainElement(sparkle());
  });

  it('a read-only editor shows no Autofill button and no header sparkle', async () => {
    await mount({ text: 'Old summary' });
    await editor?.readOnly.toggle(true);
    const root = holder;

    if (root === undefined) throw new Error('Missing editor holder');
    await vi.waitFor(() => expect(within(root).queryByRole('button', { name: /^Drag to move/ })).toBeNull());

    expect(autofillButton()).toBeNull();
    expect(sparkle()).toBeNull();
  });

  it('a locked database shows no Autofill button and no header sparkle', async () => {
    await mount({ locked: true });

    expect(autofillButton()).toBeNull();
    expect(sparkle()).toBeNull();
  });

  it('without config.ai there is no Autofill button', async () => {
    await mount({ ai: false });

    expect(autofillButton()).toBeNull();
    expect(sparkle()).toBeNull();
  });

  it('a column with no autofill setting has no sparkle; one with it opens the setup', async () => {
    await mount();
    if (holder === undefined) throw new Error('Missing editor holder');
    const notes = await findByRole(holder, 'columnheader', { name: /Notes/ });

    expect(within(notes).queryByRole('button', { name: 'Autofill Notes' })).toBeNull();
    const text = await findByRole(holder, 'columnheader', { name: /Text/ });

    fireEvent.click(within(text).getByRole('button', { name: 'Autofill Text' }));
    const dialog = await findByRole(document.body, 'dialog', { name: 'Autofill Text' });

    expect(within(dialog).getByRole('button', { name: 'Run AI Autofill now' })).toBeEnabled();
    // The sparkle opens the setup only: no property menu under it.
    expect(within(document.body).queryAllByRole('menuitem')).toHaveLength(0);
  });
});
