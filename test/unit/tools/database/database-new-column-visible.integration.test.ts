import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SCHEMA, buildTool, makeDoc, tableData } from './tier3-harness';
import type { DatabaseTool } from '../../../../src/tools/database';
import { csvDatabaseBlocks } from '../../../../src/tools/database/database-csv';
import type { DatabaseData } from '../../../../src/tools/database/types';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

const built: DatabaseTool[] = [];

const build = (data: DatabaseData): { tool: DatabaseTool; el: HTMLElement } => {
  const result = buildTool(makeDoc([]), {}, data);

  built.push(result.tool);

  return result;
};

const headerOrder = (el: HTMLElement): string[] =>
  [...el.querySelectorAll('[data-blok-database-table-column-header]')].map((header) => header.getAttribute('data-property-id') ?? '');

const menuItem = (title: string): HTMLElement => {
  const titleEl = [...document.querySelectorAll<HTMLElement>('[data-blok-popover-opened] [data-blok-testid="popover-item-title"]')]
    .find((node) => node.textContent === title);
  const item = titleEl?.closest<HTMLElement>('[data-blok-popover-item]');

  if (item === null || item === undefined) throw new Error(`no ${title} item`);

  return item;
};

const pickText = (): void => {
  const text = document.querySelector<HTMLElement>('[data-blok-database-property-type-option="text"]');

  if (text === null) throw new Error('no type list');
  text.click();
};

const addFromHeaderPlus = (el: HTMLElement): void => {
  el.querySelector<HTMLElement>('[data-blok-database-table-add-property]')?.click();
  pickText();
};

const insertRightOf = (el: HTMLElement, propertyId: string): void => {
  el.querySelector<HTMLElement>(`[data-blok-database-table-column-header][data-property-id="${propertyId}"] [data-blok-database-table-column-button]`)?.click();
  menuItem('tools.database.tableInsertRight').click();
  pickText();
};

const newId = (tool: DatabaseTool, el: HTMLElement): string => {
  const id = tool.save(el).schema.find((p) => !SCHEMA.some((known) => known.id === p.id))?.id;

  if (id === undefined) throw new Error('no new property');

  return id;
};

/** The legacy shape: `visibleProperties` lists the columns, no `properties`. A v1.16.1 document reads like this. */
const legacy = (visibleProperties: string[]): DatabaseData => {
  const data = tableData(SCHEMA, { visibleProperties });

  expect(data.views[0].properties).toBeUndefined();

  return data;
};

describe('DatabaseTool — a column added from a table view shows in it', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    built.splice(0).forEach((tool) => tool.destroy());
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('header "+" on a view that lists visibleProperties shows the new column', () => {
    const { tool, el } = build(legacy(['notes', 'where']));

    addFromHeaderPlus(el);
    const id = newId(tool, el);

    expect(headerOrder(el)).toContain(id);
    expect(tool.save(el).views[0].visibleProperties).toContain(id);
  });

  it('Insert right on that view shows the new column right after this one', () => {
    const { tool, el } = build(legacy(['notes', 'where']));

    insertRightOf(el, 'notes');
    const id = newId(tool, el);

    expect(headerOrder(el)).toEqual(['title', 'notes', id, 'where']);
    expect(tool.save(el).views[0].visibleProperties).toEqual(['notes', id, 'where']);
  });

  it('a column the legacy list leaves out stays hidden after another is added', () => {
    const { tool, el } = build(legacy(['notes']));

    expect(headerOrder(el)).toEqual(['title', 'notes']);
    addFromHeaderPlus(el);
    const id = newId(tool, el);

    expect(headerOrder(el)).not.toContain('where');
    expect(headerOrder(el)).toContain(id);
    expect(tool.save(el).views[0].properties?.find((p) => p.id === 'where')?.visible).toBe(false);
  });

  it('header "+" on a CSV-imported database shows the new column', () => {
    const imported = csvDatabaseBlocks([['Task', 'Points'], ['Write', '3']], {
      newId: (() => { let n = 0; return () => `csv${n++}`; })(), untitled: 'Column', viewName: 'Table', title: 'Pasted',
    });
    const { tool, el } = build(imported.data);
    const before = imported.data.schema.map((p) => p.id);

    addFromHeaderPlus(el);
    const id = tool.save(el).schema.find((p) => !before.includes(p.id))?.id;

    expect(id).toBeDefined();
    expect(headerOrder(el)).toEqual([...before, id]);
  });

  it('Duplicate property on that view shows the copy', () => {
    const { tool, el } = build(legacy(['notes', 'where']));

    el.querySelector<HTMLElement>('[data-blok-database-table-column-header][data-property-id="notes"] [data-blok-database-table-column-button]')?.click();
    menuItem('tools.database.duplicateProperty').click();
    const id = newId(tool, el);

    expect(headerOrder(el)).toContain(id);
  });

  it('a column hidden in the view stays hidden after another is added', () => {
    const { tool, el } = build(tableData(SCHEMA, {
      properties: [{ id: 'title', visible: true }, { id: 'notes', visible: false }, { id: 'where', visible: true }],
    }));

    insertRightOf(el, 'where');
    const id = newId(tool, el);

    expect(headerOrder(el)).toEqual(['title', 'where', id]);
  });
});
