import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enclosingCellTable } from '../../../../src/components/utils/enclosing-cell-table';

interface FakeBlock {
  id: string;
  name: string;
  parentId: string | null;
  holder: HTMLElement;
}

const make = (id: string, name: string, parentId: string | null, holder: HTMLElement = document.createElement('div')): FakeBlock =>
  ({ id, name, parentId, holder });

const inCell = (): HTMLElement => {
  const cell = document.createElement('div');
  const holder = document.createElement('div');

  cell.setAttribute('data-blok-table-cell-blocks', '');
  cell.appendChild(holder);

  return holder;
};

describe('enclosingCellTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('walks up through non-table parents to the nearest table', () => {
    const table = make('t', 'table', null);
    const toggle = make('g', 'toggle', 't');
    const child = make('c', 'paragraph', 'g', inCell());
    const byId = new Map([table, toggle, child].map(b => [b.id, b]));

    expect(enclosingCellTable(child, id => byId.get(id))).toBe(table);
  });

  it('finds nothing for a block outside a table cell', () => {
    const table = make('t', 'table', null);
    const child = make('c', 'paragraph', 't');

    expect(enclosingCellTable(child, id => (id === 't' ? table : undefined))).toBeUndefined();
  });

  it('finds nothing for a root block', () => {
    expect(enclosingCellTable(make('c', 'paragraph', null, inCell()), () => undefined)).toBeUndefined();
  });

  it('finds nothing when the parent chain breaks before a table', () => {
    const child = make('c', 'paragraph', 'gone', inCell());

    expect(enclosingCellTable(child, () => undefined)).toBeUndefined();
  });
});
