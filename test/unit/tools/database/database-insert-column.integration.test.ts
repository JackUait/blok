import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SCHEMA, buildTool, makeDoc, tableData } from './tier3-harness';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

const built: Array<{ destroy: () => void }> = [];

/** A view that lists no columns shows them all, as a new table does (index.ts:904). */
const build = (): HTMLElement => {
  const { tool, el } = buildTool(makeDoc([]), {}, tableData(SCHEMA, { visibleProperties: [] }));

  built.push(tool);

  return el;
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

/** Column menu › Insert left / right › Text, as a user picks them. */
const insertBeside = (el: HTMLElement, propertyId: string, item: string): void => {
  el.querySelector<HTMLElement>(`[data-blok-database-table-column-header][data-property-id="${propertyId}"] [data-blok-database-table-column-button]`)?.click();
  menuItem(item).click();
  const text = document.querySelector<HTMLElement>('[data-blok-database-property-type-option="text"]');

  if (text === null) throw new Error('no type list');
  text.click();
};

// Ledger 21:125 D28 (database-table-menus.ts:257): Insert left / right add a column beside this one.
describe('DatabaseTool — column menu Insert left / right', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    built.splice(0).forEach((tool) => tool.destroy());
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('Insert right puts the new column right after this one, not at the end', () => {
    const el = build();
    expect(headerOrder(el)).toEqual(['title', 'notes', 'where']);

    insertBeside(el, 'notes', 'tools.database.tableInsertRight');

    const order = headerOrder(el);

    expect(order).toHaveLength(4);
    expect(order.slice(0, 2)).toEqual(['title', 'notes']);
    expect(order[3]).toBe('where');
  });

  it('Insert left puts it right before this one', () => {
    const el = build();
    insertBeside(el, 'notes', 'tools.database.tableInsertLeft');

    const order = headerOrder(el);

    expect(order).toHaveLength(4);
    expect(order[0]).toBe('title');
    expect(order.slice(2)).toEqual(['notes', 'where']);
  });
});
