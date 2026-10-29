import { findAllByRole, findByRole, fireEvent } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { DatabaseConfig, DatabaseData, PropertyDefinition, PropertyType } from '../../../../src/tools/database/types';

let instance: Blok | undefined;
let holder: HTMLDivElement | undefined;

const autofill = vi.fn(() => Promise.resolve(undefined));

const SCHEMA: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'text', name: 'Text', type: 'text', position: 'a1' },
  { id: 'number', name: 'Number', type: 'number', position: 'a2' },
  { id: 'select', name: 'Select', type: 'select', position: 'a3' },
  { id: 'multiSelect', name: 'Multi', type: 'multiSelect', position: 'a4' },
  { id: 'status', name: 'Status', type: 'status', position: 'a5' },
  { id: 'date', name: 'Date', type: 'date', position: 'a6' },
  { id: 'person', name: 'Person', type: 'person', position: 'a7' },
  { id: 'relation', name: 'Relation', type: 'relation', position: 'a8', relation: { targetDatabaseId: 'db' } },
  { id: 'files', name: 'Files', type: 'files', position: 'a9' },
  { id: 'createdTime', name: 'Created', type: 'createdTime', position: 'b0' },
  { id: 'formula', name: 'Formula', type: 'formula', position: 'b1' },
  { id: 'rollup', name: 'Rollup', type: 'rollup', position: 'b2' },
  { id: 'uniqueId', name: 'ID', type: 'uniqueId', position: 'b3' },
  { id: 'button', name: 'Button', type: 'button', position: 'b4' },
];

const mount = async (options: { ai?: boolean; locked?: boolean } = {}): Promise<void> => {
  const schema = SCHEMA.map((property) => (property.type === 'title' && options.locked === true ? { ...property, databaseLocked: true } : property));
  const database: DatabaseData = {
    title: 'Placement',
    schema,
    views: [{
      id: 'table', name: 'Table', type: 'table', position: 'a0',
      sorts: [], filters: [], visibleProperties: schema.filter((p) => p.type !== 'title').map((p) => p.id),
    }],
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

const menuTitles = async (columnName: string): Promise<string[]> => {
  if (holder === undefined) throw new Error('Missing editor holder');
  fireEvent.click(await findByRole(holder, 'columnheader', { name: columnName }));
  const items = await findAllByRole(document.body, 'menuitem');

  return items.map((item) => (item.textContent ?? '').trim());
};

const indexOf = (titles: string[], pattern: RegExp): number => titles.findIndex((title) => pattern.test(title));

describe('AI Autofill in the column header menu (research/08)', () => {
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

  it('Name (title) lists Show page icon, then AI Autofill, then Filter', async () => {
    await mount();
    if (holder === undefined) throw new Error('Missing editor holder');
    fireEvent.click(await findByRole(holder, 'columnheader', { name: 'Name' }));
    await findAllByRole(document.body, 'menuitem');
    const titles = Array.from(document.body.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"], [role="switch"]'))
      .map((item) => (item.textContent ?? '').trim());

    expect(titles.slice(0, 3)).toEqual(['Show page icon', 'AI Autofill', 'Filter']);
  });

  it.each<[string, PropertyType]>([
    ['Text', 'text'],
    ['Number', 'number'],
    ['Select', 'select'],
    ['Multi', 'multiSelect'],
    ['Status', 'status'],
    ['Date', 'date'],
    ['Person', 'person'],
    ['Relation', 'relation'],
  ])('%s (%s) offers AI Autofill after Change type and before Filter', async (column) => {
    await mount();
    const titles = await menuTitles(column);
    const ai = indexOf(titles, /^AI Autofill$/);

    expect(ai).toBeGreaterThanOrEqual(0);
    expect(ai).toBeGreaterThan(indexOf(titles, /^Change type$/));
    expect(ai).toBeLessThan(indexOf(titles, /^Filter$/));
  });

  it.each<[string, PropertyType]>([
    ['Files', 'files'],
    ['Created', 'createdTime'],
    ['Formula', 'formula'],
    ['Rollup', 'rollup'],
    ['ID', 'uniqueId'],
    ['Button', 'button'],
  ])('%s (%s) has no AI Autofill', async (column) => {
    await mount();
    const titles = await menuTitles(column);

    expect(titles.length).toBeGreaterThan(0);
    expect(indexOf(titles, /AI Autofill|^Autofill /)).toBe(-1);
  });

  it('a locked database shows no AI Autofill, as no other schema edit', async () => {
    await mount({ locked: true });
    const titles = await menuTitles('Text');

    expect(indexOf(titles, /^Filter$/)).toBeGreaterThanOrEqual(0);
    expect(indexOf(titles, /AI Autofill|^Autofill /)).toBe(-1);
  });

  it('without the host autofill hook there is no AI Autofill', async () => {
    await mount({ ai: false });
    const titles = await menuTitles('Text');

    expect(indexOf(titles, /^Change type$/)).toBeGreaterThanOrEqual(0);
    expect(indexOf(titles, /AI Autofill|^Autofill /)).toBe(-1);
  });
});
