import { findByRole, queryByAttribute, waitFor, within } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { DatabaseConfig, DatabaseData, PropertyDefinition } from '../../../../src/tools/database/types';

let instance: Blok | undefined;
let holder: HTMLDivElement | undefined;

const autofill = vi.fn(() => Promise.resolve(undefined));

const SCHEMA: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'sum', name: 'Summary', type: 'text', position: 'a1', autofill: { mode: 'summary', instruction: 'Sum it up.' } },
  { id: 'notes', name: 'Notes', type: 'text', position: 'a2' },
  { id: 'calc', name: 'Calc', type: 'formula', position: 'a3' },
];

const mount = async (options: { ai?: boolean } = {}): Promise<void> => {
  const database: DatabaseData = {
    title: 'Autofill',
    schema: SCHEMA,
    views: [{ id: 'table', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['sum', 'notes', 'calc'] }],
    activeViewId: 'table',
  };
  const config = (options.ai === false ? {} : { ai: { autofill } }) satisfies DatabaseConfig;

  instance = new Blok({
    holder, dataModel: 'hierarchical', i18n: { locale: 'en' },
    tools: {
      paragraph: Paragraph,
      database: { class: DatabaseTool, config },
      'database-row': DatabaseRowTool,
    },
    data: { blocks: [{ id: 'db', type: 'database', data: database, content: [] }] },
  });
  await instance.isReady;
};

const byTestId = (id: string): HTMLElement | null => queryByAttribute('data-blok-testid', document.body, id);

const press = async (id: string): Promise<HTMLElement> => {
  const el = await waitFor(() => {
    const found = byTestId(id);

    if (found === null) throw new Error(`no ${id}`);

    return found;
  });

  el.click();

  return el;
};

describe('View settings > AI Autofill (research/12 §2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    instance?.destroy();
    instance = undefined;
    holder?.remove();
    holder = undefined;
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('shows no AI Autofill row without the host autofill hook', async () => {
    await mount({ ai: false });
    await press('database-toolbar-settings');
    await waitFor(() => expect(byTestId('database-settings-layout')).not.toBeNull());

    expect(byTestId('database-settings-autofill')).toBeNull();
  });

  it('counts the autofill properties and opens the real setup from the list', async () => {
    await mount();
    await press('database-toolbar-settings');
    const row = await waitFor(() => {
      const found = byTestId('database-settings-autofill');

      if (found === null) throw new Error('no row');

      return found;
    });

    expect(row.textContent).toContain('AI Autofill');
    expect(row.textContent).toContain('1');
    row.click();
    const card = await press('database-autofill-open-sum');

    expect(card.textContent).toContain('Autofill Summary');
    const dialog = await findByRole(document.body, 'dialog', { name: 'Autofill Summary' });

    expect(byTestId('database-settings-autofill')).toBeNull();
    await waitFor(() => expect(within(dialog).getAllByRole('textbox')).toContain(document.activeElement));
  });

  it('"New AI Autofill" offers only properties of the saved schema that can autofill and have none', async () => {
    await mount();
    await press('database-toolbar-settings');
    await press('database-settings-autofill');
    await press('database-autofill-new');
    await waitFor(() => expect(byTestId('database-autofill-pick-notes')).not.toBeNull());

    expect(byTestId('database-autofill-pick-sum')).toBeNull();
    expect(byTestId('database-autofill-pick-calc')).toBeNull();
    byTestId('database-autofill-pick-notes')?.click();

    await findByRole(document.body, 'dialog', { name: 'Autofill Notes' });
  });
});
