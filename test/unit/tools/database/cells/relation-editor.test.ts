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

    expect(options().map((o) => o.textContent?.trim())).toEqual(['Alpha', 'Bravo', 'tools.database.relationUntitled']);
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

  // notion-spec-2 §18.4: the first page is highlighted on open and Enter links it. Enter never unlinks.
  it('Enter right after opening links the first page and stays open', () => {
    const onCommit = vi.fn();
    const onClose = vi.fn();

    openCellEditor(relation(), [], makeAnchor(), makeEditorContext({ relationCandidates: () => candidates, onCommit, onClose }));
    press(search(), 'Enter');

    expect(onCommit).toHaveBeenLastCalledWith([{ id: 'r1' }]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Enter on a highlighted page that is already linked keeps it linked', () => {
    const onCommit = vi.fn();

    openCellEditor(relation(), [{ id: 'r1' }], makeAnchor(), makeEditorContext({ relationCandidates: () => candidates, onCommit }));
    press(search(), 'Enter');

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('filters by the search text and picks the active row with Enter', () => {
    const onCommit = vi.fn();

    openCellEditor(relation(), [], makeAnchor(), makeEditorContext({ relationCandidates: () => candidates, onCommit }));
    search().value = 'bra';
    search().dispatchEvent(new Event('input'));

    expect(options().map((o) => o.textContent?.trim())).toEqual(['Bravo']);
    press(search(), 'Enter');
    expect(onCommit).toHaveBeenLastCalledWith([{ id: 'r2' }]);
  });

  // notion-spec-2 §18.3 (b4-rel-dlg.txt): the table picker is 560 wide, "In <database>" in its head, "Select a page" over 32px page rows.
  describe('in a table cell', () => {
    const openInTable = (): void => {
      openCellEditor(relation(), [], makeAnchor(), makeEditorContext({ relationCandidates: () => candidates, relationScope: () => 'Tasks', coverCell: true }));
    };

    it('opens 560 wide', () => {
      openInTable();

      expect(search().closest<HTMLElement>('[data-blok-popover]')?.style.getPropertyValue('--width')).toBe('560px');
    });

    it('names the related database in the head and labels the list "Select a page"', () => {
      openInTable();

      expect(document.querySelector('[data-blok-database-relation-scope] strong')?.textContent).toBe('Tasks');
      expect(document.querySelector('[data-blok-database-relation-heading]')?.textContent).toBe('tools.database.formRelationHeading');
      expect(document.querySelector('[data-blok-database-select-hint]')).toBeNull();
      expect(search().placeholder).toBe('tools.database.relationSearchPlaceholder');
    });

    it('draws a page glyph before each title', () => {
      openInTable();

      expect(options()[0].querySelector('[data-blok-database-page-icon-placeholder] svg')).not.toBeNull();
      expect(options()[0].textContent?.trim()).toBe('Alpha');
    });
  });

  it('keeps the search and hint over a row page value', () => {
    openCellEditor(relation(), [], makeAnchor(), makeEditorContext({ relationCandidates: () => candidates, relationScope: () => 'Tasks', coverCell: 'value' }));

    expect(document.querySelector('[data-blok-database-relation-scope]')).toBeNull();
    expect(document.querySelector('[data-blok-database-select-hint]')).not.toBeNull();
  });

  it('opens nothing without candidates from the host', () => {
    expect(openCellEditor(relation(), [], makeAnchor(), makeEditorContext()).isOpen).toBe(false);
  });
});
