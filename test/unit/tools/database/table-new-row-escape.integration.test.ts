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
});
