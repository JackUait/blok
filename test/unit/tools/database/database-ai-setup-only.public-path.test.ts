import { findByRole, fireEvent, queryByAttribute, waitFor, within } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { DatabaseConfig, DatabaseData } from '../../../../src/tools/database/types';
import type { OutputBlockData } from '../../../../types';

let instance: Blok | undefined;
let holder: HTMLDivElement | undefined;

const setupDatabase = vi.fn(() => Promise.resolve(null));

/** A host that gives only `ai.setupDatabase`. */
const mount = async (): Promise<void> => {
  const database: DatabaseData = {
    title: 'Setup only',
    schema: [
      { id: 'name', name: 'Name', type: 'title', position: 'a0' },
      { id: 'text', name: 'Text', type: 'text', position: 'a1', autofill: { mode: 'summary', onEdit: true } },
    ],
    views: [{ id: 'table', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['text'] }],
    activeViewId: 'table',
  };
  const blocks: OutputBlockData[] = [
    { id: 'db', type: 'database', data: database, content: ['row'] },
    { id: 'row', type: 'database-row', parent: 'db', data: { position: 'a0', properties: { name: 'Alpha' } } },
  ];
  const config = { ai: { setupDatabase } } satisfies DatabaseConfig;

  instance = new Blok({
    holder, dataModel: 'hierarchical', i18n: { locale: 'en' },
    tools: {
      paragraph: Paragraph,
      database: { class: DatabaseTool, config },
      'database-row': DatabaseRowTool,
    },
    data: { blocks },
  });
  await instance.isReady;
  if (holder === undefined) throw new Error('Missing editor holder');
  await findByRole(holder, 'columnheader', { name: /Text/ });
};

const byTestId = (id: string): HTMLElement | null => queryByAttribute('data-blok-testid', document.body, id);

describe('a host with ai.setupDatabase and no ai.autofill', () => {
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

  it('shows no Autofill cell button and no header sparkle', async () => {
    await mount();
    if (holder === undefined) throw new Error('Missing editor holder');
    const cell = holder.querySelector<HTMLElement>('[data-row-id="row"] [role="gridcell"][data-property-id="text"]');

    if (cell === null) throw new Error('Missing text cell');

    expect(within(cell).queryByRole('button', { name: 'Autofill' })).toBeNull();
    expect(within(holder).queryByRole('button', { name: 'Autofill Text' })).toBeNull();
  });

  it('has no AI Autofill row in View settings', async () => {
    await mount();
    const settings = await waitFor(() => {
      const found = byTestId('database-toolbar-settings');

      if (found === null) throw new Error('no settings button');

      return found;
    });

    settings.click();
    await waitFor(() => expect(byTestId('database-settings-layout')).not.toBeNull());

    expect(byTestId('database-settings-autofill')).toBeNull();
  });

  it('has no AI Autofill item in the property menu', async () => {
    await mount();
    if (holder === undefined) throw new Error('Missing editor holder');
    fireEvent.click(await findByRole(holder, 'columnheader', { name: /Text/ }));
    await findByRole(document.body, 'menuitem', { name: /^Rename|^Edit property|^Filter/ });

    expect(within(document.body).queryByRole('menuitem', { name: /AI Autofill|Autofill Text/ })).toBeNull();
  });
});
