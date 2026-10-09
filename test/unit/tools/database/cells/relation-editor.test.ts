import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { openCellEditor } from '../../../../../src/tools/database/cells';
import type { PropertyDefinition } from '../../../../../src/tools/database/types';
import { makeAnchor, makeEditorContext, press } from './helpers';

const relation = (limit?: 1): PropertyDefinition => ({
  id: 'rel', name: 'Related', type: 'relation', position: 'a0', relation: { targetDatabaseId: 'db', ...(limit !== undefined ? { limit } : {}) },
});

const candidates = [
  { id: 'r1', title: 'Alpha' },
  { id: 'r2', title: 'Bravo' },
  { id: 'r3', title: '' },
];

const options = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-blok-database-relation-option]')];
const search = (): HTMLInputElement => {
  const input = document.querySelector<HTMLInputElement>('[data-blok-database-relation-search]');

  if (input === null) throw new Error('no search');

  return input;
};

describe('relation editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('lists the target rows by title and marks the related ones', () => {
    openCellEditor(relation(), [{ id: 'r2' }], makeAnchor(), makeEditorContext({ relationCandidates: () => candidates }));

    expect(options().map((o) => o.textContent)).toEqual(['Alpha', 'Bravo', 'tools.database.relationUntitled']);
    expect(options().map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
  });

  it('commits the whole list as id objects when a row is picked', () => {
    const onCommit = vi.fn();

    openCellEditor(relation(), [{ id: 'r2' }], makeAnchor(), makeEditorContext({ relationCandidates: () => candidates, onCommit }));
    options()[0].click();

    expect(onCommit).toHaveBeenLastCalledWith([{ id: 'r2' }, { id: 'r1' }]);
  });

  it('removes a related row when it is picked again', () => {
    const onCommit = vi.fn();

    openCellEditor(relation(), [{ id: 'r1' }, { id: 'r2' }], makeAnchor(), makeEditorContext({ relationCandidates: () => candidates, onCommit }));
    options()[1].click();

    expect(onCommit).toHaveBeenLastCalledWith([{ id: 'r1' }]);
  });

  it('replaces the related row when the limit is one page', () => {
    const onCommit = vi.fn();

    openCellEditor(relation(1), [{ id: 'r1' }], makeAnchor(), makeEditorContext({ relationCandidates: () => candidates, onCommit }));
    options()[1].click();

    expect(onCommit).toHaveBeenLastCalledWith([{ id: 'r2' }]);
  });

  it('filters by the search text and picks the active row with Enter', () => {
    const onCommit = vi.fn();

    openCellEditor(relation(), [], makeAnchor(), makeEditorContext({ relationCandidates: () => candidates, onCommit }));
    search().value = 'bra';
    search().dispatchEvent(new Event('input'));

    expect(options().map((o) => o.textContent)).toEqual(['Bravo']);
    press(search(), 'Enter');
    expect(onCommit).toHaveBeenLastCalledWith([{ id: 'r2' }]);
  });

  it('opens nothing without candidates from the host', () => {
    expect(openCellEditor(relation(), [], makeAnchor(), makeEditorContext()).isOpen).toBe(false);
  });
});
