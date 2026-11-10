import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DatabaseData } from '../../../../src/tools/database/types';
import { buildDatabase, makeDoc, rowSeed } from './structure-harness';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

const data = (): DatabaseData => ({
  schema: [
    { id: 'title', name: 'Name', type: 'title', position: 'a0' },
    { id: 'note', name: 'Note', type: 'text', position: 'a1' },
  ],
  views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['title', 'note'] }],
  activeViewId: 'v',
});

const seed = (): ReturnType<typeof makeDoc> => makeDoc([
  { id: 'db', name: 'database', parentId: null, data: {} },
  rowSeed('r1', 'db', { properties: { title: 'Alpha' }, position: 'a0' }),
  rowSeed('r2', 'db', { properties: { title: 'Gamma' }, position: 'a1' }),
]);

const press = (target: EventTarget, key: string): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
};

const rowIds = (el: HTMLElement): string[] =>
  [...el.querySelectorAll('[data-blok-database-table-row]')].map((row) => row.getAttribute('data-row-id') ?? '');

const selectedCells = (el: HTMLElement): string[] =>
  [...el.querySelectorAll<HTMLElement>('[role="gridcell"][aria-selected="true"]')]
    .map((cell) => `${cell.closest('[data-row-id]')?.getAttribute('data-row-id') ?? ''}/${cell.getAttribute('data-property-id') ?? ''}`);

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
};

// notion-motion.md Round 11 "Escape on a new empty row".
describe('Escape on a new empty table row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('removes the row and selects the Name cell of the row above; a second Escape selects that row', async () => {
    const { el } = buildDatabase(seed(), 'db', data());

    el.querySelector<HTMLElement>('[data-blok-database-table-add-row]')?.click();
    await flush();
    const field = document.querySelector<HTMLElement>('[data-blok-database-cell-editor] [data-blok-database-cell-input]');

    expect(field).not.toBeNull();
    press(field ?? document.body, 'Escape');
    await flush();

    expect(rowIds(el)).toEqual(['r1', 'r2']);
    expect(selectedCells(el)).toEqual(['r2/title']);
    const grid = el.querySelector('[role="grid"]');

    expect(grid?.contains(document.activeElement)).toBe(true);

    press(document.activeElement ?? document.body, 'Escape');

    expect(el.querySelector('[data-blok-database-table-row][data-row-id="r2"]')?.getAttribute('aria-selected')).toBe('true');
    expect(selectedCells(el)).toEqual([]);
  });

  // notion-motion.md Round 12 "Escape on a new empty row, grouped table": in an empty group the row is removed,
  // nothing is selected, and focus goes to body.
  it('in an empty group, removes the row, selects nothing and leaves the caret alone', async () => {
    const doc = seed();
    const grouped: DatabaseData = {
      schema: [
        { id: 'title', name: 'Name', type: 'title', position: 'a0' },
        { id: 'tag', name: 'Tag', type: 'select', position: 'a1', config: { options: [{ id: 'red', label: 'Red', color: 'red', position: 'a0' }, { id: 'blue', label: 'Blue', color: 'blue', position: 'a1' }] } },
      ],
      views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['title', 'tag'], groupBy: 'tag' }],
      activeViewId: 'v',
    };

    doc.row('r1').properties.tag = 'red';
    doc.row('r2').properties.tag = 'red';
    const { el } = buildDatabase(doc, 'db', grouped);

    el.querySelector<HTMLElement>('[data-blok-database-table-add-row][data-group-key="blue"]')?.click();
    await flush();
    const field = document.querySelector<HTMLElement>('[data-blok-database-cell-editor] [data-blok-database-cell-input]');

    expect(field).not.toBeNull();
    press(field ?? document.body, 'Escape');
    await flush();

    expect(rowIds(el)).toEqual(['r1', 'r2']);
    expect(selectedCells(el)).toEqual([]);
    expect(el.querySelector('[data-blok-database-table-row][aria-selected="true"]')).toBeNull();
    expect(doc.api.blocks.delete).toHaveBeenCalledWith(expect.any(Number), false);
  });
});
